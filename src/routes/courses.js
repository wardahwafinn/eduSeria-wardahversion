// src/routes/courses.js
// Full CRUD for courses.
//   Read   : any signed-in user
//   Create : educators only
//   Update : the owning educator only
//   Delete : the owning educator only
const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../auth');

const router = express.Router();

// READ — list all courses (with educator name + enrolment count)
router.get('/', authenticate, async (req, res) => {
  const courses = await db.all(
    `SELECT c.id, c.title, c.description, c.category, c.educator_id,
            u.name AS educator_name, c.created_at, c.updated_at,
            (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS enrolled_count
       FROM courses c
       JOIN users u ON u.id = c.educator_id
       ORDER BY c.id DESC`
  );
  res.json({ courses });
});

// READ — single course
router.get('/:id', authenticate, async (req, res) => {
  const course = await db.get(
    `SELECT c.*, u.name AS educator_name
       FROM courses c JOIN users u ON u.id = c.educator_id
       WHERE c.id = ?`,
    [req.params.id]
  );
  if (!course) return res.status(404).json({ error: 'Course not found.' });
  res.json({ course });
});

// CREATE — educators only
router.post('/', authenticate, requireRole('educator'), async (req, res) => {
  const { title, description, category } = req.body || {};
  if (!title) return res.status(400).json({ error: 'A course title is required.' });

  const result = await db.run(
    'INSERT INTO courses (title, description, category, educator_id) VALUES (?, ?, ?, ?)',
    [title, description || null, category || null, req.user.id]
  );
  const course = await db.get('SELECT * FROM courses WHERE id = ?', [result.lastID]);
  res.status(201).json({ course });
});

// UPDATE — owning educator only
router.put('/:id', authenticate, requireRole('educator'), async (req, res) => {
  const course = await db.get('SELECT * FROM courses WHERE id = ?', [req.params.id]);
  if (!course) return res.status(404).json({ error: 'Course not found.' });
  if (course.educator_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only edit your own courses.' });
  }

  const title = req.body.title ?? course.title;
  const description = req.body.description ?? course.description;
  const category = req.body.category ?? course.category;
  const stamp = db.nowExpr();

  await db.run(
    `UPDATE courses SET title = ?, description = ?, category = ?, updated_at = ${stamp} WHERE id = ?`,
    [title, description, category, req.params.id]
  );
  const updated = await db.get('SELECT * FROM courses WHERE id = ?', [req.params.id]);
  res.json({ course: updated });
});

// DELETE — owning educator only
router.delete('/:id', authenticate, requireRole('educator'), async (req, res) => {
  const course = await db.get('SELECT * FROM courses WHERE id = ?', [req.params.id]);
  if (!course) return res.status(404).json({ error: 'Course not found.' });
  if (course.educator_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only delete your own courses.' });
  }
  // Remove dependent enrolments first (portable across both databases).
  await db.run('DELETE FROM enrollments WHERE course_id = ?', [req.params.id]);
  await db.run('DELETE FROM courses WHERE id = ?', [req.params.id]);
  res.json({ deleted: true, id: Number(req.params.id) });
});

module.exports = router;
