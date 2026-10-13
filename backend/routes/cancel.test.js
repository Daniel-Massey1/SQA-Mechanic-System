const assert = require('node:assert/strict');
const test = require('node:test');
const {
  api,
  getBooking,
  getNotification,
  insertBooking,
  slotString,
  startApi,
  stopApi,
  vehicleIdOf,
} = require('../apiTestHelper');

test.before(startApi);
test.after(stopApi);

function cancel(id, username = 'customer1') {
  return api('POST', `/api/bookings/${id}/cancel`, { as: username });
}

test('cancelling more than 24 hours ahead keeps the booking as a cancelled record', async () => {
  const id = insertBooking(slotString(5, 10));

  const { status, body } = await cancel(id);

  assert.equal(status, 200);
  assert.equal(body.workshopNotified, true);
  const booking = getBooking(id);
  assert.equal(booking.status, 'cancelled');
  assert.notEqual(booking.cancelled_at, null);
});

test('cancelling emails the workshop', async () => {
  const id = insertBooking(slotString(5, 11));

  await cancel(id);

  const email = getNotification(id, 'booking_cancelled');
  assert.equal(email.recipient, 'bookings@workshop.example');
  assert.equal(email.status, 'sent');
});

test('a cancelled slot can be booked again', async () => {
  const slot = slotString(5, 12);
  const id = insertBooking(slot);
  await cancel(id);

  const { status, body } = await api('POST', '/api/bookings', {
    as: 'customer2',
    body: { vehicleId: vehicleIdOf('customer2'), serviceType: 'wof', slotStart: slot },
  });

  assert.equal(status, 201);
  assert.equal(body.booking.status, 'pending');
});

test('cancelling within 24 hours is refused and the booking is unchanged', async () => {
  const id = insertBooking(slotString(0, 10));

  const { status, body } = await cancel(id);

  assert.equal(status, 400);
  assert.match(body.error, /within 24 hours/);
  assert.equal(getBooking(id).status, 'confirmed');
});

test('a booking that is already cancelled or denied cannot be cancelled', async () => {
  const cancelledId = insertBooking(slotString(6, 10));
  await cancel(cancelledId);
  const deniedId = insertBooking(slotString(6, 11), { status: 'denied' });

  const again = await cancel(cancelledId);
  const denied = await cancel(deniedId);

  assert.equal(again.status, 400);
  assert.match(again.body.error, /already been cancelled/);
  assert.equal(denied.status, 400);
  assert.equal(getBooking(deniedId).status, 'denied');
});

test('a customer cannot cancel another customer\'s booking', async () => {
  const id = insertBooking(slotString(6, 12), { bookedBy: 'customer2' });

  const { status } = await cancel(id, 'customer1');

  assert.equal(status, 403);
  assert.equal(getBooking(id).status, 'confirmed');
});

test('cancelling a booking that does not exist returns 404', async () => {
  const { status, body } = await cancel(999999);

  assert.equal(status, 404);
  assert.deepEqual(body, { error: 'Booking not found.' });
});
