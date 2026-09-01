const WOF_WINDOW_DAYS = 14;
const MAX_SEND_ATTEMPTS = 3;
// Can lower interval further for local testing (e.g. 60 * 1000 for once a minute)
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Simulates sending one email. Swap out for a real provider later
function mockSendEmail(to, subject, body) {
  const success = Math.random() < 0.85; // 15% simulated failure rate
  return { success, to, subject, body };
}

function sendWithRetry(to, subject, body) {
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt += 1) {
    const result = mockSendEmail(to, subject, body);
    if (result.success) {
      console.log(`[MOCK EMAIL] WOF reminder sent to ${to} (attempt ${attempt}/${MAX_SEND_ATTEMPTS}).`);
      return true;
    }
    console.log(`[MOCK EMAIL] WOF reminder failed for ${to} (attempt ${attempt}/${MAX_SEND_ATTEMPTS}).`);
  }
  console.log(`[MOCK EMAIL] Giving up on WOF reminder to ${to} after ${MAX_SEND_ATTEMPTS} attempts.`);
  return false;
}

function checkUpcomingWofExpiries(db) {
  const target = new Date();
  target.setDate(target.getDate() + WOF_WINDOW_DAYS);
  const targetDate = target.toISOString().slice(0, 10);

  const vehicles = db.prepare(
    `SELECT vehicles.plate, vehicles.make, vehicles.model, vehicles.wof_expiry,
            customers.name AS customer_name, customers.email AS customer_email
     FROM vehicles
     JOIN customers ON customers.id = vehicles.customer_id
     WHERE date(vehicles.wof_expiry) = date(?)`
  ).all(targetDate);

  if (vehicles.length === 0) {
    console.log(`[WOF CHECK] No vehicles due for WOF renewal on ${targetDate}.`);
    return { checkedFor: targetDate, vehicleCount: 0, notified: 0, failed: 0 };
  }

  let notified = 0;
  let failed = 0;
  vehicles.forEach((vehicle) => {
    const subject = 'Your WOF is due in 2 weeks';
    const body = `Hi ${vehicle.customer_name}, your ${vehicle.make} ${vehicle.model} `
      + `(${vehicle.plate}) WOF expires on ${vehicle.wof_expiry}. Please book a check.`;
    const sent = sendWithRetry(vehicle.customer_email, subject, body);
    if (sent) notified += 1;
    else failed += 1;
  });

  console.log(`[WOF CHECK] ${vehicles.length} vehicle(s) due on ${targetDate}: ${notified} notified, ${failed} failed.`);
  return { checkedFor: targetDate, vehicleCount: vehicles.length, notified, failed };
}

// Runs the check immediately then on recurring interval as long as process stays up
function startWofReminderSchedule(db) {
  checkUpcomingWofExpiries(db);
  return setInterval(() => checkUpcomingWofExpiries(db), CHECK_INTERVAL_MS);
}

module.exports = { checkUpcomingWofExpiries, startWofReminderSchedule, mockSendEmail };