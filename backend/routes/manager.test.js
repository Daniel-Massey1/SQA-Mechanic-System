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
