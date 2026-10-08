const express = require('express');
const { getDb } = require('../db/db');
const { requireAccount, denyAccess } = require('../auth');
const { hashPassword } = require('../passwords');
const {
  SERVICE_TYPES,
  getLatestChecklist,
  listChecklistVersions,
  listLatestChecklists,
  validateChecklistItems,
} = require('../services/checklists');

const router = express.Router();

// Middleware to ensure the user is a manager
function requireManager(req, res, next) {
  if (req.account.role !== 'manager') {
    return denyAccess(req, res, 'Only manager accounts can view the manager dashboard.');
  }
  return next();
}

// Every route in this file is manager-only.
router.use(requireAccount, requireManager);

router.get('/accounts', (req, res) => {
  const accounts = getDb().prepare(
    `SELECT users.id, users.username, users.role, users.display_name, users.email, users.created_at
     FROM users
     WHERE users.role IN ('customer', 'mechanic')
     ORDER BY users.role, users.display_name COLLATE NOCASE, users.username COLLATE NOCASE`
  ).all();
  return res.json({ accounts });
});

router.post('/accounts/mechanics', (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';

  if (!/^[a-z0-9._-]{3,30}$/.test(username) || password.length < 8 || password.length > 128
    || displayName.length < 2 || displayName.length > 80) {
    return res.status(400).json({ error: 'Enter a valid name and username; passwords must be 8 to 128 characters.' });
  }

  const db = getDb();
  try {
    const result = db.prepare(
      `INSERT INTO users (username, password_hash, role, display_name)
       VALUES (?, ?, 'mechanic', ?)`
    ).run(username, hashPassword(password), displayName);
    const account = db.prepare(
      'SELECT id, username, role, display_name, email, created_at FROM users WHERE id = ?'
    ).get(result.lastInsertRowid);
    return res.status(201).json({ account });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === 'SQLITE_CONSTRAINT') {
      return res.status(409).json({ error: 'That username is already in use.' });
    }
    console.error(error);
    return res.status(500).json({ error: 'Unable to create the mechanic account.' });
  }
});

router.delete('/accounts/:accountId', (req, res) => {
  const accountId = Number(req.params.accountId);
  if (!Number.isSafeInteger(accountId) || accountId < 1) {
    return res.status(400).json({ error: 'Choose a valid account.' });
  }

  const db = getDb();
  const account = db.prepare(
    'SELECT id, role FROM users WHERE id = ?'
  ).get(accountId);
  if (!account || !['customer', 'mechanic'].includes(account.role)) {
    return res.status(404).json({ error: 'Customer or mechanic account not found.' });
  }

  // Remove login access only; customer and workshop records remain available for audit/history.
  db.prepare('DELETE FROM users WHERE id = ?').run(accountId);
  return res.json({ message: 'Account deleted. Associated service records were retained.' });
});

// --- Service checklist templates (NFR05) ---------------------------------

// Current version of every service type's checklist.
router.get('/checklists', (req, res) => {
  return res.json({ checklists: listLatestChecklists(getDb()) });
});

// Every version of one service type's checklist, newest first.
router.get('/checklists/:serviceType/versions', (req, res) => {
  if (!SERVICE_TYPES.includes(req.params.serviceType)) {
    return res.status(400).json({ error: 'Choose a valid service type.' });
  }
  return res.json({ versions: listChecklistVersions(getDb(), req.params.serviceType) });
});

/**
 * PUT /api/manager/checklists/:serviceType
 * Body: { items: string[], baseVersion: number }
 *
 * Saves the edited items as a new version; existing versions are never changed.
 * baseVersion is the version the manager opened - if someone else has saved since,
 * the request is rejected so their changes are not silently overwritten.
 */
