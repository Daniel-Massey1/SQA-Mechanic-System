const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ACCOUNT_CREDENTIALS = {
  customer1: { password: '123', role: 'customer', customerId: 1 },
  customer2: { password: '123', role: 'customer', customerId: 2 },
  mechanic1: { password: '123', role: 'mechanic' },
  manager1: { password: '123', role: 'manager' },
};
const TOKEN_TTL_SECONDS = 8 * 60 * 60;

if (process.env.NODE_ENV === 'production' && !process.env.AUTH_SECRET) {
  throw new Error('AUTH_SECRET must be configured in production.');
}

function loadAuthSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;

  const secretPath = path.join(__dirname, '.auth-secret');
  try {
    const storedSecret = fs.readFileSync(secretPath, 'utf8').trim();
    if (storedSecret) return storedSecret;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const generatedSecret = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(secretPath, generatedSecret, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return generatedSecret;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return fs.readFileSync(secretPath, 'utf8').trim();
  }
}

const AUTH_SECRET = loadAuthSecret();

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function hasAccount(username) {
  return Object.prototype.hasOwnProperty.call(ACCOUNT_CREDENTIALS, username);
}

function getPublicAccount(username) {
  const credentials = ACCOUNT_CREDENTIALS[username];
  if (!hasAccount(username)) return null;
  const { role, customerId } = credentials;
  return { username, role, ...(customerId ? { customerId } : {}) };
}

function authenticateAccount(username, password) {
  if (!hasAccount(username)) return null;
  const credentials = ACCOUNT_CREDENTIALS[username];
  if (!safeEqual(password, credentials.password)) return null;

  return getPublicAccount(username);
}

function createAuthToken(username, now = Date.now()) {
  if (!hasAccount(username)) throw new Error('Cannot issue a token for an unknown account.');

  const payload = Buffer.from(JSON.stringify({
    sub: username,
    exp: Math.floor(now / 1000) + TOKEN_TTL_SECONDS,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyAuthToken(token, now = Date.now()) {
  if (typeof token !== 'string') return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;

  const expectedSignature = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest();
  let providedSignature;
  try {
    providedSignature = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (providedSignature.length !== expectedSignature.length
    || !crypto.timingSafeEqual(providedSignature, expectedSignature)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof claims.sub !== 'string' || !Number.isInteger(claims.exp) || claims.exp <= Math.floor(now / 1000)) {
      return null;
    }
    return getPublicAccount(claims.sub);
  } catch {
    return null;
  }
}

function logDeniedAttempt(req, account, reason) {
  const username = account?.username || req.authAttemptUsername || 'anonymous';
  const safe = (value) => String(value).replace(/[\r\n\t]/g, ' ');
  console.warn(
    `[ACCESS DENIED] method=${safe(req.method)} path=${safe(req.originalUrl || req.path)} username=${safe(username)} role=${safe(account?.role || 'unknown')} reason=${safe(reason)}`
  );
}

function denyAccess(req, res, message, status = 403) {
  logDeniedAttempt(req, req.account, message);
  return res.status(status).json({ error: message });
}

function getAccount(req) {
  const authorization = req.get('Authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? verifyAuthToken(match[1]) : null;
}

function requireAccount(req, res, next) {
  const account = getAccount(req);
  if (!account) {
    return denyAccess(req, res, 'Please log in to continue.', 401);
  }

  req.account = account;
  return next();
}

module.exports = {
  authenticateAccount,
  createAuthToken,
  denyAccess,
  getAccount,
  requireAccount,
  verifyAuthToken,
};
