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
      status TEXT NOT NULL DEFAULT 'confirmed', -- 'confirmed' | 'cancelled'
      confirmation_ref TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
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
      FOREIGN KEY (booking_id) REFERENCES bookings(id),
      FOREIGN KEY (checklist_id) REFERENCES checklists(id)
    );
  `);

  const bookingColumns = db.prepare('PRAGMA table_info(bookings)').all();
  if (!bookingColumns.some((column) => column.name === 'notes')) {
    db.exec("ALTER TABLE bookings ADD COLUMN notes TEXT NOT NULL DEFAULT ''");
  }

  seedIfEmpty();

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
  const v2 = insertVehicle.run(c1, 'XYZ789', 'Mazda', '3', '2026-12-01').lastInsertRowid;

  const insertDiag = db.prepare(
    `INSERT INTO diagnostic_entries (vehicle_id, fault_description, severity, status, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  insertDiag.run(v1, 'Front brake pads worn to 20%', 'medium', 'fixed', '2026-05-01 10:00:00');
  insertDiag.run(v1, 'Slight oil seep from valve cover gasket - not urgent', 'low', 'flagged_for_next_visit', '2026-05-01 10:05:00');
  insertDiag.run(v1, 'Replaced cabin air filter', 'low', 'fixed', '2026-07-15 09:30:00');
  insertDiag.run(v2, 'Battery terminal corrosion cleaned', 'low', 'fixed', '2026-06-20 14:00:00');

  const insertBooking = db.prepare(
    `INSERT INTO bookings (vehicle_id, service_type, slot_start, status, confirmation_ref)
     VALUES (?, ?, ?, ?, ?)`
  );
  insertBooking.run(v1, 'basic_service', '2026-09-05 09:00:00', 'confirmed', 'REF-SEED-0001');

  console.log('Database seeded with sample customers, vehicles, bookings and history.');
}

module.exports = { getDb };
