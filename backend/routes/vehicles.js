const express = require('express');
const { getDb } = require('../db/db');
const { requireAccount } = require('../auth');

const router = express.Router();

// Return all vehicles for mechanic work and manager history review.
router.get('/all', requireAccount, (req, res) => {
  if (!['mechanic', 'manager'].includes(req.account.role)) {
    return res.status(403).json({ error: 'Only mechanic and manager accounts can view all vehicles.' });
  }

  const vehicles = getDb().prepare('SELECT * FROM vehicles ORDER BY plate').all();
  res.json({ vehicles });
});

/**
 * GET /api/vehicles/customer/:customerId
 * Returns all vehicles belonging to a customer, for the "select vehicle" step of booking.
 */
router.get('/customer/:customerId', (req, res) => {
  const db = getDb();
  const { customerId } = req.params;

  const vehicles = db
    .prepare('SELECT * FROM vehicles WHERE customer_id = ?')
    .all(customerId);

  res.json({ vehicles });
});

/**
 * GET /api/vehicles/:vehicleId/history
 *
 * Acceptance criteria covered:
 *  - "A logged-in customer can view their full vehicle history, ordered most
 *     recent first, including past issues, fixes, and flagged future concerns."
 *  - "A customer with no recorded vehicle history sees a stated empty state
 *     rather than an error."
 */
router.get('/:vehicleId/history', (req, res) => {
  const db = getDb();
  const { vehicleId } = req.params;

  const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicleId);
  if (!vehicle) {
    return res.status(404).json({ error: 'Vehicle not found.' });
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
