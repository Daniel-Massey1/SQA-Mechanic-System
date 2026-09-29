const express = require('express');
const { authenticateAccount, createAuthToken, denyAccess, requireAccount } = require('../auth');

const router = express.Router();

router.get('/session', requireAccount, (req, res) => {
  return res.json({ account: req.account });
});

router.post('/login', (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  req.authAttemptUsername = username;
  const account = authenticateAccount(username, req.body?.password);

  if (!account) {
    return denyAccess(req, res, 'Incorrect username or password.', 401);
  }

  return res.json({ token: createAuthToken(account.username), account });
});

module.exports = router;