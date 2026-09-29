const express = require('express');
const { getDb } = require('../db/db');
const { authenticateAccount, createAuthToken, denyAccess, requireAccount } = require('../auth');
const { hashPassword } = require('../passwords');
const { createRateLimiter } = require('../rateLimit');

const router = express.Router();
const USERNAME_PATTERN = /^[a-z0-9._-]{3,30}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  message: 'Too many login attempts. Try again later.',
});
const signupLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  maxRequests: 5,
  message: 'Too many sign-up attempts. Try again later.',
});

router.get('/session', requireAccount, (req, res) => {
  return res.json({ account: req.account });
});

router.post('/login', loginLimiter, (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  req.authAttemptUsername = username;
  const account = authenticateAccount(username, req.body?.password);

  if (!account) {
    return denyAccess(req, res, 'Incorrect username or password.', 401);
  }

  return res.json({ token: createAuthToken(account.username), account });
});

router.post('/signup', signupLimiter, (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  req.authAttemptUsername = username;

  if (!USERNAME_PATTERN.test(username) || password.length < 8 || password.length > 128 || displayName.length < 2
    || displayName.length > 80 || !EMAIL_PATTERN.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Enter a valid name, email, username and password (8 to 128 characters).' });
  }

  const db = getDb();
  const duplicate = db.prepare(
    'SELECT id FROM users WHERE username = ? OR lower(email) = ?'
  ).get(username, email);
  if (duplicate) {
    return res.status(409).json({ error: 'That username or email is already registered.' });
  }
  // Never attach public sign-up to an existing profile without verifying ownership of its email.
  const existingCustomer = db.prepare('SELECT id FROM customers WHERE lower(email) = ?').get(email);
  if (existingCustomer) {
    return res.status(409).json({ error: 'A customer profile already uses that email. Please contact the workshop.' });
  }

  try {
    const createCustomerAccount = db.transaction(() => {
      const inserted = db.prepare('INSERT INTO customers (name, email) VALUES (?, ?)').run(displayName, email);

      db.prepare(
        `INSERT INTO users (username, password_hash, role, display_name, email, customer_id)
         VALUES (?, ?, 'customer', ?, ?, ?)`
      ).run(username, hashPassword(password), displayName, email, inserted.lastInsertRowid);
    });
    createCustomerAccount();

    const account = authenticateAccount(username, password);
    return res.status(201).json({ token: createAuthToken(username), account });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === 'SQLITE_CONSTRAINT') {
      return res.status(409).json({ error: 'That username or email is already registered.' });
    }
    console.error(error);
    return res.status(500).json({ error: 'Unable to create the account.' });
  }
});

module.exports = router;