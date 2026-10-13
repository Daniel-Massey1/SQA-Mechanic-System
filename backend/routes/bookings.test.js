const assert = require('node:assert/strict');
const test = require('node:test');
const { isWithinCancellationWindow } = require('./bookings');

const HOUR_MS = 60 * 60 * 1000;

// Data-driven: each row is [hours before the appointment, is cancellation blocked?].
// The rule is "within 24 hours (inclusive)", so 24 is the boundary.
const cancellationCases = [
  [0, true],
  [1, true],
  [23, true],
  [24, true],
  [25, false],
  [48, false],
];

for (const [hoursBefore, blocked] of cancellationCases) {
  const outcome = blocked ? 'blocked' : 'allowed';

  test(`cancellation is ${outcome} ${hoursBefore} hours before the appointment`, () => {
    const now = new Date('2026-10-08T00:00:00');
    const slotTime = new Date(now.getTime() + hoursBefore * HOUR_MS);

    assert.equal(isWithinCancellationWindow(slotTime, now), blocked);
  });
}

test('cancellation is blocked one minute inside the 24 hour limit and allowed one minute outside', () => {
  const now = new Date('2026-10-08T00:00:00');
  const minute = 60 * 1000;

  assert.equal(isWithinCancellationWindow(new Date(now.getTime() + 24 * HOUR_MS - minute), now), true);
  assert.equal(isWithinCancellationWindow(new Date(now.getTime() + 24 * HOUR_MS + minute), now), false);
});
