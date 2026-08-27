const express = require('express');
const cors = require('cors');
const path = require('path');

const vehicleRoutes = require('./routes/vehicles');
const bookingRoutes = require('./routes/bookings');
const { getDb } = require('./db/db');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Initialise (and seed) the database on startup.
getDb();

// --- Customer Booking & Basic Portal routes ---
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/bookings', bookingRoutes);

// Teammates: mount your routes the same way, e.g.
//   const mechanicRoutes = require('./routes/mechanics');
//   app.use('/api/mechanics', mechanicRoutes);
//   const managerRoutes = require('./routes/manager');
//   app.use('/api/manager', managerRoutes);

// Serve the simple frontend as static files.
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Mechanics Portal backend running at http://localhost:${PORT}`);
});
