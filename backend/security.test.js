const assert = require('node:assert/strict');
const test = require('node:test');
const { hashPassword, verifyPassword } = require('./passwords');
const { createRateLimiter } = require('./rateLimit');

function createResponse() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('password hashes verify the correct password and reject out-of-range input', () => {
  const password = 'correct-horse-battery-staple';
  const hash = hashPassword(password);

  assert.notEqual(hash, password);
  assert.equal(verifyPassword(password, hash), true);
  assert.equal(verifyPassword('incorrect-password', hash), false);
  assert.equal(verifyPassword('x'.repeat(129), hash), false);
  assert.throws(() => hashPassword('x'.repeat(129)), /128 characters or fewer/);
});

test('rate limiter rejects requests over the configured window limit', () => {
  const limiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 2,
    message: 'Too many requests.',
  });
  const request = { ip: '192.0.2.12', socket: { remoteAddress: '192.0.2.12' } };
  let allowed = 0;

  limiter(request, createResponse(), () => { allowed += 1; });
  limiter(request, createResponse(), () => { allowed += 1; });
  const rejected = createResponse();
  limiter(request, rejected, () => { allowed += 1; });

  assert.equal(allowed, 2);
  assert.equal(rejected.statusCode, 429);
  assert.equal(rejected.headers['Retry-After'], '60');
  assert.deepEqual(rejected.body, { error: 'Too many requests.' });
});
