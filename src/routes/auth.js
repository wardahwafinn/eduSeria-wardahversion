// src/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, authenticate } = require('../auth');

const router = express.Router();

// POST /api/auth/register  -> create a user (Educator or Learner)
router.post('/register', async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'Name, email, password and role are all required.' });
  }
  if (!['educator', 'learner'].includes(role)) {
    return res.status(400).json({ error: 'Role must be either educator or learner.' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const existing = await db.get('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = await db.run(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [name, email.toLowerCase(), hash, role]
  );
  const user = { id: result.lastID, name, email: email.toLowerCase(), role };
  return res.status(201).json({ token: signToken(user), user });
});

// POST /api/auth/login  -> verify credentials, return a JWT
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const user = await db.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  const safe = { id: user.id, name: user.name, email: user.email, role: user.role };
  return res.json({ token: signToken(safe), user: safe });
});

// GET /api/auth/me  -> current signed-in identity
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
