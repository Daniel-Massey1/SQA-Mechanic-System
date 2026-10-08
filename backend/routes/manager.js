const express = require('express');
const { getDb } = require('../db/db');
const { requireAccount, denyAccess } = require('../auth');
const { hashPassword } = require('../passwords');
const {
  addDays,
  isValidDateString,
  workshopClock,
  workshopLocalToUtc,
} = require('../services/workshopTime');
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

// --- Quality dashboard (FR11-FR17) -----------------------------------------

const DEFAULT_RANGE_DAYS = 30;

/**
 * Resolves ?from=YYYY-MM-DD&to=YYYY-MM-DD (workshop-local dates, inclusive) into
 * UTC bounds. Defaults to the last 30 days including today.
 * Returns { error } for invalid input.
 */
function resolveDateRange(query) {
  const today = workshopClock().date;
  const to = query.to || today;
  const from = query.from || addDays(to, -(DEFAULT_RANGE_DAYS - 1));
  if (!isValidDateString(from) || !isValidDateString(to)) {
    return { error: 'Dates must be valid and in YYYY-MM-DD format.' };
  }
  if (from > to) {
    return { error: 'The start date must be on or before the end date.' };
  }
  return {
    from,
    to,
    startUtc: workshopLocalToUtc(from).toISOString(),
    // Exclusive end: the start of the day after `to`.
    endUtc: workshopLocalToUtc(addDays(to, 1)).toISOString(),
  };
}

// Repair time runs from the booked slot to completion. A job finished before its
// booked time counts as 0 rather than a negative duration (team decision for D16).
function repairMinutes(slotStart, completedAt) {
  const start = workshopLocalToUtc(slotStart);
  const end = new Date(completedAt);
  if (!start || Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.round((end - start) / (1000 * 60)));
}

// Completed jobs in the range, optionally for one mechanic, newest first.
function getCompletedJobs(db, range, mechanic) {
  return db.prepare(
    `SELECT jobs.id AS job_id, jobs.mechanic_name, jobs.status AS job_status,
            jobs.checklist_compliant, jobs.completion_percent,
            bookings.id AS booking_id, bookings.service_type, bookings.slot_start,
            bookings.completed_at, bookings.confirmation_ref,
            vehicles.plate, vehicles.make, vehicles.model,
            customers.name AS customer_name
     FROM jobs
     JOIN bookings ON bookings.id = jobs.booking_id
     JOIN vehicles ON vehicles.id = bookings.vehicle_id
     JOIN customers ON customers.id = vehicles.customer_id
     WHERE bookings.completed_at >= ? AND bookings.completed_at < ?
       ${mechanic ? 'AND jobs.mechanic_name = ?' : ''}
     ORDER BY bookings.completed_at DESC`
  ).all(range.startUtc, range.endUtc, ...(mechanic ? [mechanic] : []));
}

function percent(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

/**
 * GET /api/manager/dashboard?mechanic=<username>&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Summary cards for jobs completed in the date range (bookings decided in the
 * range for the acceptance rate):
 *  - totalCompletedJobs (FR11)
 *  - averageRepairTimeHours: booked slot to completion (FR13)
 *  - acceptanceRatePercent: approved / decided requests (FR14)
 *  - checklistCompliancePercent: compliant jobs / completed jobs (FR15)
 *  - incompleteChecklistCount: completed jobs with unticked items (FR16)
 *  - averageChecklistCompletionPercent: mean stored completion % (AC18, AC19)
 * All can be filtered to one mechanic (FR17).
 */
router.get('/dashboard', (req, res) => {
  const range = resolveDateRange(req.query);
  if (range.error) return res.status(400).json({ error: range.error });

  const db = getDb();
  const mechanic = req.query.mechanic || null;
  const jobs = getCompletedJobs(db, range, mechanic);

  const totalCompletedJobs = jobs.length;
  const compliantJobs = jobs.filter((job) => job.checklist_compliant === 1).length;
  const durations = jobs
    .map((job) => repairMinutes(job.slot_start, job.completed_at))
    .filter((minutes) => minutes !== null);
  const averageRepairTimeHours = durations.length > 0
    ? Math.round((durations.reduce((sum, minutes) => sum + minutes, 0) / durations.length / 60) * 10) / 10
    : null;
  const averageChecklistCompletionPercent = totalCompletedJobs > 0
    ? Math.round(jobs.reduce((sum, job) => sum + job.completion_percent, 0) / totalCompletedJobs)
    : null;

  // A request counts as approved if it was not denied (approved bookings may since
  // have been completed or cancelled).
  const decided = db.prepare(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'denied' THEN 0 ELSE 1 END) AS approved
     FROM bookings
     WHERE decided_at >= ? AND decided_at < ?
       ${mechanic ? 'AND decided_by = ?' : ''}`
  ).get(range.startUtc, range.endUtc, ...(mechanic ? [mechanic] : []));

  return res.json({
    mechanics: getKnownMechanics(db),
    selectedMechanic: mechanic,
    range: { from: range.from, to: range.to },
    totals: {
      totalCompletedJobs,
      incompleteChecklistCount: totalCompletedJobs - compliantJobs,
      averageRepairTimeHours,
      acceptanceRatePercent: percent(decided.approved || 0, decided.total),
      checklistCompliancePercent: percent(compliantJobs, totalCompletedJobs),
      averageChecklistCompletionPercent,
    },
  });
});

// Completed jobs for the dashboard's job list, using the same filters as the cards.
router.get('/jobs', (req, res) => {
  const range = resolveDateRange(req.query);
  if (range.error) return res.status(400).json({ error: range.error });

  const jobs = getCompletedJobs(getDb(), range, req.query.mechanic || null);
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
  const items = checklist ? JSON.parse(checklist.items_json) : [];
  // Jobs saved before ticks were recorded only ever saved with every item ticked.
  const ticked = job.completed_items_json ? JSON.parse(job.completed_items_json) : items;

  const slotStart = workshopLocalToUtc(job.slot_start);
  const completedAt = job.completed_at ? new Date(job.completed_at) : null;

  return res.json({
    job: {
      ...job,
      checklistItems: items.map((item) => ({ item, completed: ticked.includes(item) })),
      checklistVersion: checklist?.version ?? null,
      completionPercent: job.completion_percent,
      durationMinutes: job.completed_at ? repairMinutes(job.slot_start, job.completed_at) : null,
      completedEarly: Boolean(slotStart && completedAt && completedAt < slotStart),
    },
  });
});

module.exports = router;