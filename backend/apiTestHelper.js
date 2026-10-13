const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Shared setup for API tests. Requiring this file points the app at a throwaway
// database, so it must be required before anything else that loads db/db.js.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-test-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');
process.env.NODE_ENV = 'test';

const express = require('express');
const { createAuthToken } = require('./auth');
const { getDb } = require('./db/db');

const DAY_MS = 24 * 60 * 60 * 1000;

let server;
let baseUrl;
let counter = 0;

// Starts the same routes as server.js on a spare port.
async function startApi() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/vehicles', require('./routes/vehicles'));
  app.use('/api/bookings', require('./routes/bookings'));
  app.use('/api/mechanics', require('./routes/mechanics'));
  app.use('/api/manager', require('./routes/manager'));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

function stopApi() {
  server.close();
  getDb().close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

// Sends a request as the given demo account (or with no token when `as` is left out).
async function api(method, url, { as, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (as) headers.Authorization = `Bearer ${createAuthToken(as)}`;
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

// A slot in local time, e.g. slotString(5, 10) is 10:00 five days from now.
function slotString(daysAhead, hour) {
  const date = new Date(Date.now() + daysAhead * DAY_MS);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(hour)}:00:00`;
}

function customerIdOf(username) {
  return getDb().prepare('SELECT customer_id FROM users WHERE username = ?').get(username).customer_id;
}

function vehicleIdOf(username) {
  return getDb().prepare('SELECT id FROM vehicles WHERE customer_id = ? LIMIT 1').get(customerIdOf(username)).id;
}

// Each test inserts its own bookings, so tests do not depend on each other.
function insertBooking(slotStart, { status = 'confirmed', bookedBy = 'customer1' } = {}) {
  counter += 1;
  const result = getDb().prepare(
    `INSERT INTO bookings (vehicle_id, service_type, slot_start, status, confirmation_ref, booked_by)
     VALUES (?, 'basic_service', ?, ?, ?, ?)`
  ).run(vehicleIdOf(bookedBy), slotStart, status, `TEST-${counter}`, bookedBy);
  return result.lastInsertRowid;
}

function getBooking(id) {
  return getDb().prepare('SELECT * FROM bookings WHERE id = ?').get(id);
}

function getNotification(bookingId, type) {
  return getDb().prepare('SELECT * FROM notifications WHERE booking_id = ? AND type = ?').get(bookingId, type);
}

module.exports = {
  api,
  customerIdOf,
  getBooking,
  getDb,
  getNotification,
  insertBooking,
  slotString,
  startApi,
  stopApi,
  vehicleIdOf,
};
