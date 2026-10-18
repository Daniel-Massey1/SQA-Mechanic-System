const assert = require('node:assert/strict');
const test = require('node:test');
const {
  api,
  getDb,
  insertBooking,
  slotString,
  startApi,
  stopApi,
} = require('../apiTestHelper');

test.before(startApi);
test.after(stopApi);

test('manager dashboard lists past confirmed bookings and excludes future, pending, and closed bookings', async () => {
  const overdueId = Number(insertBooking(slotString(-2, 10)));
  const futureId = Number(insertBooking(slotString(2, 10)));
  const pendingId = Number(insertBooking(slotString(-2, 11), { status: 'pending' }));
  const completedId = Number(insertBooking(slotString(-2, 12), { status: 'completed' }));
  const cancelledId = Number(insertBooking(slotString(-2, 13), { status: 'cancelled' }));
  const deniedId = Number(insertBooking(slotString(-2, 14), { status: 'denied' }));

  const { status, body } = await api('GET', '/api/manager/dashboard', { as: 'manager1' });

  assert.equal(status, 200);
  const overdueIds = body.overdueBookings.map((booking) => booking.id);
  assert.equal(overdueIds.includes(overdueId), true);
  for (const id of [futureId, pendingId, completedId, cancelledId, deniedId]) {
    assert.equal(overdueIds.includes(id), false);
  }
});

test('manager dashboard returns no overdue jobs when no confirmed bookings remain open', async () => {
  const db = getDb();
  const confirmed = db.prepare("SELECT id FROM bookings WHERE status = 'confirmed'").all();
  const closeBooking = db.prepare("UPDATE bookings SET status = 'completed' WHERE id = ?");
  const restoreBooking = db.prepare("UPDATE bookings SET status = 'confirmed' WHERE id = ?");
  confirmed.forEach(({ id }) => closeBooking.run(id));

  try {
    const { status, body } = await api('GET', '/api/manager/dashboard', { as: 'manager1' });
    assert.equal(status, 200);
    assert.deepEqual(body.overdueBookings, []);
  } finally {
    confirmed.forEach(({ id }) => restoreBooking.run(id));
  }
});

test('only managers can view overdue jobs on the manager dashboard', async () => {
  const anonymous = await api('GET', '/api/manager/dashboard');
  const customer = await api('GET', '/api/manager/dashboard', { as: 'customer1' });

  assert.equal(anonymous.status, 401);
  assert.equal(customer.status, 403);
});

test('repeat analysis returns empty results when no repeats exist and protects the endpoint', async () => {
  const db = getDb();
  const completed = db.prepare("SELECT id, status FROM bookings WHERE status = 'completed'").all();
  const hideCompleted = db.prepare("UPDATE bookings SET status = 'denied' WHERE id = ?");
  const restoreStatus = db.prepare('UPDATE bookings SET status = ? WHERE id = ?');
  completed.forEach(({ id }) => hideCompleted.run(id));

  try {
    const manager = await api('GET', '/api/manager/repeat-analysis', { as: 'manager1' });
    const anonymous = await api('GET', '/api/manager/repeat-analysis');
    const customer = await api('GET', '/api/manager/repeat-analysis', { as: 'customer1' });
    const mechanic = await api('GET', '/api/manager/repeat-analysis', { as: 'mechanic1' });

    assert.equal(manager.status, 200);
    assert.deepEqual(manager.body.repeatRepairs, []);
    assert.deepEqual(manager.body.repeatedDiagnosticDescriptions, []);
    assert.deepEqual(manager.body.repeatRepairSummary, { vehicleCount: 0, completedBookingCount: 0 });
    assert.equal(anonymous.status, 401);
    assert.equal(customer.status, 403);
    assert.equal(mechanic.status, 403);
  } finally {
    completed.forEach(({ id, status }) => restoreStatus.run(status, id));
  }
});

test('repeat analysis counts completed bookings per vehicle and by service type only', async () => {
  const db = getDb();
  const vehicleId = Number(db.prepare('SELECT id FROM vehicles WHERE plate = ?').get('ABC123').id);
  const otherVehicleId = Number(db.prepare('SELECT id FROM vehicles WHERE plate = ?').get('XYZ789').id);
  const existingCompleted = db.prepare(
    "SELECT service_type, COUNT(*) AS count FROM bookings WHERE vehicle_id = ? AND status = 'completed' GROUP BY service_type"
  ).all(vehicleId);
  const existingByService = Object.fromEntries(existingCompleted.map((row) => [row.service_type, row.count]));
  const existingCount = existingCompleted.reduce((total, row) => total + row.count, 0);
  insertBooking(slotString(10, 9), { status: 'completed' });
  const repeatedSecond = Number(insertBooking(slotString(11, 10), { status: 'completed' }));
  const singleId = Number(insertBooking(slotString(12, 11), { status: 'completed', bookedBy: 'customer2' }));
  const otherStatuses = ['pending', 'confirmed', 'denied', 'cancelled']
    .map((status, index) => Number(insertBooking(slotString(13 + index, 12), { status, bookedBy: 'customer2' })));
  db.prepare("UPDATE bookings SET service_type = 'full_service' WHERE id = ?").run(repeatedSecond);

  const { status, body } = await api('GET', '/api/manager/repeat-analysis', { as: 'manager1' });

  assert.equal(status, 200);
  const repeated = body.repeatRepairs.find((vehicle) => vehicle.vehicleId === vehicleId);
  assert.ok(repeated);
  assert.equal(repeated.completedBookingCount, existingCount + 2);
  assert.deepEqual(repeated.serviceTypeCounts, [
    { serviceType: 'basic_service', completedBookingCount: (existingByService.basic_service || 0) + 1 },
    { serviceType: 'full_service', completedBookingCount: 1 },
  ]);
  assert.equal(body.repeatRepairs.some((vehicle) => vehicle.vehicleId === otherVehicleId), false);
  assert.equal(db.prepare('SELECT vehicle_id FROM bookings WHERE id = ?').get(singleId).vehicle_id, otherVehicleId);
  assert.equal(otherStatuses.every((id) => db.prepare('SELECT status FROM bookings WHERE id = ?').get(id).status !== 'completed'), true);
});

test('repeat analysis groups current diagnostic descriptions and excludes superseded versions', async () => {
  const db = getDb();
  const vehicleId = Number(db.prepare('SELECT id FROM vehicles WHERE plate = ?').get('ABC123').id);
  const addEntry = db.prepare(
    `INSERT INTO diagnostic_entries (vehicle_id, fault_description, severity, status)
     VALUES (?, ?, 'medium', 'fixed')`
  );
  const oldEntryId = Number(addEntry.run(vehicleId, ' Brake noise ').lastInsertRowid);
  db.prepare(
    `INSERT INTO diagnostic_entries (vehicle_id, fault_description, severity, status, supersedes_entry_id)
     VALUES (?, '  Brake noise  ', 'high', 'flagged_for_next_visit', ?)`
  ).run(vehicleId, oldEntryId);
  addEntry.run(vehicleId, 'brake noise');

  const { status, body } = await api('GET', '/api/manager/repeat-analysis', { as: 'manager1' });

  assert.equal(status, 200);
  const repeatedDescription = body.repeatedDiagnosticDescriptions.find((entry) => entry.vehicle_id === vehicleId);
  assert.ok(repeatedDescription);
  assert.equal(repeatedDescription.entry_count, 2);
  assert.equal(repeatedDescription.description.trim().toLowerCase(), 'brake noise');
});
