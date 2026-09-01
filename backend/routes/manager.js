const express = require('express');
const { getDb } = require('../db/db');
const { requireAccount } = require('../auth');

const router = express.Router();

// Middleware to ensure the user is a manager
function requireManager(req, res, next) {
  if (req.account.role !== 'manager') {
    return res.status(403).json({ error: 'Only manager accounts can view the manager dashboard.' });
  }
  return next();
}

// Every route in this file is manager-only.
router.use(requireAccount, requireManager);

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
      durationMinutes,
    },
  });
});

module.exports = router;