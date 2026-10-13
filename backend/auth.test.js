const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

// Use a throwaway database so these tests never read or change the real portal.db (D14).
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-test-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');
process.env.NODE_ENV = 'test';

const {
  authenticateAccount,
  createAuthToken,
  denyAccess,
  requireAccount,
  verifyAuthToken,
} = require('./auth');
const { getDb } = require('./db/db');

test.after(() => {
  getDb().close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('requireAccount rejects and logs requests without a recognized account', (context) => {
  const messages = [];
  const originalWarn = console.warn;
  console.warn = (message) => messages.push(message);
  context.after(() => { console.warn = originalWarn; });

  const response = createResponse();
  const request = {
    method: 'GET',
    originalUrl: '/api/vehicles/customer/1',
    get: (name) => name === 'X-Mock-Username' ? 'manager1' : undefined,
  };

  requireAccount(request, response, () => assert.fail('next should not be called'));

  assert.equal(response.statusCode, 401);
  assert.match(messages[0], /ACCESS DENIED/);
  assert.match(messages[0], /username=anonymous/);
});

test('credentials are checked by the backend and tokens resolve server-assigned roles', () => {
  assert.equal(authenticateAccount('manager1', 'wrong-password'), null);
  assert.equal(authenticateAccount('toString', '123'), null);
  assert.throws(() => createAuthToken('toString'), /unknown account/);
  assert.deepEqual(authenticateAccount('customer1', '123'), {
    username: 'customer1',
    role: 'customer',
    customerId: 1,
  });

  const token = createAuthToken('customer1');
  assert.deepEqual(verifyAuthToken(token), {
    username: 'customer1',
    role: 'customer',
    customerId: 1,
  });
});

test('expired and tampered bearer tokens are rejected', () => {
  const expiredToken = createAuthToken('manager1', 0);
  const validToken = createAuthToken('manager1');
  const [payload, signature] = validToken.split('.');
  const changedFirstCharacter = signature[0] === 'A' ? 'B' : 'A';
  const tamperedSignature = `${changedFirstCharacter}${signature.slice(1)}`;

  assert.equal(verifyAuthToken(expiredToken, 28_800_000), null);
  assert.equal(verifyAuthToken(`${payload}.${tamperedSignature}`), null);
});

test('requireAccount ignores X-Mock-Username and trusts the signed bearer token', () => {
  const token = createAuthToken('customer1');
  const request = {
    method: 'GET',
    originalUrl: '/api/vehicles/all',
    get: (name) => name === 'Authorization'
      ? `Bearer ${token}`
      : name === 'X-Mock-Username' ? 'manager1' : undefined,
  };
  const response = createResponse();
  let continued = false;

  requireAccount(request, response, () => { continued = true; });

  assert.equal(continued, true);
  assert.equal(request.account.role, 'customer');
  assert.equal(request.account.username, 'customer1');
});

test('denyAccess returns forbidden and logs the authenticated role and resource', (context) => {
  const messages = [];
  const originalWarn = console.warn;
  console.warn = (message) => messages.push(message);
  context.after(() => { console.warn = originalWarn; });

  const response = createResponse();
  const request = {
    method: 'GET',
    originalUrl: '/api/vehicles/customer/2',
    account: { username: 'customer1', role: 'customer' },
    get: () => 'customer1',
  };

  denyAccess(request, response, 'You can only view your own records.');

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.body, { error: 'You can only view your own records.' });
  assert.match(messages[0], /username=customer1 role=customer/);
  assert.match(messages[0], /path=\/api\/vehicles\/customer\/2/);
});