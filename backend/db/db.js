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
 *   - users                (persistent login accounts and assigned roles)
 */

const Database = require('better-sqlite3');
const path = require('path');
const { hashPassword, verifyPassword } = require('../passwords');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'portal.db');

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

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('customer', 'mechanic', 'manager')),
      display_name TEXT NOT NULL,
      email TEXT UNIQUE,
      customer_id INTEGER UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      plate TEXT NOT NULL UNIQUE,
      make TEXT NOT NULL,
      model TEXT NOT NULL,
      wof_expiry TEXT,              -- ISO date string, e.g. '2026-09-10'
      service_due TEXT,             -- ISO date string for the next scheduled service
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
      cancelled_at TEXT,                -- ISO timestamp; cancelled bookings are kept for auditing
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

    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_slot
      ON bookings (slot_start)
      WHERE status IN ('pending', 'confirmed');

    -- Outbox for every (mocked) email the system sends. Messages are queued first
    -- and delivered by services/notifications.js, so failed sends can be retried
    -- and every notification leaves an auditable record.
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,               -- 'wof_reminder' | 'service_reminder' | 'booking_decision' | 'booking_cancelled' | 'booking_completed'
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      dedupe_key TEXT UNIQUE,           -- stops the same reminder being queued twice
      booking_id INTEGER,
      vehicle_id INTEGER,
      status TEXT NOT NULL DEFAULT 'queued', -- 'queued' | 'sent' | 'failed'
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,         -- ISO timestamps (UTC)
      next_attempt_at TEXT NOT NULL,
      sent_at TEXT,
      last_error TEXT
    );

    -- Versioned checklist templates: managers' edits add a new version row
    -- (see services/checklists.js), so jobs keep the version they were done with.
    CREATE TABLE IF NOT EXISTS checklists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_type TEXT NOT NULL,
      items_json TEXT NOT NULL,         -- JSON array of checklist item strings
      version INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,                  -- manager username; NULL for the original seeded template
      created_at TEXT                   -- ISO timestamp; NULL for the original seeded template
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
  if (!bookingColumns.some((column) => column.name === 'cancelled_at')) {
    db.exec('ALTER TABLE bookings ADD COLUMN cancelled_at TEXT');
  }
  const vehicleColumns = db.prepare('PRAGMA table_info(vehicles)').all();
  if (!vehicleColumns.some((column) => column.name === 'service_due')) {
    db.exec('ALTER TABLE vehicles ADD COLUMN service_due TEXT');
  }
  const checklistColumns = db.prepare('PRAGMA table_info(checklists)').all();
  if (!checklistColumns.some((column) => column.name === 'version')) {
    db.exec('ALTER TABLE checklists ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
  }
  if (!checklistColumns.some((column) => column.name === 'created_by')) {
    db.exec('ALTER TABLE checklists ADD COLUMN created_by TEXT');
  }
  if (!checklistColumns.some((column) => column.name === 'created_at')) {
    db.exec('ALTER TABLE checklists ADD COLUMN created_at TEXT');
  }
  // Two managers saving at once cannot both create the same version number.
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_checklist_version ON checklists (service_type, version)');
  const jobColumns = db.prepare('PRAGMA table_info(jobs)').all();
  if (!jobColumns.some((column) => column.name === 'status')) {
    db.exec("ALTER TABLE jobs ADD COLUMN status TEXT NOT NULL DEFAULT 'In Progress'");
  }
  db.prepare("UPDATE bookings SET booked_by = 'customer1' WHERE booked_by = ''").run();

  if (process.env.NODE_ENV === 'production') {
    seedProductionManager();
    rejectDefaultProductionCredentials();
  } else {
    seedIfEmpty();
    seedDemoAccounts();
  }
  // Add standard checklists the first time the database is used.
  seedChecklistsIfEmpty();
  // Upgrade only the original short sample checklists.
  updateSampleChecklists();

  return db;
}

