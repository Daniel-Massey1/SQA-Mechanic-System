const assert = require('node:assert/strict');
const test = require('node:test');
const { isWithinCancellationWindow } = require('./bookings');

const HOUR_MS = 60 * 60 * 1000;

test('cancellation is blocked less than 24 hours before the appointment', () => {
  const now = new Date('2026-10-08T00:00:00');
  const slotTime = new Date(now.getTime() + 23 * HOUR_MS);

  assert.equal(isWithinCancellationWindow(slotTime, now), true);
});

test('cancellation is blocked exactly 24 hours before the appointment', () => {
  const now = new Date('2026-10-08T00:00:00');
  const slotTime = new Date(now.getTime() + 24 * HOUR_MS);

  assert.equal(isWithinCancellationWindow(slotTime, now), true);
});

test('cancellation is allowed more than 24 hours before the appointment', () => {
  const now = new Date('2026-10-08T00:00:00');
  const slotTime = new Date(now.getTime() + 25 * HOUR_MS);

  assert.equal(isWithinCancellationWindow(slotTime, now), false);
});
