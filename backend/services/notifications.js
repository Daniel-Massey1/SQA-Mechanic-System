/**
 * notifications.js
 *
 * Every email the system sends goes through the `notifications` outbox table:
 * routes queue a message, then processOutbox() delivers whatever is due.
 * A failed send is retried every RETRY_DELAY_HOURS until MAX_SEND_ATTEMPTS is
 * reached (1 initial attempt + 3 retries = a 24 hour window), after which the
 * message is marked 'failed'. Nothing is lost if a send fails or the server restarts.
 *
 * Email delivery itself is mocked - swap mockSendEmail for a real provider later.
 */

const WORKSHOP_EMAIL = process.env.WORKSHOP_EMAIL || 'bookings@workshop.example';
const MAX_SEND_ATTEMPTS = 4;
const RETRY_DELAY_HOURS = 8;

// Optional simulated failure rate (0 to 1) for demonstrating retries, e.g. MOCK_EMAIL_FAILURE_RATE=0.5
const MOCK_FAILURE_RATE = Number(process.env.MOCK_EMAIL_FAILURE_RATE) || 0;

function mockSendEmail({ recipient, subject }) {
  if (Math.random() < MOCK_FAILURE_RATE) {
    return { success: false, error: 'Simulated mail server failure.' };
  }
  console.log(`[MOCK EMAIL] to=${recipient} subject="${subject}"`);
  return { success: true };
}

/**
 * Adds a message to the outbox. Returns the new notification id, or null when
 * a message with the same dedupeKey has already been queued.
 */
function queueEmail(db, { type, recipient, subject, body, dedupeKey = null, bookingId = null, vehicleId = null }, now = new Date()) {
  const timestamp = now.toISOString();
  const result = db.prepare(
    `INSERT OR IGNORE INTO notifications
       (type, recipient, subject, body, dedupe_key, booking_id, vehicle_id, created_at, next_attempt_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(type, recipient, subject, body, dedupeKey, bookingId, vehicleId, timestamp, timestamp);
  return result.changes > 0 ? result.lastInsertRowid : null;
}

/**
 * Attempts delivery of every queued message whose next attempt is due.
 */
function processOutbox(db, { now = new Date(), sender = mockSendEmail } = {}) {
  const due = db.prepare(
    `SELECT * FROM notifications
     WHERE status = 'queued' AND next_attempt_at <= ?
     ORDER BY id`
  ).all(now.toISOString());

  const markSent = db.prepare(
    "UPDATE notifications SET status = 'sent', attempts = ?, sent_at = ?, last_error = NULL WHERE id = ?"
  );
  const markRetry = db.prepare(
    'UPDATE notifications SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?'
  );
  const markFailed = db.prepare(
    "UPDATE notifications SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?"
  );

  const summary = { sent: 0, retrying: 0, failed: 0 };
  due.forEach((message) => {
    const attempts = message.attempts + 1;
    let result;
    try {
      result = sender(message);
    } catch (error) {
      result = { success: false, error: error.message };
    }

    if (result.success) {
      markSent.run(attempts, now.toISOString(), message.id);
      summary.sent += 1;
      return;
    }

    const error = result.error || 'Unknown send failure.';
    if (attempts >= MAX_SEND_ATTEMPTS) {
      markFailed.run(attempts, error, message.id);
      console.log(`[EMAIL] Giving up on notification #${message.id} to ${message.recipient} after ${attempts} attempts.`);
      summary.failed += 1;
      return;
    }

    const nextAttempt = new Date(now.getTime() + RETRY_DELAY_HOURS * 60 * 60 * 1000);
    markRetry.run(attempts, nextAttempt.toISOString(), error, message.id);
    console.log(`[EMAIL] Notification #${message.id} failed (attempt ${attempts}/${MAX_SEND_ATTEMPTS}); retrying at ${nextAttempt.toISOString()}.`);
    summary.retrying += 1;
  });

  return summary;
}

/**
 * Queues a message and immediately tries to deliver it. Used by routes for
 * event-driven emails (booking decisions, cancellations) so they go out straight
 * away; a failure here never fails the request - the scheduler retries it.
 */
function sendNow(db, message) {
  const id = queueEmail(db, message);
  try {
    processOutbox(db);
  } catch (error) {
    console.error('[EMAIL] Outbox processing failed:', error);
  }
  return id;
}

module.exports = {
  MAX_SEND_ATTEMPTS,
  RETRY_DELAY_HOURS,
  WORKSHOP_EMAIL,
  mockSendEmail,
  processOutbox,
  queueEmail,
  sendNow,
};
