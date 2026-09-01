const express = require('express');
const { getDb } = require('../db/db');
const { requireAccount } = require('../auth');

const router = express.Router();

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

module.exports = router;