function seedProductionManager() {
  const managerCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'manager'").get().n;
  if (managerCount > 0) return;

  // Bootstrap exactly one production manager from deployment secrets; never insert demo credentials.
  const username = process.env.INITIAL_MANAGER_USERNAME?.trim().toLowerCase();
  const password = process.env.INITIAL_MANAGER_PASSWORD;
  const displayName = process.env.INITIAL_MANAGER_NAME?.trim() || 'Workshop Manager';
  if (!/^[a-z0-9._-]{3,30}$/.test(username || '') || typeof password !== 'string'
    || password.length < 16 || password.length > 128) {
    throw new Error('Production requires INITIAL_MANAGER_USERNAME and an INITIAL_MANAGER_PASSWORD of 16 to 128 characters until a manager exists.');
  }

  db.prepare(
    `INSERT INTO users (username, password_hash, role, display_name)
     VALUES (?, ?, 'manager', ?)`
  ).run(username, hashPassword(password), displayName);
}

function rejectDefaultProductionCredentials() {
  const knownDefaults = [
    ['customer1', '123'],
    ['customer2', '123'],
    ['mechanic1', '123'],
    ['manager1', '123'],
  ];
  const findUser = db.prepare('SELECT password_hash FROM users WHERE username = ?');
  for (const [username, password] of knownDefaults) {
    const user = findUser.get(username);
    if (user && verifyPassword(password, user.password_hash)) {
      throw new Error(`Production account ${username} still uses a demo password. Remove or reset it before starting the service.`);
    }
  }
}

function seedDemoAccounts() {
  // Persist completion so manager-deleted demo accounts are not recreated after restart.
  const seeded = db.prepare("SELECT value FROM app_metadata WHERE key = 'demo_accounts_seeded'").get();
  if (seeded) return;

  const insertUser = db.prepare(
    `INSERT OR IGNORE INTO users (username, password_hash, role, display_name, email, customer_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const demoAccounts = [
    { username: 'customer1', password: '123', role: 'customer', displayName: 'Jane Smith', email: 'jane@example.com' },
    { username: 'customer2', password: '123', role: 'customer', displayName: 'Tom Reid', email: 'tom@example.com' },
    { username: 'mechanic1', password: '123', role: 'mechanic', displayName: 'Demo Mechanic', email: null },
    { username: 'manager1', password: '123', role: 'manager', displayName: 'Demo Manager', email: null },
  ];

  for (const account of demoAccounts) {
    let customerId = null;
    if (account.role === 'customer') {
      db.prepare('INSERT OR IGNORE INTO customers (name, email) VALUES (?, ?)')
        .run(account.displayName, account.email);
      customerId = db.prepare('SELECT id FROM customers WHERE email = ?').get(account.email).id;
    }
    insertUser.run(
      account.username,
      hashPassword(account.password),
      account.role,
      account.displayName,
      account.email,
      customerId
    );
  }

  db.prepare("INSERT INTO app_metadata (key, value) VALUES ('demo_accounts_seeded', '1')").run();
}

function seedIfEmpty() {
  const customerCount = db.prepare('SELECT COUNT(*) AS n FROM customers').get().n;
  if (customerCount > 0) return; // already seeded

  const insertCustomer = db.prepare('INSERT INTO customers (name, email) VALUES (?, ?)');
  const c1 = insertCustomer.run('Jane Smith', 'jane@example.com').lastInsertRowid;
  const c2 = insertCustomer.run('Tom Reid', 'tom@example.com').lastInsertRowid;

  const insertVehicle = db.prepare(
    'INSERT INTO vehicles (customer_id, plate, make, model, wof_expiry, service_due) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const v1 = insertVehicle.run(c1, 'ABC123', 'Toyota', 'Corolla', '2026-09-10', '2027-03-01').lastInsertRowid;
  const v2 = insertVehicle.run(c2, 'XYZ789', 'Toyota', 'Yaris', '2026-12-01', null).lastInsertRowid;

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
