const express = require('express');
const cors = require('cors');
const path = require('path');

const vehicleRoutes = require('./routes/vehicles');
const bookingRoutes = require('./routes/bookings');
const mechanicRoutes = require('./routes/mechanics');
const managerRoutes = require('./routes/manager');
const { getDb } = require('./db/db');
const { startWofReminderSchedule } = require('./services/wofReminders');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Initialise (and seed) the database on startup.
const db = getDb();

// Checks for vehicles due for WOF in 14 days and mock-emails their owners
startWofReminderSchedule(db);

// --- Customer Booking & Basic Portal routes ---
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/mechanics', mechanicRoutes);
app.use('/api/manager', managerRoutes);

// Serve the simple frontend as static files.
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Mechanics Portal backend running at http://localhost:${PORT}`);
});