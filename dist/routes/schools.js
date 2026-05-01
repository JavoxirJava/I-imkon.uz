"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const role_1 = require("../middleware/role");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
router.get("/", async (_req, res) => {
    const { rows } = await pool_1.pool.query(`SELECT s.*, u.first_name AS director_first, u.last_name AS director_last
     FROM schools s LEFT JOIN users u ON u.id = s.director_id
     ORDER BY s.name`);
    res.json(rows);
});
// GET /schools/my — director's school
router.get("/my", (0, role_1.requireRole)("director"), async (req, res) => {
    const { rows } = await pool_1.pool.query(`SELECT id, name, address FROM schools WHERE director_id = $1`, [req.user.sub]);
    res.json(rows[0] ?? null);
});
// GET /schools/:id/classes — classes for a school
router.get("/:id/classes", async (req, res) => {
    const { rows } = await pool_1.pool.query(`SELECT id, grade, letter FROM classes WHERE school_id = $1 ORDER BY grade, letter`, [req.params.id]);
    res.json(rows);
});
// GET /schools/:id/teachers — teachers for a school (via teacher_assignments)
router.get("/:id/teachers", async (req, res) => {
    const schoolId = req.params.id;
    const { rows: assignments } = await pool_1.pool.query(`SELECT DISTINCT ta.teacher_id, c.grade, c.letter
     FROM teacher_assignments ta JOIN classes c ON c.id = ta.class_id
     WHERE ta.school_id = $1`, [schoolId]);
    const teacherIds = [...new Set(assignments.map((a) => a.teacher_id))];
    if (teacherIds.length === 0) {
        res.json([]);
        return;
    }
    const { rows: teachers } = await pool_1.pool.query(`SELECT id, first_name, last_name, status FROM users WHERE id = ANY($1) ORDER BY first_name`, [teacherIds]);
    const classMap = {};
    for (const a of assignments) {
        if (!classMap[a.teacher_id])
            classMap[a.teacher_id] = [];
        classMap[a.teacher_id].push({ grade: a.grade, letter: a.letter });
    }
    res.json(teachers.map((t) => ({ ...t, classes: classMap[t.id] ?? [] })));
});
// GET /schools/my-stats — director dashboard stats
router.get("/my-stats", (0, role_1.requireRole)("director"), async (req, res) => {
    const directorId = req.user.sub;
    const schoolRes = await pool_1.pool.query(`SELECT id, name, address FROM schools WHERE director_id = $1`, [directorId]);
    const school = schoolRes.rows[0] ?? null;
    if (!school) {
        res.json({ school: null, teachers: 0, students: 0, classes: 0, lectures: 0 });
        return;
    }
    const schoolId = school.id;
    const [teacherRes, classRes, lectureRes] = await Promise.all([
        pool_1.pool.query(`SELECT COUNT(DISTINCT teacher_id) FROM teacher_assignments WHERE school_id = $1`, [schoolId]),
        pool_1.pool.query(`SELECT id FROM classes WHERE school_id = $1`, [schoolId]),
        pool_1.pool.query(`SELECT COUNT(*) FROM lectures`, []),
    ]);
    const classIds = classRes.rows.map((r) => r.id);
    let studentCount = 0;
    if (classIds.length > 0) {
        const { rows } = await pool_1.pool.query(`SELECT COUNT(*) FROM student_profiles WHERE class_id = ANY($1) AND approved_at IS NOT NULL`, [classIds]);
        studentCount = Number(rows[0].count);
    }
    res.json({
        school,
        teachers: Number(teacherRes.rows[0].count),
        students: studentCount,
        classes: classRes.rows.length,
        lectures: Number(lectureRes.rows[0].count),
    });
});
// GET /schools/admin-analytics — detailed analytics
router.get("/admin-analytics", (0, role_1.requireRole)("super_admin"), async (_req, res) => {
    const [schools, teachers, students, lectures, tests, attemptsCount, avgRes] = await Promise.all([
        pool_1.pool.query(`SELECT COUNT(*) FROM schools`),
        pool_1.pool.query(`SELECT COUNT(*) FROM users WHERE role='teacher'`),
        pool_1.pool.query(`SELECT COUNT(*) FROM users WHERE role='student'`),
        pool_1.pool.query(`SELECT COUNT(*) FROM lectures`),
        pool_1.pool.query(`SELECT COUNT(*) FROM tests`),
        pool_1.pool.query(`SELECT COUNT(*) FROM test_attempts WHERE finished_at IS NOT NULL`),
        pool_1.pool.query(`SELECT AVG(score) AS avg_score FROM test_attempts WHERE finished_at IS NOT NULL AND score IS NOT NULL`),
    ]);
    res.json({
        schools: Number(schools.rows[0].count),
        teachers: Number(teachers.rows[0].count),
        students: Number(students.rows[0].count),
        lectures: Number(lectures.rows[0].count),
        tests: Number(tests.rows[0].count),
        attempt_count: Number(attemptsCount.rows[0].count),
        avg_score: avgRes.rows[0].avg_score ? Math.round(Number(avgRes.rows[0].avg_score)) : null,
    });
});
// GET /schools/admin-stats — super_admin dashboard
router.get("/admin-stats", (0, role_1.requireRole)("super_admin"), async (_req, res) => {
    const [schools, directors, teachers, students, subjects] = await Promise.all([
        pool_1.pool.query(`SELECT COUNT(*) FROM schools`),
        pool_1.pool.query(`SELECT COUNT(*) FROM users WHERE role='director'`),
        pool_1.pool.query(`SELECT COUNT(*) FROM users WHERE role='teacher'`),
        pool_1.pool.query(`SELECT COUNT(*) FROM users WHERE role='student'`),
        pool_1.pool.query(`SELECT COUNT(*) FROM subjects`),
    ]);
    res.json({
        schools: Number(schools.rows[0].count),
        directors: Number(directors.rows[0].count),
        teachers: Number(teachers.rows[0].count),
        students: Number(students.rows[0].count),
        subjects: Number(subjects.rows[0].count),
    });
});
// GET /schools/my-analytics — director analytics page data
router.get("/my-analytics", (0, role_1.requireRole)("director"), async (req, res) => {
    const directorId = req.user.sub;
    const schoolRes = await pool_1.pool.query(`SELECT id, name FROM schools WHERE director_id = $1`, [directorId]);
    const school = schoolRes.rows[0] ?? null;
    if (!school) {
        res.json(null);
        return;
    }
    const schoolId = school.id;
    const classRes = await pool_1.pool.query(`SELECT id, grade, letter FROM classes WHERE school_id = $1 ORDER BY grade, letter`, [schoolId]);
    const classIds = classRes.rows.map((r) => r.id);
    const [totalRes, activeRes, pendingRes, attemptsRes] = await Promise.all([
        classIds.length > 0
            ? pool_1.pool.query(`SELECT COUNT(*) FROM student_profiles WHERE class_id = ANY($1)`, [classIds])
            : Promise.resolve({ rows: [{ count: 0 }] }),
        classIds.length > 0
            ? pool_1.pool.query(`SELECT COUNT(*) FROM users u JOIN student_profiles sp ON sp.user_id = u.id WHERE sp.class_id = ANY($1) AND sp.approved_at IS NOT NULL`, [classIds])
            : Promise.resolve({ rows: [{ count: 0 }] }),
        classIds.length > 0
            ? pool_1.pool.query(`SELECT COUNT(*) FROM users u JOIN student_profiles sp ON sp.user_id = u.id WHERE sp.class_id = ANY($1) AND sp.approved_at IS NULL AND sp.rejected_at IS NULL`, [classIds])
            : Promise.resolve({ rows: [{ count: 0 }] }),
        classIds.length > 0
            ? pool_1.pool.query(`SELECT ta.score FROM test_attempts ta
           JOIN student_profiles sp ON sp.user_id = ta.student_id
           WHERE sp.class_id = ANY($1) AND ta.finished_at IS NOT NULL AND ta.score IS NOT NULL`, [classIds])
            : Promise.resolve({ rows: [] }),
    ]);
    const attempts = attemptsRes.rows;
    const avgScore = attempts.length > 0
        ? Math.round(attempts.reduce((s, a) => s + a.score, 0) / attempts.length)
        : null;
    const scoreDistribution = [
        { label: "A'lo (86–100%)", min: 86, max: 100 },
        { label: "Yaxshi (71–85%)", min: 71, max: 85 },
        { label: "Qoniqarli (56–70%)", min: 56, max: 70 },
        { label: "Qoniqarsiz (0–55%)", min: 0, max: 55 },
    ].map((g) => ({
        ...g,
        count: attempts.filter((a) => a.score >= g.min && a.score <= g.max).length,
        pct: attempts.length > 0
            ? Math.round(attempts.filter((a) => a.score >= g.min && a.score <= g.max).length / attempts.length * 100)
            : 0,
    }));
    res.json({
        school,
        total_students: Number(totalRes.rows[0].count),
        active_students: Number(activeRes.rows[0].count),
        pending_students: Number(pendingRes.rows[0].count),
        avg_score: avgScore,
        classes: classRes.rows,
        score_distribution: scoreDistribution,
    });
});
// GET /schools/:id/lectures — lectures for a school
router.get("/:id/lectures", async (req, res) => {
    const schoolId = req.params.id;
    const { rows: classRows } = await pool_1.pool.query(`SELECT id FROM classes WHERE school_id = $1`, [schoolId]);
    if (classRows.length === 0) {
        res.json([]);
        return;
    }
    const classIds = classRows.map((r) => r.id);
    const { rows } = await pool_1.pool.query(`SELECT l.id, l.title, l.class_id, l.created_at, s.name AS subject_name
     FROM lectures l LEFT JOIN subjects s ON s.id = l.subject_id
     WHERE l.class_id = ANY($1)
     ORDER BY l.created_at DESC LIMIT 100`, [classIds]);
    res.json(rows);
});
// GET /schools/:id/students — students with class info and approval status
router.get("/:id/students", async (req, res) => {
    const schoolId = req.params.id;
    const { rows: classRows } = await pool_1.pool.query(`SELECT id, grade, letter FROM classes WHERE school_id = $1 ORDER BY grade, letter`, [schoolId]);
    if (classRows.length === 0) {
        res.json([]);
        return;
    }
    const classIds = classRows.map((r) => r.id);
    const classMap = {};
    for (const r of classRows)
        classMap[r.id] = { grade: r.grade, letter: r.letter };
    const { rows } = await pool_1.pool.query(`SELECT u.id, u.first_name, u.last_name, u.status, u.created_at,
            sp.class_id, sp.approved_at, sp.rejected_at, sp.rejection_reason
     FROM users u JOIN student_profiles sp ON sp.user_id = u.id
     WHERE sp.class_id = ANY($1)
     ORDER BY u.first_name, u.last_name`, [classIds]);
    res.json(rows.map((r) => ({
        ...r,
        grade: classMap[r.class_id]?.grade ?? null,
        letter: classMap[r.class_id]?.letter ?? null,
    })));
});
router.get("/:id", async (req, res) => {
    const { rows } = await pool_1.pool.query(`SELECT s.*, u.first_name AS director_first, u.last_name AS director_last
     FROM schools s LEFT JOIN users u ON u.id = s.director_id WHERE s.id=$1`, [req.params.id]);
    if (!rows[0]) {
        res.status(404).json({ error: "Topilmadi" });
        return;
    }
    res.json(rows[0]);
});
router.post("/", (0, role_1.requireRole)("super_admin"), async (req, res) => {
    const parsed = zod_1.z.object({
        name: zod_1.z.string().min(1),
        address: zod_1.z.string().nullable().optional(),
        director_id: zod_1.z.string().uuid().nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message });
        return;
    }
    const { rows } = await pool_1.pool.query("INSERT INTO schools (name, address, director_id) VALUES ($1,$2,$3) RETURNING id", [parsed.data.name, parsed.data.address ?? null, parsed.data.director_id ?? null]);
    res.status(201).json({ id: rows[0].id });
});
router.put("/:id", (0, role_1.requireRole)("super_admin", "director"), async (req, res) => {
    const parsed = zod_1.z.object({
        name: zod_1.z.string().min(1).optional(),
        address: zod_1.z.string().nullable().optional(),
        director_id: zod_1.z.string().uuid().nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message });
        return;
    }
    const updates = [];
    const params = [];
    if (parsed.data.name !== undefined) {
        params.push(parsed.data.name);
        updates.push(`name=$${params.length}`);
    }
    if (parsed.data.address !== undefined) {
        params.push(parsed.data.address);
        updates.push(`address=$${params.length}`);
    }
    if (parsed.data.director_id !== undefined) {
        params.push(parsed.data.director_id);
        updates.push(`director_id=$${params.length}`);
    }
    if (!updates.length) {
        res.status(400).json({ error: "Yangilanacak maydon yo'q" });
        return;
    }
    params.push(req.params.id);
    await pool_1.pool.query(`UPDATE schools SET ${updates.join(",")} WHERE id=$${params.length}`, params);
    res.json({ ok: true });
});
router.delete("/:id", (0, role_1.requireRole)("super_admin"), async (req, res) => {
    await pool_1.pool.query("DELETE FROM schools WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
});
exports.default = router;