router.put('/checklists/:serviceType', (req, res) => {
  const { serviceType } = req.params;
  if (!SERVICE_TYPES.includes(serviceType)) {
    return res.status(400).json({ error: 'Choose a valid service type.' });
  }

  const validation = validateChecklistItems(req.body?.items);
  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  const db = getDb();
  const saveVersion = db.transaction(() => {
    const current = getLatestChecklist(db, serviceType);
    if (!current) return { status: 404, error: 'Checklist not found.' };
    if (Number(req.body?.baseVersion) !== current.version) {
      return {
        status: 409,
        error: 'This checklist was changed by someone else since you opened it. Reload it and make your changes again.',
      };
    }
    if (JSON.stringify(current.items) === JSON.stringify(validation.items)) {
      return { status: 400, error: 'No changes to save.' };
    }

    const result = db.prepare(
      `INSERT INTO checklists (service_type, items_json, version, created_by, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(serviceType, JSON.stringify(validation.items), current.version + 1, req.account.username, new Date().toISOString());
    return { checklistId: result.lastInsertRowid };
  });

  try {
    const outcome = saveVersion();
    if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
    return res.json({ checklist: getLatestChecklist(db, serviceType) });
  } catch (error) {
    // The unique (service_type, version) index catches two saves landing at the same moment.
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === 'SQLITE_CONSTRAINT') {
      return res.status(409).json({
        error: 'This checklist was changed by someone else since you opened it. Reload it and make your changes again.',
      });
    }
    console.error(error);
    return res.status(500).json({ error: 'Unable to save the checklist.' });
  }
});

// Populates dashboard mechanic filter dropdown with distinct list of mechanic that approved, denied, completed booking
function getKnownMechanics(db) {
  const fromDecisions = db.prepare(
    `SELECT DISTINCT decided_by AS mechanic FROM bookings WHERE decided_by IS NOT NULL AND decided_by != ''`
  ).all();
  const fromJobs = db.prepare(
    `SELECT DISTINCT mechanic_name AS mechanic FROM jobs WHERE mechanic_name IS NOT NULL AND mechanic_name != ''`
  ).all();
  const names = new Set([...fromDecisions, ...fromJobs].map((row) => row.mechanic));
  return [...names].sort();
}

/**
 * GET /api/manager/dashboard?mechanic=<username>
 *
 * Summary cards:
 *  - 
 *  - 
 *  - 
 *  - 
 *  - 
 */
router.get('/dashboard', (req, res) => {
  const db = getDb();
  const mechanic = req.query.mechanic || null;

  // totalCompletedJobs - completed jobs (all jobs are compliant
  // since the checklist endpoint only ever saves a job once every item is checked)
  const jobParams = mechanic ? [mechanic] : [];
  const jobFilter = mechanic ? 'WHERE jobs.mechanic_name = ?' : '';
  const totalCompletedJobs = db.prepare(
    `SELECT COUNT(*) AS n FROM jobs ${jobFilter}`
  ).get(...jobParams).n;

  // incompleteChecklistCount - confirmed bookings that don't have a
  // completed job yet -> work that's still in progress
  const bookingFilter = mechanic ? 'AND bookings.decided_by = ?' : '';
  const incompleteChecklistCount = db.prepare(
    `SELECT COUNT(*) AS n FROM bookings
     WHERE bookings.status = 'confirmed' ${bookingFilter}`
  ).get(...(mechanic ? [mechanic] : [])).n;

  // averageRepairTimeMinutes - mean(completed_at - slot_start) across completed bookings
  const durationsQuery = mechanic
    ? `SELECT bookings.slot_start, bookings.completed_at
       FROM jobs
       JOIN bookings ON bookings.id = jobs.booking_id
       WHERE jobs.mechanic_name = ? AND bookings.completed_at IS NOT NULL`
    : `SELECT bookings.slot_start, bookings.completed_at
       FROM jobs
       JOIN bookings ON bookings.id = jobs.booking_id
       WHERE bookings.completed_at IS NOT NULL`;
  const durationsRows = db.prepare(durationsQuery).all(...jobParams);
  let averageRepairTimeMinutes = null;
  if (durationsRows.length > 0) {
    const totalMinutes = durationsRows.reduce((sum, row) => {
      const start = new Date(row.slot_start.replace(' ', 'T'));
      const end = new Date(row.completed_at.replace(' ', 'T'));
      return sum + (end - start) / (1000 * 60);
    }, 0);
    averageRepairTimeMinutes = Math.round(totalMinutes / durationsRows.length);
  }

  // acceptanceRatePercent - confirmed / (confirmed + denied) decided bookings
  const decidedFilter = mechanic ? 'AND decided_by = ?' : '';
  const decidedCounts = db.prepare(
    `SELECT status, COUNT(*) AS n FROM bookings
     WHERE status IN ('confirmed', 'completed', 'denied') ${decidedFilter}
     GROUP BY status`
  ).all(...(mechanic ? [mechanic] : []));
  const confirmedLike = decidedCounts
    .filter((row) => row.status === 'confirmed' || row.status === 'completed')
    .reduce((sum, row) => sum + row.n, 0);
  const denied = decidedCounts.find((row) => row.status === 'denied')?.n || 0;
  const totalDecided = confirmedLike + denied;
  const acceptanceRatePercent = totalDecided > 0
    ? Math.round((confirmedLike / totalDecided) * 100)
    : null;

    // checklistCompliancePercent - completed jobs / (completed jobs + incomplete)
  const complianceDenominator = totalCompletedJobs + incompleteChecklistCount;
  const checklistCompliancePercent = complianceDenominator > 0
    ? Math.round((totalCompletedJobs / complianceDenominator) * 100)
    : null;

  return res.json({
    mechanics: getKnownMechanics(db),
    selectedMechanic: mechanic,
    totals: {
      totalCompletedJobs,
      incompleteChecklistCount,
      averageRepairTimeMinutes,
      acceptanceRatePercent,
      checklistCompliancePercent,
    },
  });
});


// Gets list of completed jobs for dashboard's job list sorted by most recent first
router.get('/jobs', (req, res) => {
  const db = getDb();
  const mechanic = req.query.mechanic || null;

  const query = `
    SELECT jobs.id AS job_id, jobs.mechanic_name, jobs.status AS job_status,
           bookings.id AS booking_id, bookings.service_type, bookings.slot_start,
           bookings.completed_at, bookings.confirmation_ref,
           vehicles.plate, vehicles.make, vehicles.model,
           customers.name AS customer_name
    FROM jobs
    JOIN bookings ON bookings.id = jobs.booking_id
    JOIN vehicles ON vehicles.id = bookings.vehicle_id
    JOIN customers ON customers.id = vehicles.customer_id
    ${mechanic ? 'WHERE jobs.mechanic_name = ?' : ''}
    ORDER BY datetime(bookings.completed_at) DESC
  `;
  const jobs = mechanic ? db.prepare(query).all(mechanic) : db.prepare(query).all();

  return res.json({ jobs });
});


// Gets the full details for a single job
router.get('/jobs/:jobId', (req, res) => {
  const db = getDb();
  const job = db.prepare(
    `SELECT jobs.*, bookings.service_type, bookings.slot_start, bookings.completed_at,
            bookings.confirmation_ref, bookings.notes,
            vehicles.plate, vehicles.make, vehicles.model,
            customers.name AS customer_name
     FROM jobs
     JOIN bookings ON bookings.id = jobs.booking_id
     JOIN vehicles ON vehicles.id = bookings.vehicle_id
     JOIN customers ON customers.id = vehicles.customer_id
     WHERE jobs.id = ?`
  ).get(req.params.jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }

  // The job's own checklist version, so later template edits never change what is shown here.
  const checklist = db.prepare('SELECT * FROM checklists WHERE id = ?').get(job.checklist_id);
  // Every saved job passed every item on its checklist so the completed state is just "all"
  const items = checklist ? JSON.parse(checklist.items_json) : [];

  let durationMinutes = null;
  if (job.completed_at) {
    const start = new Date(job.slot_start.replace(' ', 'T'));
    const end = new Date(job.completed_at.replace(' ', 'T'));
    durationMinutes = Math.round((end - start) / (1000 * 60));
  }

  return res.json({
    job: {
      ...job,
      checklistItems: items.map((item) => ({ item, completed: true })),
      checklistVersion: checklist?.version ?? null,
      durationMinutes,
    },
  });
});

module.exports = router;