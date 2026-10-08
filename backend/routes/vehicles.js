const express = require('express');
const { getDb } = require('../db/db');
const { requireAccount, denyAccess } = require('../auth');

const { isValidDateString: isValidDate } = require('../services/workshopTime');

const router = express.Router();

// Return all vehicles for mechanic work and manager history review.
router.get('/all', requireAccount, (req, res) => {
  if (!['mechanic', 'manager'].includes(req.account.role)) {
    return denyAccess(req, res, 'Only mechanic and manager accounts can view all vehicles.');
  }

  const vehicles = getDb().prepare('SELECT * FROM vehicles ORDER BY plate').all();
  res.json({ vehicles });
});

/**
 * GET /api/vehicles/customer/:customerId
 * Returns all vehicles belonging to a customer, for the "select vehicle" step of booking.
 */
router.get('/customer/:customerId', requireAccount, (req, res) => {
  const db = getDb();
  const { customerId } = req.params;

  if (req.account.role === 'customer' && String(req.account.customerId) !== String(customerId)) {
    return denyAccess(req, res, 'You can only view vehicles belonging to your account.');
  }

  const vehicles = db
    .prepare('SELECT * FROM vehicles WHERE customer_id = ?')
    .all(customerId);

  res.json({ vehicles });
});

router.post('/', requireAccount, (req, res) => {
  if (req.account.role !== 'customer' || !Number.isInteger(req.account.customerId)) {
    return denyAccess(req, res, 'Only customer accounts can add vehicles.');
  }

  const plate = typeof req.body?.plate === 'string' ? req.body.plate.trim().toUpperCase() : '';
  const make = typeof req.body?.make === 'string' ? req.body.make.trim() : '';
  const model = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
  const wofExpiry = typeof req.body?.wofExpiry === 'string' ? req.body.wofExpiry.trim() : '';
  const serviceDue = typeof req.body?.serviceDue === 'string' ? req.body.serviceDue.trim() : '';

  if (!/^[A-Z0-9 -]{2,12}$/.test(plate) || make.length < 1 || make.length > 60
    || model.length < 1 || model.length > 60) {
    return res.status(400).json({ error: 'Enter a valid registration plate, make, and model.' });
  }
  if (wofExpiry && !isValidDate(wofExpiry)) {
    return res.status(400).json({ error: 'WOF expiry must be a valid date.' });
  }
  if (serviceDue && !isValidDate(serviceDue)) {
    return res.status(400).json({ error: 'Service due date must be a valid date.' });
  }

  try {
    const result = getDb().prepare(
      `INSERT INTO vehicles (customer_id, plate, make, model, wof_expiry, service_due)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(req.account.customerId, plate, make, model, wofExpiry || null, serviceDue || null);
    const vehicle = getDb().prepare('SELECT * FROM vehicles WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({ vehicle });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === 'SQLITE_CONSTRAINT') {
      return res.status(409).json({ error: 'A vehicle with that registration plate already exists.' });
    }
    console.error(error);
    return res.status(500).json({ error: 'Unable to add the vehicle.' });
  }
});

/**
 * GET /api/vehicles/:vehicleId/history
 *
 * Customers can view history for their own vehicles; mechanics and managers
 * can review any vehicle. Entries are ordered newest first, and an empty
 * history is returned as a stated empty state rather than an error.
 */
router.get('/:vehicleId/history', requireAccount, (req, res) => {
  const db = getDb();
  const { vehicleId } = req.params;

  const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicleId);
  if (!vehicle) {
    return res.status(404).json({ error: 'Vehicle not found.' });
  }
  if (req.account.role === 'customer' && String(req.account.customerId) !== String(vehicle.customer_id)) {
    return denyAccess(req, res, 'You can only view history for vehicles belonging to your account.');
  }

  // Every entry is returned (edits are never hidden or deleted); root_entry_id
  // groups a lineage together and is_superseded flags older, edited-over versions
  // so the frontend can collapse them into a dropdown instead of losing them.
  const history = db
    .prepare(
      `SELECT de.*,
              COALESCE(de.supersedes_entry_id, de.id) AS root_entry_id,
              EXISTS (
                SELECT 1 FROM diagnostic_entries de2
                WHERE COALESCE(de2.supersedes_entry_id, de2.id) = COALESCE(de.supersedes_entry_id, de.id)
                  AND de2.id > de.id
              ) AS is_superseded
       FROM diagnostic_entries de
       WHERE vehicle_id = ?
       ORDER BY datetime(created_at) DESC`
    )
    .all(vehicleId)
    .map((entry) => ({ ...entry, is_superseded: Boolean(entry.is_superseded) }));

  if (history.length === 0) {
    return res.json({ vehicle, history: [], message: 'No repair history recorded for this vehicle yet.' });
  }

  res.json({ vehicle, history });
});

module.exports = router;
