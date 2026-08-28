const ACCOUNTS = {
  customer1: { role: 'customer', customerId: 1 },
  customer2: { role: 'customer', customerId: 2 },
  mechanic1: { role: 'mechanic' },
  manager1: { role: 'manager' },
};

function getAccount(req) {
  return ACCOUNTS[req.get('X-Mock-Username')];
}

function requireAccount(req, res, next) {
  const account = getAccount(req);
  if (!account) {
    return res.status(401).json({ error: 'Please log in to continue.' });
  }

  req.account = { username: req.get('X-Mock-Username'), ...account };
  return next();
}

module.exports = { getAccount, requireAccount };