const express = require('express');
const { getDb } = require('../db/db');
const { requireAccount, denyAccess } = require('../auth');
const { sendNow } = require('../services/notifications');
const {
  SERVICE_TYPES,
  getChecklistById,
  getLatestChecklist,
  listLatestChecklists,
} = require('../services/checklists');

const router = express.Router();
const VALID_SEVERITIES = ['low', 'medium', 'high'];
const VALID_DIAGNOSTIC_STATUSES = ['fixed', 'flagged_for_next_visit'];

// Return approval requests and checklist templates for mechanics.
router.get('/dashboard', requireAccount, (req, res) => {
  if (req.account.role !== 'mechanic') {
    return denyAccess(req, res, 'Only mechanic accounts can view the mechanic portal.');
  }

  const db = getDb();
  const pendingBookings = db.prepare(
    `SELECT bookings.*, vehicles.plate, vehicles.make, vehicles.model, customers.name AS customer_name
     FROM bookings
     JOIN vehicles ON vehicles.id = bookings.vehicle_id
     JOIN customers ON customers.id = vehicles.customer_id
     WHERE bookings.status = 'pending'
     ORDER BY datetime(bookings.slot_start) ASC`
  ).all();
  const checklists = listLatestChecklists(db);

  return res.json({ pendingBookings, checklists });
});

// Return confirmed appointments for the mechanic's schedule.
router.get('/upcoming', requireAccount, (req, res) => {
  if (req.account.role !== 'mechanic') {
    return denyAccess(req, res, 'Only mechanic accounts can view upcoming bookings.');
  }

  const bookings = getDb().prepare(
    `SELECT bookings.*, vehicles.plate, vehicles.make, vehicles.model, customers.name AS customer_name
     FROM bookings
     JOIN vehicles ON vehicles.id = bookings.vehicle_id
     JOIN customers ON customers.id = vehicles.customer_id
     WHERE bookings.status = 'confirmed' AND datetime(bookings.slot_start) >= datetime('now')
     ORDER BY datetime(bookings.slot_start) ASC`
  ).all();

  return res.json({ bookings });
});

// Return bookings completed by a mechanic.
router.get('/completed', requireAccount, (req, res) => {
  if (req.account.role !== 'mechanic') {
    return denyAccess(req, res, 'Only mechanic accounts can view completed bookings.');
  }

  const bookings = getDb().prepare(
    `SELECT bookings.*, vehicles.plate, vehicles.make, vehicles.model, customers.name AS customer_name
     FROM bookings
     JOIN vehicles ON vehicles.id = bookings.vehicle_id
     JOIN customers ON customers.id = vehicles.customer_id
     WHERE bookings.status = 'completed'
     ORDER BY bookings.completed_at DESC`
  ).all();

  return res.json({ bookings });
});

// Return the latest version of the checklist for the selected service type.
router.get('/checklists/:serviceType', requireAccount, (req, res) => {
  if (req.account.role !== 'mechanic') {
    return denyAccess(req, res, 'Only mechanic accounts can view service checklists.');
  }
  if (!SERVICE_TYPES.includes(req.params.serviceType)) {
    return res.status(400).json({ error: 'Choose a valid service type.' });
  }

  const checklist = getLatestChecklist(getDb(), req.params.serviceType);
  if (!checklist) return res.status(404).json({ error: 'Checklist not found.' });

  return res.json({ checklist });
});

/**
 * POST /api/mechanics/jobs/checklist-compliance
 * Body: { bookingId, serviceType, checklistId, completedItems: string[] }
 *
 * Closes the job and records exactly which checklist items were ticked.
 *  - FR10: every item ticked -> 'Checklist Compliant'.
 *  - AC18: otherwise 'Checklist Incomplete', with the completion percentage stored
 *    against the job (and its mechanic) for the manager dashboard (FR15/FR16).
 */
