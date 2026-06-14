// server.js — Edu Seria LMS prototype entry point
require('dotenv').config();
const path = require('path');
const express = require('express');
const db = require('./src/db');

const authRoutes = require('./src/routes/auth');
const courseRoutes = require('./src/routes/courses');
const userRoutes = require('./src/routes/users');
const enrollmentRoutes = require('./src/routes/enrollments');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/users', userRoutes);
app.use('/api/enrollments', enrollmentRoutes);

// Health check (useful for Azure App Service)
app.get('/api/health', (req, res) => res.json({ status: 'ok', db: db.client }));

// Static front-end
app.use(express.static(path.join(__dirname, 'public')));

// Fallback to the SPA for any non-API route
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Central error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

async function start() {
  await db.init();
  app.listen(PORT, () => {
    console.log(`Edu Seria LMS running on http://localhost:${PORT}  (db: ${db.client})`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
