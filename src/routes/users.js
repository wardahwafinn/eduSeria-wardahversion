// src/routes/users.js
// User data CRUD.
//   Read list : educators (manage participants)
//   Read self : any signed-in user
//   Update    : a user updates their own profile
//   Delete    : a user deletes their own account
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticate, requireRole } = require('../auth');

const router = express.Router();

const publicCols = 'id, name, email, role, created_at';

// READ — list users (educators only)
router.get('/', authenticate, requireRole('educator'), async (req, res) => {
  const role = req.query.role;
  let users;
  if (role && ['educator', 'learner'].includes(role)) {
    users = await db.all(`SELECT ${publicCols} FROM users WHERE role = ? ORDER BY id DESC`, [role]);
  } else {
    users = await db.all(`SELECT ${publicCols} FROM users ORDER BY id DESC`);
  }
  res.json({ users });
});

// READ — a single user (self, or educator viewing anyone)
router.get('/:id', authenticate, async (req, res) => {
  const id = Number(req.params.id);
  if (req.user.role !== 'educator' && req.user.id !== id) {
    return res.status(403).json({ error: 'You can only view your own profile.' });
  }
  const user = await db.get(`SELECT ${publicCols} FROM users WHERE id = ?`, [id]);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user });
});

// UPDATE — own profile (name and/or password)
router.put('/:id', authenticate, async (req, res) => {
  const id = Number(req.params.id);
  if (req.user.id !== id) {
    return res.status(403).json({ error: 'You can only update your own profile.' });
  }
  const current = await db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!current) return res.status(404).json({ error: 'User not found.' });

  const name = req.body.name ?? current.name;
  const password_hash = req.body.password
    ? bcrypt.hashSync(req.body.password, 10)
    : current.password_hash;

  await db.run('UPDATE users SET name = ?, password_hash = ? WHERE id = ?', [name, password_hash, id]);
  const updated = await db.get(`SELECT ${publicCols} FROM users WHERE id = ?`, [id]);
  res.json({ user: updated });
});

// DELETE — own account
router.delete('/:id', authenticate, async (req, res) => {
  const id = Number(req.params.id);
  if (req.user.id !== id) {
    return res.status(403).json({ error: 'You can only delete your own account.' });
  }
  // Clean up dependent rows for portability across both databases.
  await db.run('DELETE FROM enrollments WHERE learner_id = ?', [id]);
  await db.run('DELETE FROM enrollments WHERE course_id IN (SELECT id FROM courses WHERE educator_id = ?)', [id]);
  await db.run('DELETE FROM courses WHERE educator_id = ?', [id]);
  await db.run('DELETE FROM users WHERE id = ?', [id]);
  res.json({ deleted: true, id });
});

module.exports = router;