router.post('/jobs/checklist-compliance', requireAccount, (req, res) => {
  if (req.account.role !== 'mechanic') {
    return denyAccess(req, res, 'Only mechanic accounts can save checklist jobs.');
  }

  const { bookingId, serviceType, completedItems, checklistId } = req.body;
  if (!Number.isInteger(Number(bookingId)) || !SERVICE_TYPES.includes(serviceType)) {
    return res.status(400).json({ error: 'Booking and service type are required.' });
  }

  const db = getDb();
  const booking = db.prepare("SELECT id, service_type FROM bookings WHERE id = ? AND status = 'confirmed'").get(bookingId);
  if (!booking) return res.status(400).json({ error: 'Choose a confirmed booking.' });
  if (booking.service_type !== serviceType) {
    return res.status(400).json({ error: 'The checklist service type must match the selected booking.' });
  }

  // Check against the version the mechanic loaded, so a manager editing the template
  // mid-job does not invalidate work in progress. Without an id, use the latest version.
  const checklist = checklistId ? getChecklistById(db, checklistId) : getLatestChecklist(db, serviceType);
  if (checklist && checklist.service_type !== serviceType) {
    return res.status(400).json({ error: 'The checklist does not match the booking service type.' });
  }
  if (!checklist || checklist.items.length === 0) {
    return res.status(400).json({ error: 'No checklist found for this service type.' });
  }
  if (!Array.isArray(completedItems)) {
    return res.status(400).json({ error: 'Completed checklist items are required.' });
  }
  // Only items from this checklist count, each once, kept in checklist order.
  const unknownItem = completedItems.find((item) => !checklist.items.includes(item));
  if (unknownItem !== undefined) {
    return res.status(400).json({ error: 'One or more ticked items are not on this checklist. Reload the checklist and try again.' });
  }
  const ticked = checklist.items.filter((item) => completedItems.includes(item));
  const completionPercent = Math.round((ticked.length / checklist.items.length) * 100);
  const compliant = ticked.length === checklist.items.length;
  const jobStatus = compliant ? 'Checklist Compliant' : 'Checklist Incomplete';

  // Save the job and booking completion together.
  const completeBooking = db.transaction(() => {
    const job = db.prepare(
      `INSERT INTO jobs (booking_id, mechanic_name, checklist_id, checklist_compliant, status,
                         completed_items_json, completion_percent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(bookingId, req.account.username, checklist.id, compliant ? 1 : 0, jobStatus,
      JSON.stringify(ticked), completionPercent);
    db.prepare(
      `UPDATE bookings
       SET status = 'completed', completed_at = ?,
           customer_notification = 'Your vehicle service has been completed.'
       WHERE id = ?`
    ).run(new Date().toISOString(), bookingId);
    return job.lastInsertRowid;
  });
  const jobId = completeBooking();

  const customer = db.prepare(
    `SELECT customers.email, bookings.confirmation_ref
     FROM bookings
     JOIN vehicles ON vehicles.id = bookings.vehicle_id
     JOIN customers ON customers.id = vehicles.customer_id
     WHERE bookings.id = ?`
  ).get(bookingId);
  sendNow(db, {
    type: 'booking_completed',
    recipient: customer.email,
    subject: `Booking ${customer.confirmation_ref} completed`,
    body: 'Your vehicle service has been completed.',
    bookingId: Number(bookingId),
  });
  return res.status(201).json({ jobId, status: jobStatus, completionPercent, bookingStatus: 'completed' });
});

// Let mechanics approve or deny a pending request.
router.post('/bookings/:id/decision', requireAccount, (req, res) => {
  if (req.account.role !== 'mechanic') {
    return denyAccess(req, res, 'Only mechanic accounts can approve or deny bookings.');
  }

  const { decision } = req.body;
  if (!['approve', 'deny'].includes(decision)) {
    return res.status(400).json({ error: 'Decision must be approve or deny.' });
  }

  const db = getDb();
  const booking = db.prepare(
    `SELECT bookings.*, vehicles.plate, customers.name AS customer_name, customers.email AS customer_email
     FROM bookings
     JOIN vehicles ON vehicles.id = bookings.vehicle_id
     JOIN customers ON customers.id = vehicles.customer_id
     WHERE bookings.id = ?`
  ).get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  if (booking.status !== 'pending') {
    return res.status(400).json({ error: 'Only pending bookings can be approved or denied.' });
  }

  // Approved bookings reserve the appointment slot.
  const status = decision === 'approve' ? 'confirmed' : 'denied';
  const outcome = decision === 'approve' ? 'approved' : 'declined';
  const service = booking.service_type.replace('_', ' ');
  const notification = decision === 'approve'
    ? `Your ${service} booking for ${booking.plate} has been approved. See you then!`
    : `Your ${service} booking for ${booking.plate} was declined. Please choose another time.`;
  try {
    db.prepare('UPDATE bookings SET status = ?, decided_by = ?, decided_at = ?, customer_notification = ? WHERE id = ?')
      .run(status, req.account.username, new Date().toISOString(), notification, booking.id);

    // AC12: the customer is emailed as soon as the decision is saved.
    sendNow(db, {
      type: 'booking_decision',
      recipient: booking.customer_email,
      subject: `Booking ${booking.confirmation_ref} ${outcome}`,
      body: `Hi ${booking.customer_name}, ${notification.charAt(0).toLowerCase()}${notification.slice(1)} `
        + `(Appointment: ${booking.slot_start}, reference ${booking.confirmation_ref}.)`,
      bookingId: booking.id,
    });
    return res.json({ message: `Booking ${status}.`, status, customerNotified: true });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.code === 'SQLITE_CONSTRAINT') {
      return res.status(409).json({ error: 'This time slot has already been approved for another booking.' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Unexpected error while updating the booking.' });
  }
});

// Save a new diagnostic record without changing existing records.
router.post('/diagnostics', requireAccount, (req, res) => {
  if (req.account.role !== 'mechanic') {
    return denyAccess(req, res, 'Only mechanic accounts can add diagnostic entries.');
  }

  const { vehicleId, faultDescription, severity, status } = req.body;
  if (!Number.isInteger(Number(vehicleId)) || !String(faultDescription || '').trim() || !severity || !status) {
    return res.status(400).json({ error: 'Vehicle ID, fault description, severity and status are required.' });
  }
  if (!VALID_SEVERITIES.includes(severity) || !VALID_DIAGNOSTIC_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid severity or diagnostic status.' });
  }

  const db = getDb();
  const vehicle = db.prepare('SELECT id FROM vehicles WHERE id = ?').get(vehicleId);
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found.' });

  const result = db.prepare(
    `INSERT INTO diagnostic_entries (vehicle_id, fault_description, severity, status)
     VALUES (?, ?, ?, ?)`
  ).run(vehicleId, String(faultDescription).trim(), severity, status);
  const entry = db.prepare('SELECT * FROM diagnostic_entries WHERE id = ?').get(result.lastInsertRowid);

  return res.status(201).json({ entry });
});

// Edit a diagnostic entry by appending a new version that supersedes the original
// (append-only trail: the old row is kept as-is, so history is never rewritten).
router.put('/diagnostics/:id', requireAccount, (req, res) => {
  if (req.account.role !== 'mechanic') {
    return denyAccess(req, res, 'Only mechanic accounts can edit diagnostic entries.');
  }

  const { faultDescription, severity, status } = req.body;
  if (!String(faultDescription || '').trim() || !severity || !status) {
    return res.status(400).json({ error: 'Fault description, severity and status are required.' });
  }
  if (!VALID_SEVERITIES.includes(severity) || !VALID_DIAGNOSTIC_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid severity or diagnostic status.' });
  }

  const db = getDb();
  const original = db.prepare('SELECT * FROM diagnostic_entries WHERE id = ?').get(req.params.id);
  if (!original) return res.status(404).json({ error: 'Diagnostic entry not found.' });

  // Chain edits back to the root entry rather than the most recent edit.
  const rootId = original.supersedes_entry_id || original.id;

  const result = db.prepare(
    `INSERT INTO diagnostic_entries (vehicle_id, fault_description, severity, status, supersedes_entry_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run(original.vehicle_id, String(faultDescription).trim(), severity, status, rootId);
  const entry = db.prepare('SELECT * FROM diagnostic_entries WHERE id = ?').get(result.lastInsertRowid);

  return res.json({ entry });
});

module.exports = router;