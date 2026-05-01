"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const role_1 = require("../middleware/role");
const zod_1 = require("zod");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
// GET /students/me — o'z profili
router.get("/me", (0, role_1.requireRole)("student"), async (req, res) => {
    const { rows } = await pool_1.pool.query(`SELECT u.id, u.first_name, u.last_name, u.phone, u.status,
            sp.class_id, sp.school_id, sp.approved_at,
            c.grade, c.letter,
            s.name AS school_name
     FROM users u
     LEFT JOIN student_profiles sp ON sp.user_id = u.id
     LEFT JOIN classes c ON c.id = sp.class_id
     LEFT JOIN schools s ON s.id = sp.school_id
     WHERE u.id = $1`, [req.user.sub]);
    res.json(rows[0] ?? null);
});
// GET /students/me/dashboard — student dashboard data
router.get("/me/dashboard", (0, role_1.requireRole)("student"), async (req, res) => {
    const studentId = req.user.sub;
    const profileRes = await pool_1.pool.query(`SELECT sp.class_id FROM student_profiles sp WHERE sp.user_id = $1`, [studentId]);
    const classId = profileRes.rows[0]?.class_id ?? null;
    const [lecturesRes, testClassesRes, attemptsRes] = await Promise.all([
        classId
            ? pool_1.pool.query(`SELECT l.id, l.title, l.content_type, json_build_object('name', sub.name) AS subjects
           FROM lectures l LEFT JOIN subjects sub ON sub.id = l.subject_id
           WHERE l.class_id = $1 ORDER BY l.created_at DESC LIMIT 4`, [classId])
            : Promise.resolve({ rows: [] }),
        classId
            ? pool_1.pool.query(`SELECT test_id FROM test_classes WHERE class_id = $1`, [classId])
            : Promise.resolve({ rows: [] }),
        pool_1.pool.query(`SELECT test_id, score FROM test_attempts WHERE student_id = $1 AND finished_at IS NOT NULL ORDER BY score DESC LIMIT 5`, [studentId]),
    ]);
    const testIds = testClassesRes.rows.map((r) => r.test_id);
    let tests = [];
    if (testIds.length > 0) {
        const { rows } = await pool_1.pool.query(`SELECT id, title, test_type, time_limit FROM tests WHERE id = ANY($1) LIMIT 4`, [testIds]);
        tests = rows;
    }
    const attempts = attemptsRes.rows;
    const completedCount = new Set(attempts.map((a) => a.test_id)).size;
    const bestScore = attempts.length > 0
        ? Math.round(Math.max(...attempts.map((a) => a.score ?? 0)))
        : null;
    res.json({ lectures: lecturesRes.rows, tests, completedCount, bestScore });
});
// GET /students/me/tests — tests for student's class with attempt info
router.get("/me/tests", (0, role_1.requireRole)("student"), async (req, res) => {
    const studentId = req.user.sub;
    const profileRes = await pool_1.pool.query(`SELECT class_id FROM student_profiles WHERE user_id = $1`, [studentId]);
    const classId = profileRes.rows[0]?.class_id ?? null;
    if (!classId) {
        res.json([]);
        return;
    }
    const [testsRes, attemptsRes] = await Promise.all([
        pool_1.pool.query(`SELECT t.id, t.title, t.description, t.test_type, t.time_limit, t.max_attempts,
              json_build_object('name', sub.name) AS subjects
       FROM tests t
       JOIN subjects sub ON sub.id = t.subject_id
       JOIN test_classes tc ON tc.test_id = t.id
       WHERE tc.class_id = $1
       ORDER BY t.created_at DESC`, [classId]),
        pool_1.pool.query(`SELECT test_id, score, finished_at FROM test_attempts
       WHERE student_id = $1 AND finished_at IS NOT NULL`, [studentId]),
    ]);
    const attemptsByTest = {};
    for (const a of attemptsRes.rows) {
        if (!attemptsByTest[a.test_id])
            attemptsByTest[a.test_id] = [];
        attemptsByTest[a.test_id].push({ score: a.score });
    }
    res.json(testsRes.rows.map((t) => ({
        ...t,
        my_attempts: attemptsByTest[t.id] ?? [],
    })));
});
// GET /students/me/subjects — fan ro'yxati (class bo'yicha)
router.get("/me/subjects", (0, role_1.requireRole)("student"), async (req, res) => {
    const profileRes = await pool_1.pool.query(`SELECT class_id FROM student_profiles WHERE user_id = $1`, [req.user.sub]);
    const classId = profileRes.rows[0]?.class_id ?? null;
    if (!classId) {
        const { rows } = await pool_1.pool.query(`SELECT id, name FROM subjects ORDER BY name`);
        res.json(rows.map((s) => ({ ...s, lecture_count: 0, test_count: 0 })));
        return;
    }
    const [lecRes, testRes] = await Promise.all([
        pool_1.pool.query(`SELECT sub.id, sub.name, COUNT(l.id) AS lecture_count
       FROM subjects sub LEFT JOIN lectures l ON l.subject_id = sub.id AND l.class_id = $1
       GROUP BY sub.id, sub.name`, [classId]),
        pool_1.pool.query(`SELECT sub.id, COUNT(t.id) AS test_count
       FROM subjects sub
       LEFT JOIN tests t ON t.subject_id = sub.id
         AND t.id IN (SELECT test_id FROM test_classes WHERE class_id = $1)
       GROUP BY sub.id`, [classId]),
    ]);
    const testMap = {};
    for (const r of testRes.rows)
        testMap[r.id] = Number(r.test_count);
    const subjects = lecRes.rows
        .map((r) => ({
        id: r.id,
        name: r.name,
        lecture_count: Number(r.lecture_count),
        test_count: testMap[r.id] ?? 0,
    }))
        .filter((s) => s.lecture_count > 0 || s.test_count > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
    if (subjects.length === 0) {
        const { rows } = await pool_1.pool.query(`SELECT id, name FROM subjects ORDER BY name`);
        res.json(rows.map((s) => ({ ...s, lecture_count: 0, test_count: 0 })));
        return;
    }
    res.json(subjects);
});
// GET /students/me/results — o'z natijalari
router.get("/me/results", (0, role_1.requireRole)("student"), async (req, res) => {
    const studentId = req.user.sub;
    const [tests, games, assignments] = await Promise.all([
        pool_1.pool.query(`SELECT ta.id, ta.score, ta.started_at, ta.finished_at,
              t.title, t.test_type, sub.name AS subject_name
       FROM test_attempts ta
       JOIN tests t ON t.id = ta.test_id
       JOIN subjects sub ON sub.id = t.subject_id
       WHERE ta.student_id = $1 AND ta.finished_at IS NOT NULL
       ORDER BY ta.finished_at DESC LIMIT 30`, [studentId]),
        pool_1.pool.query(`SELECT ga.id, ga.score, ga.duration, ga.completed_at,
              g.title, sub.name AS subject_name
       FROM game_attempts ga
       JOIN games g ON g.id = ga.game_id
       JOIN subjects sub ON sub.id = g.subject_id
       WHERE ga.student_id = $1
       ORDER BY ga.completed_at DESC LIMIT 20`, [studentId]),
        pool_1.pool.query(`SELECT asub.id, asub.score, asub.submitted_at, asub.teacher_comment,
              a.title, a.max_score, sub.name AS subject_name
       FROM assignment_submissions asub
       JOIN assignments a ON a.id = asub.assignment_id
       JOIN subjects sub ON sub.id = a.subject_id
       WHERE asub.student_id = $1
       ORDER BY asub.submitted_at DESC LIMIT 20`, [studentId]),
    ]);
    res.json({ tests: tests.rows, games: games.rows, assignments: assignments.rows });
});
// GET /students (teacher/director/admin)
router.get("/", (0, role_1.requireRole)("teacher", "director", "super_admin"), async (req, res) => {
    const { class_id } = req.query;
    const { rows } = await pool_1.pool.query(`SELECT u.id, u.first_name, u.last_name, u.phone, u.status,
              sp.class_id, sp.school_id, sp.approved_at
       FROM users u
       JOIN student_profiles sp ON sp.user_id = u.id
       WHERE u.role = 'student'
         ${class_id ? "AND sp.class_id = $1" : ""}
       ORDER BY u.last_name, u.first_name`, class_id ? [class_id] : []);
    res.json(rows);
});
// POST /students/profile — register kelsidan profil yaratish
router.post("/profile", (0, role_1.requireRole)("student"), async (req, res) => {
    const parsed = zod_1.z.object({
        school_id: zod_1.z.string().uuid(),
        class_id: zod_1.z.string().uuid(),
    }).safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message });
        return;
    }
    await pool_1.pool.query(`INSERT INTO student_profiles (user_id, school_id, class_id)
     VALUES ($1,$2,$3) ON CONFLICT (user_id) DO UPDATE SET school_id=EXCLUDED.school_id, class_id=EXCLUDED.class_id`, [req.user.sub, parsed.data.school_id, parsed.data.class_id]);
    res.status(201).json({ ok: true });
});
// PUT /students/me/approve/:studentId (teacher/director)
router.put("/approve/:studentId", (0, role_1.requireRole)("teacher", "director", "super_admin"), async (req, res) => {
    await pool_1.pool.query("UPDATE student_profiles SET approved_by=$1, approved_at=NOW() WHERE user_id=$2", [req.user.sub, req.params.studentId]);
    await pool_1.pool.query("UPDATE users SET status='active' WHERE id=$1", [req.params.studentId]);
    res.json({ ok: true });
});
// PUT /students/reject/:studentId
router.put("/reject/:studentId", (0, role_1.requireRole)("teacher", "director", "super_admin"), async (req, res) => {
    const { reason } = req.body;
    await pool_1.pool.query("UPDATE student_profiles SET rejection_reason=$1 WHERE user_id=$2", [reason ?? null, req.params.studentId]);
    await pool_1.pool.query("UPDATE users SET status='rejected' WHERE id=$1", [req.params.studentId]);
    res.json({ ok: true });
});
exports.default = router;
