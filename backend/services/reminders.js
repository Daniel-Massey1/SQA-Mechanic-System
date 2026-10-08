/**
 * reminders.js
 *
 * FR05 / AC07 / AC08 - WOF and service reminders.
 *
 * Once per day, at the first scheduler tick at or after 8:00am workshop time
 * (NZ by default), every vehicle whose WOF expiry or service due date is exactly
 * 14 days away gets a reminder queued in the notification outbox. The outbox is
 * processed every tick, so reminders go out within minutes of 8:00am and failed
 * sends are retried by services/notifications.js.
 *
 * Each reminder has a dedupe key (type + vehicle + due date), so restarting the
 * server or running the check twice never emails a customer twice.
 */

const { processOutbox, queueEmail } = require('./notifications');
const { addDays, workshopClock } = require('./workshopTime');

const REMINDER_WINDOW_DAYS = 14;
const DAILY_CHECK_HOUR = 8;
const TICK_INTERVAL_MS = 60 * 1000;
const LAST_CHECK_KEY = 'reminder_check_date';

const REMINDER_TYPES = [
  {
    type: 'wof_reminder',
    column: 'wof_expiry',
    subject: 'Your WOF is due in 2 weeks',
    describe: (vehicle) => `WOF expires on ${vehicle.due_date}`,
  },
  {
    type: 'service_reminder',
    column: 'service_due',
    subject: 'Your vehicle service is due in 2 weeks',
    describe: (vehicle) => `next service is due on ${vehicle.due_date}`,
  },
];

// Queues reminders for every vehicle due exactly REMINDER_WINDOW_DAYS after `today`.
function queueDueReminders(db, today, now = new Date()) {
  const targetDate = addDays(today, REMINDER_WINDOW_DAYS);
  const summary = { checkedFor: targetDate, wof: 0, service: 0, alreadyQueued: 0 };

  REMINDER_TYPES.forEach(({ type, column, subject, describe }) => {
    const vehicles = db.prepare(
      `SELECT vehicles.id, vehicles.plate, vehicles.make, vehicles.model, vehicles.${column} AS due_date,
              customers.name AS customer_name, customers.email AS customer_email
       FROM vehicles
       JOIN customers ON customers.id = vehicles.customer_id
       WHERE date(vehicles.${column}) = date(?)`
    ).all(targetDate);

    vehicles.forEach((vehicle) => {
      const id = queueEmail(db, {
        type,
        recipient: vehicle.customer_email,
        subject,
        body: `Hi ${vehicle.customer_name}, your ${vehicle.make} ${vehicle.model} (${vehicle.plate}) `
          + `${describe(vehicle)}. Log in to the portal to book a time.`,
        dedupeKey: `${type}:${vehicle.id}:${vehicle.due_date}`,
        vehicleId: vehicle.id,
      }, now);
      if (id === null) summary.alreadyQueued += 1;
      else if (type === 'wof_reminder') summary.wof += 1;
      else summary.service += 1;
    });
  });

  return summary;
}

/**
 * One scheduler tick: runs the daily reminder check if it is due, then
 * delivers anything waiting in the outbox (including retries).
 */
function runReminderTick(db, { now = new Date(), sender } = {}) {
  const { date, hour } = workshopClock(now);
  const lastCheck = db.prepare('SELECT value FROM app_metadata WHERE key = ?').get(LAST_CHECK_KEY)?.value;

  let check = null;
  if (hour >= DAILY_CHECK_HOUR && lastCheck !== date) {
    check = queueDueReminders(db, date, now);
    db.prepare(
      `INSERT INTO app_metadata (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(LAST_CHECK_KEY, date);
    console.log(`[REMINDERS] Daily check for ${check.checkedFor}: ${check.wof} WOF and ${check.service} service reminder(s) queued.`);
  }

  const delivery = processOutbox(db, { now, ...(sender ? { sender } : {}) });
  return { check, delivery };
}

// Ticks immediately, then every minute while the process is running.
function startReminderSchedule(db) {
  const tick = () => {
    try {
      runReminderTick(db);
    } catch (error) {
      // A failed tick must not crash the server; the next tick tries again.
      console.error('[REMINDERS] Scheduler tick failed:', error);
    }
  };
  tick();
  return setInterval(tick, TICK_INTERVAL_MS);
}

module.exports = {
  addDays,
  queueDueReminders,
  runReminderTick,
  startReminderSchedule,
  workshopClock,
};
