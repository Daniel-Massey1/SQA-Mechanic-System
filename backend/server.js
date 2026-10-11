const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const vehicleRoutes = require('./routes/vehicles');
const bookingRoutes = require('./routes/bookings');
const mechanicRoutes = require('./routes/mechanics');
const managerRoutes = require('./routes/manager');
const { getDb } = require('./db/db');
const { startReminderSchedule } = require('./services/reminders');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Initialise (and seed) the database on startup.
const db = getDb();

// Queues WOF/service reminders at 8am daily and delivers (and retries) queued emails.
startReminderSchedule(db);

// --- Customer Booking & Basic Portal routes ---
app.use('/api/auth', authRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/mechanics', mechanicRoutes);
app.use('/api/manager', managerRoutes);

// Serve the simple frontend as static files.
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Unknown API addresses get JSON, not the static file server's HTML 404.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Any error a route throws (e.g. a database failure) is logged and returned as JSON,
// so the frontend can show a message instead of failing to read an HTML error page (D13).
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'The request body is not valid JSON.' });
  }
  console.error(`[ERROR] ${req.method} ${req.originalUrl}:`, err);
  return res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
});

app.listen(PORT, () => {
  console.log(`Mechanics Portal backend running at http://localhost:${PORT}`);
});