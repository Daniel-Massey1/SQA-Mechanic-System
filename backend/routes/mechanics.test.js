const assert = require('node:assert/strict');
const test = require('node:test');
const {
  api,
  getBooking,
  getDb,
  getNotification,
  insertBooking,
  slotString,
  startApi,
  stopApi,
  vehicleIdOf,
} = require('../apiTestHelper');

test.before(startApi);
test.after(stopApi);

function decide(id, decision, username = 'mechanic1') {
  return api('POST', `/api/mechanics/bookings/${id}/decision`, { as: username, body: { decision } });
}

function addDiagnostic(body, username = 'mechanic1') {
  return api('POST', '/api/mechanics/diagnostics', { as: username, body });
}

function getEntry(id) {
  return getDb().prepare('SELECT * FROM diagnostic_entries WHERE id = ?').get(id);
}

test('approving a request confirms the booking and emails the customer', async () => {
  const id = insertBooking(slotString(5, 10), { status: 'pending' });

  const { status, body } = await decide(id, 'approve');

  assert.equal(status, 200);
  assert.equal(body.status, 'confirmed');
  const booking = getBooking(id);
  assert.equal(booking.status, 'confirmed');
  assert.equal(booking.decided_by, 'mechanic1');
  const email = getNotification(id, 'booking_decision');
  assert.equal(email.recipient, 'jane@example.com');
  assert.equal(email.status, 'sent');
});

test('denying a request marks the booking denied and tells the customer', async () => {
  const id = insertBooking(slotString(5, 11), { status: 'pending' });

  const { status, body } = await decide(id, 'deny');

  assert.equal(status, 200);
  assert.equal(body.status, 'denied');
  assert.equal(getBooking(id).status, 'denied');
  assert.match(getBooking(id).customer_notification, /declined/);
});

test('a decided request cannot be changed and leaves the pending list', async () => {
  const id = insertBooking(slotString(5, 12), { status: 'pending' });
  await decide(id, 'approve');

  const second = await decide(id, 'deny');
  const dashboard = await api('GET', '/api/mechanics/dashboard', { as: 'mechanic1' });

  assert.equal(second.status, 400);
  assert.equal(getBooking(id).status, 'confirmed');
  const pendingIds = dashboard.body.pendingBookings.map((booking) => booking.id);
  assert.equal(pendingIds.includes(Number(id)), false);
});

test('a decision that is not approve or deny is rejected', async () => {
  const id = insertBooking(slotString(5, 13), { status: 'pending' });

  const { status } = await decide(id, 'maybe');

  assert.equal(status, 400);
  assert.equal(getBooking(id).status, 'pending');
});

test('customers cannot approve bookings', async () => {
  const id = insertBooking(slotString(5, 14), { status: 'pending' });

  const { status } = await decide(id, 'approve', 'customer1');

  assert.equal(status, 403);
  assert.equal(getBooking(id).status, 'pending');
});

test('a diagnostic entry is stored against the selected vehicle', async () => {
  const vehicleId = vehicleIdOf('customer2');

  const { status, body } = await addDiagnostic({
    vehicleId,
    faultDescription: 'Rear tyre worn',
    severity: 'medium',
    status: 'flagged_for_next_visit',
  });

  assert.equal(status, 201);
  assert.equal(body.entry.vehicle_id, vehicleId);
  assert.equal(body.entry.fault_description, 'Rear tyre worn');
  assert.equal(body.entry.supersedes_entry_id, null);
});

test('a diagnostic entry for an unknown vehicle is rejected with a message', async () => {
  const { status, body } = await addDiagnostic({
    vehicleId: 999999,
    faultDescription: 'Rear tyre worn',
    severity: 'medium',
    status: 'fixed',
  });

  assert.equal(status, 404);
  assert.deepEqual(body, { error: 'Vehicle not found.' });
});

test('a diagnostic entry with an invalid severity or no description is rejected', async () => {
  const vehicleId = vehicleIdOf('customer1');

  const badSeverity = await addDiagnostic({ vehicleId, faultDescription: 'Leak', severity: 'urgent', status: 'fixed' });
  const noDescription = await addDiagnostic({ vehicleId, faultDescription: '  ', severity: 'low', status: 'fixed' });

  assert.equal(badSeverity.status, 400);
  assert.equal(noDescription.status, 400);
});

test('editing a diagnostic entry adds a new entry and leaves the original unchanged', async () => {
  const vehicleId = vehicleIdOf('customer1');
  const created = await addDiagnostic({ vehicleId, faultDescription: 'Oil leak', severity: 'low', status: 'fixed' });
  const originalId = created.body.entry.id;
  const originalBefore = getEntry(originalId);

  const edited = await api('PUT', `/api/mechanics/diagnostics/${originalId}`, {
    as: 'mechanic1',
    body: { faultDescription: 'Oil leak from sump plug', severity: 'high', status: 'flagged_for_next_visit' },
  });

  assert.equal(edited.status, 200);
  assert.notEqual(edited.body.entry.id, originalId);
  assert.equal(edited.body.entry.supersedes_entry_id, originalId);
  assert.deepEqual(getEntry(originalId), originalBefore);

  const history = await api('GET', `/api/vehicles/${vehicleId}/history`, { as: 'mechanic1' });
  const original = history.body.history.find((entry) => entry.id === originalId);
  assert.equal(original.is_superseded, true);
});
