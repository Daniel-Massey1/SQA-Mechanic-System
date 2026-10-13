const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

// Performance test for NFR03 / AC11: with 20 concurrent users, at least 95% of
// vehicle history requests must finish within 2 seconds. Run with `npm run perf`.
// It starts the real server on a spare port with a throwaway database, so it never
// touches portal.db. It is a one-off measurement, not part of `npm test` or CI.

const USERS = Number(process.env.PERF_USERS) || 20;
const DURATION_SECONDS = Number(process.env.PERF_SECONDS) || 10;
const LIMIT_MS = 2000;
const REQUIRED_PERCENT = 95;
const VEHICLES = 50;
const ENTRIES_PER_VEHICLE = 30;

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-test-'));
process.env.DB_PATH = path.join(tempDir, 'perf.db');
process.env.NODE_ENV = 'test';

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// Fills the database with a realistic amount of history, then closes it so the server can open it.
function seedHistory() {
  const { getDb } = require('./db/db');
  const db = getDb();
  const customerId = db.prepare('SELECT id FROM customers LIMIT 1').get().id;
  const insertVehicle = db.prepare(
    'INSERT INTO vehicles (customer_id, plate, make, model) VALUES (?, ?, ?, ?)'
  );
  const insertEntry = db.prepare(
    'INSERT INTO diagnostic_entries (vehicle_id, fault_description, severity, status) VALUES (?, ?, ?, ?)'
  );

  const vehicleIds = [];
  db.transaction(() => {
    for (let v = 1; v <= VEHICLES; v += 1) {
      const plate = `PERF${String(v).padStart(3, '0')}`;
      const vehicleId = insertVehicle.run(customerId, plate, 'Toyota', 'Corolla').lastInsertRowid;
      vehicleIds.push(vehicleId);
      for (let e = 1; e <= ENTRIES_PER_VEHICLE; e += 1) {
        insertEntry.run(vehicleId, `Performance test entry ${e} for ${plate}`, 'low', 'fixed');
      }
    }
  })();
  db.close();
  return vehicleIds;
}

async function waitForHealth(server, baseUrl, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && server.exitCode === null) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('The server did not start.');
}

async function logIn(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'mechanic1', password: '123' }),
  });
  if (!response.ok) throw new Error(`Login failed with status ${response.status}.`);
  return (await response.json()).token;
}

// One simulated user: requests a random vehicle's history again and again until time is up.
// Each request is timed from sending it to having read the whole response.
async function runUser(baseUrl, token, vehicleIds, stopAt, results) {
  while (Date.now() < stopAt) {
    const vehicleId = vehicleIds[Math.floor(Math.random() * vehicleIds.length)];
    const started = performance.now();
    let ok = false;
    try {
      const response = await fetch(`${baseUrl}/api/vehicles/${vehicleId}/history`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json();
      ok = response.ok && body.history.length === ENTRIES_PER_VEHICLE;
    } catch {
      ok = false;
    }
    results.push({ ms: performance.now() - started, ok });
  }
}

function percentile(sortedTimes, percent) {
  return sortedTimes[Math.max(0, Math.ceil((percent / 100) * sortedTimes.length) - 1)];
}

async function main() {
  const vehicleIds = seedHistory();
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });

  let passed = false;
  try {
    await waitForHealth(server, baseUrl);
    const token = await logIn(baseUrl);

    const results = [];
    const stopAt = Date.now() + DURATION_SECONDS * 1000;
    const users = [];
    for (let u = 0; u < USERS; u += 1) users.push(runUser(baseUrl, token, vehicleIds, stopAt, results));
    await Promise.all(users);

    const times = results.map((result) => result.ms).sort((a, b) => a - b);
    const errors = results.filter((result) => !result.ok).length;
    const withinLimit = results.filter((result) => result.ok && result.ms <= LIMIT_MS).length;
    const percentWithinLimit = (withinLimit / results.length) * 100;
    passed = errors === 0 && percentWithinLimit >= REQUIRED_PERCENT;

    console.log('Vehicle history performance test (NFR03 / AC11)');
    console.log('------------------------------------------------');
    console.log(`Concurrent users:        ${USERS}`);
    console.log(`Test length:             ${DURATION_SECONDS} seconds`);
    console.log(`Test data:               ${VEHICLES} vehicles, ${ENTRIES_PER_VEHICLE} history entries each`);
    console.log(`Requests completed:      ${results.length}`);
    console.log(`Failed requests:         ${errors}`);
    console.log(`Fastest:                 ${times[0].toFixed(1)} ms`);
    console.log(`Median:                  ${percentile(times, 50).toFixed(1)} ms`);
    console.log(`95th percentile:         ${percentile(times, 95).toFixed(1)} ms`);
    console.log(`Slowest:                 ${times[times.length - 1].toFixed(1)} ms`);
    console.log(`Within ${LIMIT_MS} ms:          ${percentWithinLimit.toFixed(2)}% (required: ${REQUIRED_PERCENT}%)`);
    console.log('------------------------------------------------');
    console.log(`Result:                  ${passed ? 'PASS' : 'FAIL'}`);
  } finally {
    if (server.exitCode === null) {
      const exited = new Promise((resolve) => server.once('exit', resolve));
      server.kill();
      await exited;
    }
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  process.exitCode = passed ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
