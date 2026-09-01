/**
 * db.js
 *
 * Single shared SQLite database for the whole group project.
 * Everyone's backend routes (customer, mechanic, manager) should import
 * `getDb()` from this file rather than creating their own connection,
 * so we all read/write the same tables.
 *
 * Tables owned by the Customer Booking & Basic Portal module:
 *   - customers
 *   - vehicles
 *   - bookings
 *   - diagnostic_entries   (read-only from the customer side, written by mechanics later)
 *
 * Tables stubbed out for teammates to build on (kept here so the schema
 * is agreed up front - feel free to extend these columns as needed):
 *   - checklists           (mechanic side: configurable checklist templates)
 *   - jobs                 (mechanic side: a job = a booking being worked on)
 *   - users                (auth/role side: replace mocked roles with real login later)
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'portal.db');

let db;

function getDb() {
  if (db) return db;

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      plate TEXT NOT NULL UNIQUE,
      make TEXT NOT NULL,
      model TEXT NOT NULL,
      wof_expiry TEXT,              -- ISO date string, e.g. '2026-09-10'
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      service_type TEXT NOT NULL,       -- e.g. 'basic_service', 'full_service', 'wof'
      slot_start TEXT NOT NULL,         -- ISO datetime string
      status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'confirmed' | 'completed' | 'denied' | 'cancelled'
      confirmation_ref TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      customer_notification TEXT,
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    );

    -- Read here for vehicle history; mechanics will INSERT new rows later.
    CREATE TABLE IF NOT EXISTS diagnostic_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      fault_description TEXT NOT NULL,
      severity TEXT NOT NULL,           -- e.g. 'low' | 'medium' | 'high'
      status TEXT NOT NULL,             -- e.g. 'fixed' | 'flagged_for_next_visit'
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      supersedes_entry_id INTEGER,      -- append-only edit trail: points to the original entry
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
      FOREIGN KEY (supersedes_entry_id) REFERENCES diagnostic_entries(id)
    );

    -- Enforces "no double booking" at the database level: only one CONFIRMED
    -- booking can exist for a given slot_start, no matter how many requests
    -- race for it at the same time. This is what makes the concurrency
    -- acceptance criterion actually hold under load, not just in application code.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_confirmed_slot
      ON bookings (slot_start)
      WHERE status = 'confirmed';

    -- Stub tables for mechanic/manager sides. Left minimal on purpose.
    CREATE TABLE IF NOT EXISTS checklists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_type TEXT NOT NULL,
      items_json TEXT NOT NULL          -- JSON array of checklist item strings
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      mechanic_name TEXT,
      checklist_id INTEGER,
      checklist_compliant INTEGER DEFAULT 0, -- 0 = false, 1 = true
      status TEXT NOT NULL DEFAULT 'In Progress',
      FOREIGN KEY (booking_id) REFERENCES bookings(id),
      FOREIGN KEY (checklist_id) REFERENCES checklists(id)
    );
  `);

  const bookingColumns = db.prepare('PRAGMA table_info(bookings)').all();
  if (!bookingColumns.some((column) => column.name === 'notes')) {
    db.exec("ALTER TABLE bookings ADD COLUMN notes TEXT NOT NULL DEFAULT ''");
  }
  if (!bookingColumns.some((column) => column.name === 'booked_by')) {
    db.exec("ALTER TABLE bookings ADD COLUMN booked_by TEXT NOT NULL DEFAULT ''");
  }
  if (!bookingColumns.some((column) => column.name === 'completed_at')) {
    db.exec('ALTER TABLE bookings ADD COLUMN completed_at TEXT');
  }
  if (!bookingColumns.some((column) => column.name === 'customer_notification')) {
    db.exec('ALTER TABLE bookings ADD COLUMN customer_notification TEXT');
  }
  if (!bookingColumns.some((column) => column.name === 'decided_by')) {
    db.exec('ALTER TABLE bookings ADD COLUMN decided_by TEXT');
  }
  const jobColumns = db.prepare('PRAGMA table_info(jobs)').all();
  if (!jobColumns.some((column) => column.name === 'status')) {
    db.exec("ALTER TABLE jobs ADD COLUMN status TEXT NOT NULL DEFAULT 'In Progress'");
  }
  db.prepare("UPDATE bookings SET booked_by = 'customer1' WHERE booked_by = ''").run();

  seedIfEmpty();
  // Add standard checklists the first time the database is used.
  seedChecklistsIfEmpty();
  // Upgrade only the original short sample checklists.
  updateSampleChecklists();

  return db;
}

function seedIfEmpty() {
  const customerCount = db.prepare('SELECT COUNT(*) AS n FROM customers').get().n;
  if (customerCount > 0) return; // already seeded

  const insertCustomer = db.prepare('INSERT INTO customers (name, email) VALUES (?, ?)');
  const c1 = insertCustomer.run('Jane Smith', 'jane@example.com').lastInsertRowid;
  const c2 = insertCustomer.run('Tom Reid', 'tom@example.com').lastInsertRowid;

  const insertVehicle = db.prepare(
    'INSERT INTO vehicles (customer_id, plate, make, model, wof_expiry) VALUES (?, ?, ?, ?, ?)'
  );
  const v1 = insertVehicle.run(c1, 'ABC123', 'Toyota', 'Corolla', '2026-09-10').lastInsertRowid;
  const v2 = insertVehicle.run(c2, 'XYZ789', 'Toyota', 'Yaris', '2026-12-01').lastInsertRowid;

  const insertDiag = db.prepare(
    `INSERT INTO diagnostic_entries (vehicle_id, fault_description, severity, status, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  insertDiag.run(v1, 'Front brake pads worn to 20%', 'medium', 'fixed', '2026-05-01 10:00:00');
  insertDiag.run(v1, 'Slight oil seep from valve cover gasket - not urgent', 'low', 'flagged_for_next_visit', '2026-05-01 10:05:00');
  insertDiag.run(v1, 'Replaced cabin air filter', 'low', 'fixed', '2026-07-15 09:30:00');
  insertDiag.run(v2, 'Battery terminal corrosion cleaned', 'low', 'fixed', '2026-06-20 14:00:00');

  const insertBooking = db.prepare(
     `INSERT INTO bookings (vehicle_id, service_type, slot_start, status, confirmation_ref, booked_by)
      VALUES (?, ?, ?, ?, ?, ?)`
  );
    insertBooking.run(v1, 'basic_service', '2026-09-05 09:00:00', 'confirmed', 'REF-SEED-0001', 'customer1');

  console.log('Database seeded with sample customers, vehicles, bookings and history.');
}

function seedChecklistsIfEmpty() {
  const checklistCount = db.prepare('SELECT COUNT(*) AS n FROM checklists').get().n;
  if (checklistCount > 0) return;

  // Store each service checklist as a JSON array.
  const insertChecklist = db.prepare('INSERT INTO checklists (service_type, items_json) VALUES (?, ?)');
  insertChecklist.run('basic_service', JSON.stringify(getBasicServiceItems()));
  insertChecklist.run('full_service', JSON.stringify(getFullServiceItems()));
  insertChecklist.run('wof', JSON.stringify(getWofItems()));
}

function getBasicServiceItems() {
  // Standard checks for a routine basic service.
  return [
    'Drain and replace engine oil',
    'Replace engine oil filter',
    'Check brake pads, discs and fluid level',
    'Check tyre condition and pressure',
    'Check coolant, washer and power steering fluid levels',
    'Check exterior lights, wipers and horn',
    'Reset the service reminder',
  ];
}

function getFullServiceItems() {
  // Extra checks included in a full service.
  return [
    'Complete all basic service checks',
    'Replace engine oil and oil filter',
    'Inspect and replace air filter if required',
    'Inspect brake pads, discs, hoses and fluid condition',
    'Inspect steering, suspension and wheel bearings',
    'Check battery condition and charging system',
    'Inspect drive belts, exhaust system and underbody',
    'Check all fluid levels and coolant condition',
    'Check tyre condition, pressure and tread depth',
    'Road test vehicle and reset the service reminder',
  ];
}

function getWofItems() {
  // Main inspection areas used in a New Zealand WOF check.
  return [
    'Check tyres for tread depth, damage and legal fitment',
    'Check brakes, parking brake and brake warning systems',
    'Check headlights, indicators, brake lights and reflectors',
    'Check windscreen, windows, wipers and washers',
    'Check seat belts and restraint anchorages',
    'Check steering, suspension, wheel bearings and joints',
    'Check vehicle structure, chassis and body for corrosion',
    'Check exhaust system for damage, leaks and secure mounting',
    'Check fuel system for leaks and secure components',
    'Check doors, bonnet, boot and mirrors operate securely',
  ];
}

function updateSampleChecklists() {
  // These are the original placeholder checklist items.
  const oldBasicItems = JSON.stringify(['Check engine oil', 'Inspect brakes', 'Check tyre pressure']);
  const oldFullItems = JSON.stringify(['Change engine oil and filter', 'Inspect brakes and suspension', 'Check all fluid levels']);
  const oldWofItems = JSON.stringify(['Inspect lights and reflectors', 'Check tyres and brakes', 'Check seat belts and windscreen']);
  const updateChecklist = db.prepare('UPDATE checklists SET items_json = ? WHERE service_type = ? AND items_json = ?');

  // Only replace the original sample data, not custom checklist edits.
  updateChecklist.run(JSON.stringify(getBasicServiceItems()), 'basic_service', oldBasicItems);
  updateChecklist.run(JSON.stringify(getFullServiceItems()), 'full_service', oldFullItems);
  updateChecklist.run(JSON.stringify(getWofItems()), 'wof', oldWofItems);
}

module.exports = { getDb };
