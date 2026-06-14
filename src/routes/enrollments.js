// src/routes/enrollments.js
// Learners enrol in / drop courses and list their own enrolments.
// Educators can view who is enrolled in a course they own.
const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../auth');

const router = express.Router();

// Learner enrols in a course
router.post('/', authenticate, requireRole('learner'), async (req, res) => {
  const { course_id } = req.body || {};
  if (!course_id) return res.status(400).json({ error: 'A course is required.' });

  const course = await db.get('SELECT id FROM courses WHERE id = ?', [course_id]);
  if (!course) return res.status(404).json({ error: 'Course not found.' });

  const already = await db.get(
    'SELECT id FROM enrollments WHERE course_id = ? AND learner_id = ?',
    [course_id, req.user.id]
  );
  if (already) return res.status(409).json({ error: 'You are already enrolled in this course.' });

  await db.run('INSERT INTO enrollments (course_id, learner_id) VALUES (?, ?)', [course_id, req.user.id]);
  res.status(201).json({ enrolled: true, course_id: Number(course_id) });
});

// Learner drops a course
router.delete('/:courseId', authenticate, requireRole('learner'), async (req, res) => {
  const result = await db.run(
    'DELETE FROM enrollments WHERE course_id = ? AND learner_id = ?',
    [req.params.courseId, req.user.id]
  );
  res.json({ dropped: result.changes > 0, course_id: Number(req.params.courseId) });
});

// Learner: my enrolled courses
router.get('/mine', authenticate, requireRole('learner'), async (req, res) => {
  const courses = await db.all(
    `SELECT c.id, c.title, c.description, c.category, u.name AS educator_name, e.enrolled_at
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
       JOIN users u ON u.id = c.educator_id
       WHERE e.learner_id = ?
       ORDER BY e.id DESC`,
    [req.user.id]
  );
  res.json({ courses });
});

// Educator: who is enrolled in one of my courses
router.get('/course/:courseId', authenticate, requireRole('educator'), async (req, res) => {
  const course = await db.get('SELECT * FROM courses WHERE id = ?', [req.params.courseId]);
  if (!course) return res.status(404).json({ error: 'Course not found.' });
  if (course.educator_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only view enrolments for your own courses.' });
  }
  const learners = await db.all(
    `SELECT u.id, u.name, u.email, e.enrolled_at
       FROM enrollments e JOIN users u ON u.id = e.learner_id
       WHERE e.course_id = ?
       ORDER BY e.id DESC`,
    [req.params.courseId]
  );
  res.json({ learners });
});

module.exports = router;
