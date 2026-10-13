const assert = require('node:assert/strict');
const test = require('node:test');
const { api, customerIdOf, startApi, stopApi, vehicleIdOf } = require('./apiTestHelper');

test.before(startApi);
test.after(stopApi);

const ownCustomerId = customerIdOf('customer1');
const ownVehicleId = vehicleIdOf('customer1');
const otherCustomerId = customerIdOf('customer2');
const otherVehicleId = vehicleIdOf('customer2');

// Data-driven: each row is [account, address, expected status]. `null` means no token.
const accessRules = [
  // A customer only sees their own records (AC21).
  ['customer1', `/api/vehicles/customer/${ownCustomerId}`, 200],
  ['customer1', `/api/vehicles/${ownVehicleId}/history`, 200],
  ['customer1', `/api/bookings/customer/${ownCustomerId}`, 200],
  ['customer1', `/api/vehicles/customer/${otherCustomerId}`, 403],
  ['customer1', `/api/vehicles/${otherVehicleId}/history`, 403],
  ['customer1', `/api/bookings/customer/${otherCustomerId}`, 403],
  ['customer1', '/api/vehicles/all', 403],
  ['customer1', '/api/bookings/all', 403],
  ['customer1', '/api/mechanics/dashboard', 403],
  ['customer1', '/api/manager/dashboard', 403],
  // Mechanics and managers can open any repair record (AC22).
  ['mechanic1', `/api/vehicles/${otherVehicleId}/history`, 200],
  ['mechanic1', '/api/vehicles/all', 200],
  ['mechanic1', '/api/mechanics/dashboard', 200],
  ['mechanic1', '/api/manager/dashboard', 403],
  ['manager1', `/api/vehicles/${otherVehicleId}/history`, 200],
  ['manager1', '/api/vehicles/all', 200],
  ['manager1', '/api/manager/dashboard', 200],
  ['manager1', '/api/mechanics/dashboard', 403],
  // No token at all.
  [null, '/api/vehicles/all', 401],
  [null, `/api/vehicles/${ownVehicleId}/history`, 401],
];

for (const [username, url, expectedStatus] of accessRules) {
  test(`${username || 'no token'} GET ${url} returns ${expectedStatus}`, async () => {
    const { status } = await api('GET', url, { as: username });

    assert.equal(status, expectedStatus);
  });
}

test('a denied request is logged with the username, role and address', async (context) => {
  const messages = [];
  const originalWarn = console.warn;
  console.warn = (message) => messages.push(message);
  context.after(() => { console.warn = originalWarn; });

  await api('GET', '/api/vehicles/all', { as: 'customer1' });

  assert.equal(messages.length, 1);
  assert.match(messages[0], /ACCESS DENIED/);
  assert.match(messages[0], /username=customer1 role=customer/);
  assert.match(messages[0], /path=\/api\/vehicles\/all/);
});
