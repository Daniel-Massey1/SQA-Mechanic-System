const crypto = require('crypto');

const HASH_BYTES = 64;
const SALT_BYTES = 16;
const MAX_PASSWORD_LENGTH = 128;

function hashPassword(password) {
  if (typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH) {
    throw new Error('Password must be 128 characters or fewer.');
  }
  // A per-password random salt prevents equal passwords from sharing the same stored hash.
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, HASH_BYTES).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, encodedHash) {
  if (typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH || typeof encodedHash !== 'string') return false;
  const [algorithm, salt, hash, extra] = encodedHash.split('$');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/i.test(salt || '')
    || !/^[a-f0-9]{128}$/i.test(hash || '') || extra !== undefined) return false;

  const expected = Buffer.from(hash, 'hex');
  // Constant-time comparison avoids exposing hash matches through timing differences.
  const actual = crypto.scryptSync(String(password), salt, HASH_BYTES);
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = { hashPassword, verifyPassword };
