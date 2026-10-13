const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

// Smoke test: starts the real server (server.js) on a spare port with a throwaway
// database and checks that the essentials respond. Run with `npm run smoke`.
// It is not named *.test.js, so `npm test` does not pick it up.

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-test-'));

let server;
let baseUrl;
let serverLog = '';

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

async function waitForHealth(timeoutMs = 15_000) {
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
  throw new Error(`The server did not start.\n${serverLog}`);
}

test.before(async () => {
  const port = await findFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: path.join(tempDir, 'smoke.db'),
      NODE_ENV: 'test',
    },
  });
  server.stdout.on('data', (chunk) => { serverLog += chunk; });
  server.stderr.on('data', (chunk) => { serverLog += chunk; });
  await waitForHealth();
});

test.after(async () => {
  if (server.exitCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill();
    await exited;
  }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('health endpoint reports ok', async () => {
  const response = await fetch(`${baseUrl}/api/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('the portal page is served', async () => {
  const response = await fetch(`${baseUrl}/`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
});

test('unknown API addresses return a JSON 404', async () => {
  const response = await fetch(`${baseUrl}/api/does-not-exist`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Not found.' });
});

test('protected routes refuse requests with no token', async () => {
  const response = await fetch(`${baseUrl}/api/auth/session`);

  assert.equal(response.status, 401);
});

test('a demo account can log in', async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'customer1', password: '123' }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.account.role, 'customer');
  assert.equal(typeof body.token, 'string');
});
