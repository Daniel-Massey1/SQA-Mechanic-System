const express = require('express');
const { getDb } = require('../db/db');
const { requireAccount } = require('../auth');

const router = express.Router();
const VALID_SEVERITIES = ['low', 'medium', 'high'];
const VALID_DIAGNOSTIC_STATUSES = ['fixed', 'flagged_for_next_visit'];
const VALID_CHECKLIST_SERVICE_TYPES = ['basic_service', 'full_service', 'wof'];

// Return approval requests and checklist templates for mechanics.
router.get('/dashboard', requireAccount, (req, res) => {
  if (req.account.role !== 'mechanic') {
    return res.status(403).json({ error: 'Only mechanic accounts can view the mechanic portal.' });
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
  const checklists = db.prepare('SELECT * FROM checklists ORDER BY service_type').all().map((checklist) => ({
    ...checklist,
    items: JSON.parse(checklist.items_json),
  }));

  return res.json({ pendingBookings, checklists });
});

// Return confirmed appointments for the mechanic's schedule.
router.get('/upcoming', requireAccount, (req, res) => {
  if (req.account.role !== 'mechanic') {
    return res.status(403).json({ error: 'Only mechanic accounts can view upcoming bookings.' });
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
    return res.status(403).json({ error: 'Only mechanic accounts can view completed bookings.' });
  }

  const bookings = getDb().prepare(
    `SELECT bookings.*, vehicles.plate, vehicles.make, vehicles.model, customers.name AS customer_name
     FROM bookings
     JOIN vehicles ON vehicles.id = bookings.vehicle_id
     JOIN customers ON customers.id = vehicles.customer_id
     WHERE bookings.status = 'completed'
     ORDER BY datetime(bookings.completed_at) DESC`
  ).all();

  return res.json({ bookings });
});

// Return items for the service checklist selected by a mechanic.
router.get('/checklists/:serviceType', requireAccount, (req, res) => {
  if (req.account.role !== 'mechanic') {
    return res.status(403).json({ error: 'Only mechanic accounts can view service checklists.' });
  }
  if (!VALID_CHECKLIST_SERVICE_TYPES.includes(req.params.serviceType)) {
    return res.status(400).json({ error: 'Choose a valid service type.' });
  }

  const checklist = getDb().prepare(
    'SELECT * FROM checklists WHERE service_type = ?'
  ).get(req.params.serviceType);
  if (!checklist) return res.status(404).json({ error: 'Checklist not found.' });

  return res.json({ checklist: { ...checklist, items: JSON.parse(checklist.items_json) } });
});

// Save a compliant job after every checklist item is completed.
router.post('/jobs/checklist-compliance', requireAccount, (req, res) => {
  if (req.account.role !== 'mechanic') {
    return res.status(403).json({ error: 'Only mechanic accounts can save checklist jobs.' });
  }

  const { bookingId, serviceType, completedItems } = req.body;
  if (!Number.isInteger(Number(bookingId)) || !VALID_CHECKLIST_SERVICE_TYPES.includes(serviceType)) {
    return res.status(400).json({ error: 'Booking and service type are required.' });
  }

  const db = getDb();
  const booking = db.prepare("SELECT id FROM bookings WHERE id = ? AND status = 'confirmed'").get(bookingId);
  if (!booking) return res.status(400).json({ error: 'Choose a confirmed booking.' });

  const checklist = db.prepare('SELECT * FROM checklists WHERE service_type = ?').get(serviceType);
  const items = checklist ? JSON.parse(checklist.items_json) : [];
  const everyItemCompleted = Array.isArray(completedItems)
    && completedItems.length === items.length
    && items.every((item) => completedItems.includes(item));
  if (!checklist || !everyItemCompleted) {
    return res.status(400).json({ error: 'Complete every checklist item before saving.' });
  }

  // Save the job and booking completion together.
  const completeBooking = db.transaction(() => {
    const job = db.prepare(
      `INSERT INTO jobs (booking_id, mechanic_name, checklist_id, checklist_compliant, status)
       VALUES (?, ?, ?, 1, 'Checklist Compliant')`
    ).run(bookingId, req.account.username, checklist.id);
    db.prepare(
      `UPDATE bookings
       SET status = 'completed', completed_at = datetime('now'),
           customer_notification = 'Your vehicle service has been completed.'
       WHERE id = ?`
    ).run(bookingId);
    return job.lastInsertRowid;
  });
  const jobId = completeBooking();

  console.log(`[MOCK EMAIL] Notifying customer: booking #${bookingId} has been completed.`);
  return res.status(201).json({ jobId, status: 'Checklist Compliant', bookingStatus: 'completed' });
});

// Let mechanics approve or deny a pending request.
router.post('/bookings/:id/decision', requireAccount, (req, res) => {
  if (req.account.role !== 'mechanic') {
    return res.status(403).json({ error: 'Only mechanic accounts can approve or deny bookings.' });
  }

  const { decision } = req.body;
  if (!['approve', 'deny'].includes(decision)) {
    return res.status(400).json({ error: 'Decision must be approve or deny.' });
  }

  const db = getDb();
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  if (booking.status !== 'pending') {
    return res.status(400).json({ error: 'Only pending bookings can be approved or denied.' });
  }

  // Approved bookings reserve the appointment slot.
  const status = decision === 'approve' ? 'confirmed' : 'denied';
  try {
    db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, booking.id);
    return res.json({ message: `Booking ${status}.`, status });
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
    return res.status(403).json({ error: 'Only mechanic accounts can add diagnostic entries.' });
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

module.exports = router;