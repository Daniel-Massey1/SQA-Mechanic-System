const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reschedule-test-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');
process.env.NODE_ENV = 'test';

const express = require('express');
const { createAuthToken } = require('../auth');
const { getDb } = require('../db/db');
const bookingRoutes = require('./bookings');

const DAY_MS = 24 * 60 * 60 * 1000;

function slotString(daysAhead, hour) {
  const date = new Date(Date.now() + daysAhead * DAY_MS);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(hour)}:00:00`;
}

let server;
let baseUrl;
let vehicleId;
let counter = 0;

test.before(async () => {
  const db = getDb();
  vehicleId = db.prepare('SELECT id FROM vehicles WHERE customer_id = 1 LIMIT 1').get().id;
  const app = express();
  app.use(express.json());
  app.use('/api/bookings', bookingRoutes);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/bookings`;
});

test.after(() => {
  server.close();
  getDb().close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function insertBooking(slotStart, { status = 'confirmed', bookedBy = 'customer1' } = {}) {
  counter += 1;
  const result = getDb().prepare(
    `INSERT INTO bookings (vehicle_id, service_type, slot_start, status, confirmation_ref, booked_by)
     VALUES (?, 'basic_service', ?, ?, ?, ?)`
  ).run(vehicleId, slotStart, status, `TEST-${counter}`, bookedBy);
  return result.lastInsertRowid;
}

async function reschedule(id, slotStart, username = 'customer1') {
  const response = await fetch(`${baseUrl}/${id}/reschedule`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${createAuthToken(username)}`,
    },
    body: JSON.stringify({ slotStart }),
  });
  return { status: response.status, body: await response.json() };
}

function getBooking(id) {
  return getDb().prepare('SELECT * FROM bookings WHERE id = ?').get(id);
}

test('rescheduling moves the booking and returns it to pending approval', async () => {
  const id = insertBooking(slotString(5, 10));
  const newSlot = slotString(6, 11);
  const { status, body } = await reschedule(id, newSlot);

  assert.equal(status, 200);
  assert.equal(body.booking.slot_start, newSlot);
  assert.equal(getBooking(id).status, 'pending');
});

test('rescheduling is rejected within 24 hours of the current appointment', async () => {
  const currentSlot = slotString(0, 10);
  const id = insertBooking(currentSlot);
  const { status, body } = await reschedule(id, slotString(6, 12));

  assert.equal(status, 400);
  assert.match(body.error, /within 24 hours/);
  assert.equal(getBooking(id).slot_start, currentSlot);
});

test('rescheduling to a slot that is already taken leaves the booking unchanged', async () => {
  const takenSlot = slotString(7, 13);
  insertBooking(takenSlot, { status: 'pending', bookedBy: 'customer2' });
  const currentSlot = slotString(5, 14);
  const id = insertBooking(currentSlot);
  const { status, body } = await reschedule(id, takenSlot);

  assert.equal(status, 409);
  assert.match(body.error, /no longer available/);
  assert.equal(getBooking(id).slot_start, currentSlot);
  assert.equal(getBooking(id).status, 'confirmed');
});

test('rescheduling rejects past times, off-hours slots and the unchanged slot', async () => {
  const currentSlot = slotString(5, 15);
  const id = insertBooking(currentSlot);

  assert.equal((await reschedule(id, slotString(-1, 10))).status, 400);
  assert.equal((await reschedule(id, slotString(6, 20))).status, 400);
  assert.equal((await reschedule(id, 'not-a-date')).status, 400);
  assert.equal((await reschedule(id, currentSlot)).status, 400);
  assert.equal(getBooking(id).slot_start, currentSlot);
});

test('customers cannot reschedule other customers bookings or cancelled bookings', async () => {
  const id = insertBooking(slotString(5, 9), { bookedBy: 'customer2' });
  const forbidden = await reschedule(id, slotString(6, 9), 'customer1');
  assert.equal(forbidden.status, 403);

  const cancelledId = insertBooking(slotString(5, 16), { status: 'cancelled' });
  const cancelled = await reschedule(cancelledId, slotString(6, 16));
  assert.equal(cancelled.status, 400);
  assert.equal((await reschedule(999999, slotString(6, 9))).status, 404);
});
