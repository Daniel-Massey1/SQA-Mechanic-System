const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getDb } = require('./db/db');
const { verifyPassword } = require('./passwords');

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

function findUserByUsername(username) {
  if (typeof username !== 'string') return null;
  return getDb().prepare(
    'SELECT id, username, password_hash, role, customer_id FROM users WHERE username = ?'
  ).get(username) || null;
}

function findUserById(id) {
  return getDb().prepare(
    'SELECT id, username, role, customer_id FROM users WHERE id = ?'
  ).get(id) || null;
}

function toPublicAccount(user) {
  if (!user) return null;
  return {
    username: user.username,
    role: user.role,
    ...(user.customer_id ? { customerId: user.customer_id } : {}),
  };
}

function getPublicAccount(username) {
  return toPublicAccount(findUserByUsername(username));
}

function authenticateAccount(username, password) {
  const user = findUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) return null;

  return toPublicAccount(user);
}

function createAuthToken(username, now = Date.now()) {
  const user = findUserByUsername(username);
  if (!user) throw new Error('Cannot issue a token for an unknown account.');

  // Store the immutable user ID, then reload the current role on every request.
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
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
    if (!Number.isInteger(claims.sub) || !Number.isInteger(claims.exp) || claims.exp <= Math.floor(now / 1000)) {
      return null;
    }
    // Deleted users no longer resolve, immediately invalidating their outstanding tokens.
    return toPublicAccount(findUserById(claims.sub));
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
