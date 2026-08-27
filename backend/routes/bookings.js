const express = require('express');
const { getDb } = require('../db/db');

const router = express.Router();

const VALID_SERVICE_TYPES = ['basic_service', 'full_service', 'wof'];
const CANCELLATION_WINDOW_HOURS = 24;

function generateConfirmationRef() {
  return `REF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

/**
 * GET /api/bookings/customer/:customerId
 * Lists all bookings across a customer's vehicles (used for the cancel-a-booking screen).
 */
router.get('/customer/:customerId', (req, res) => {
  const db = getDb();
  const { customerId } = req.params;

  const bookings = db
    .prepare(
      `SELECT bookings.*, vehicles.plate, vehicles.make, vehicles.model
       FROM bookings
       JOIN vehicles ON vehicles.id = bookings.vehicle_id
       WHERE vehicles.customer_id = ?
       ORDER BY datetime(bookings.slot_start) DESC`
    )
    .all(customerId);

  res.json({ bookings });
});

/**
 * POST /api/bookings
 * Body: { vehicleId, serviceType, slotStart }
 *
 * Acceptance criteria covered:
 *  - "An authenticated customer can confirm a booking when the selected
 *     vehicle, service type, and time slot are all valid and available."
 *  - "A confirmation reference is returned within 3 seconds of a successful booking."
 *  - "A booking request for an invalid or unavailable vehicle/service type
 *     combination is rejected with a stated reason."
 *  - Concurrency scenario: "no more than one booking is confirmed" when two
 *    requests race for the same slot - enforced by the unique index in db.js,
 *    not just an application-level check (a plain SELECT-then-INSERT would
 *    have a race condition; the DB constraint closes that gap).
 */
router.post('/', (req, res) => {
  const db = getDb();
  const { vehicleId, serviceType, slotStart } = req.body;

  if (!vehicleId || !serviceType || !slotStart) {
    return res.status(400).json({ error: 'vehicleId, serviceType and slotStart are all required.' });
  }

  if (!VALID_SERVICE_TYPES.includes(serviceType)) {
    return res.status(400).json({ error: `Invalid service type. Must be one of: ${VALID_SERVICE_TYPES.join(', ')}` });
  }

  const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicleId);
  if (!vehicle) {
    return res.status(400).json({ error: 'Selected vehicle does not exist.' });
  }

  const confirmationRef = generateConfirmationRef();

  try {
    const result = db
      .prepare(
        `INSERT INTO bookings (vehicle_id, service_type, slot_start, status, confirmation_ref)
         VALUES (?, ?, ?, 'confirmed', ?)`
      )
      .run(vehicleId, serviceType, slotStart, confirmationRef);

    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({ booking });
  } catch (err) {
    // SQLITE_CONSTRAINT fires when the unique index on confirmed slot_start is violated
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.code === 'SQLITE_CONSTRAINT') {
      return res.status(409).json({ error: 'That time slot is no longer available. Please choose another slot.' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Unexpected error while creating the booking.' });
  }
});

/**
 * POST /api/bookings/:id/cancel
 *
 * Acceptance criteria covered:
 *  - GIVEN a booking is scheduled, WHEN cancellation is requested less than
 *    24 hours before the booking time (inclusive), THEN it is rejected with
 *    an error message.
 *  - GIVEN a booking is scheduled, WHEN cancellation is requested 24 hours
 *    or more before the booking time, THEN the booking is removed and the
 *    mechanic is notified (notification is mocked here with a console.log
 *    and a `mechanicNotified` flag - swap in real email later).
 *  - A cancellation request for a booking that does not exist, or has
 *    already been cancelled, is rejected with a stated reason.
 */
router.post('/:id/cancel', (req, res) => {
  const db = getDb();
  const { id } = req.params;

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);

  if (!booking) {
    return res.status(404).json({ error: 'Booking not found.' });
  }
  if (booking.status === 'cancelled') {
    return res.status(400).json({ error: 'This booking has already been cancelled.' });
  }

  const slotTime = new Date(booking.slot_start.replace(' ', 'T'));
  const now = new Date();
  const hoursUntilBooking = (slotTime - now) / (1000 * 60 * 60);

  if (hoursUntilBooking < CANCELLATION_WINDOW_HOURS) {
    return res.status(400).json({
      error: `Bookings cannot be cancelled within ${CANCELLATION_WINDOW_HOURS} hours of the booking time.`,
    });
  }

  db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`).run(id);

  // Mocked mechanic notification - replace with real email service later.
  console.log(`[MOCK EMAIL] Notifying mechanic: booking #${id} (ref ${booking.confirmation_ref}) was cancelled.`);

  return res.json({ message: 'Booking cancelled.', mechanicNotified: true });
});

module.exports = router;
