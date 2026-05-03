"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const role_1 = require("../middleware/role");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
router.use((0, role_1.requireRole)("teacher", "director", "super_admin"));
// GET /teachers — barcha o'qituvchilar
router.get("/", async (_req, res) => {
    const { rows } = await pool_1.pool.query(`SELECT u.id, u.first_name, u.last_name, u.phone, u.status,
            COALESCE(
              json_agg(
                json_build_object('class_id', ta.class_id, 'subject_id', ta.subject_id, 'subject_name', sub.name)
              ) FILTER (WHERE ta.id IS NOT NULL), '[]'
            ) AS assignments
     FROM users u
     LEFT JOIN teacher_assignments ta ON ta.teacher_id = u.id
     LEFT JOIN subjects sub ON sub.id = ta.subject_id
     WHERE u.role = 'teacher'
     GROUP BY u.id
     ORDER BY u.last_name, u.first_name`);
    res.json(rows);
});
// GET /teachers/:id/students — o'qituvchining o'quvchilari (K-adapt bilan)
router.get("/:id/students", async (req, res) => {
    const teacherId = req.params.id;
    const { subject_id } = req.query;
    const { rows: classIds } = await pool_1.pool.query(`SELECT DISTINCT class_id FROM teacher_assignments WHERE teacher_id = $1 ${subject_id ? "AND subject_id = $2" : ""}`, subject_id ? [teacherId, subject_id] : [teacherId]);
    if (classIds.length === 0) {
        res.json([]);
        return;
    }
    const ids = classIds.map((r) => r.class_id);
    // Test IDs for this teacher + subject
    const testQuery = subject_id
        ? "SELECT id FROM tests WHERE teacher_id = $1 AND subject_id = $2"
        : "SELECT id FROM tests WHERE teacher_id = $1";
    const { rows: testRows } = await pool_1.pool.query(testQuery, subject_id ? [teacherId, subject_id] : [teacherId]);
    const testIds = testRows.map((t) => t.id);
    const { rows: students } = await pool_1.pool.query(`SELECT u.id, u.first_name, u.last_name, u.status,
            sp.class_id, sp.approved_at,
            ap.contrast_mode, ap.color_blind_mode
     FROM users u
     JOIN student_profiles sp ON sp.user_id = u.id
     LEFT JOIN accessibility_profiles ap ON ap.user_id = u.id
     WHERE sp.class_id = ANY($1) AND sp.approved_at IS NOT NULL
     ORDER BY u.last_name, u.first_name`, [ids]);
    if (testIds.length === 0) {
        res.json(students.map((s) => ({ ...s, k_adapt: 0, attempt_count: 0 })));
        return;
    }
    // K-adapt per student
    const { rows: scores } = await pool_1.pool.query(`SELECT student_id, ROUND(AVG(score)::numeric, 1) AS k_adapt, COUNT(*) AS attempt_count
     FROM test_attempts
     WHERE student_id = ANY($1) AND test_id = ANY($2) AND finished_at IS NOT NULL AND score IS NOT NULL
     GROUP BY student_id`, [students.map((s) => s.id), testIds]);
    const scoreMap = {};
    for (const row of scores) {
        scoreMap[row.student_id] = { k_adapt: Number(row.k_adapt), attempt_count: Number(row.attempt_count) };
    }
    res.json(students.map((s) => ({
        ...s,
        k_adapt: scoreMap[s.id]?.k_adapt ?? 0,
        attempt_count: scoreMap[s.id]?.attempt_count ?? 0,
    })));
});
// GET /teachers/:id/class-students — for student management page (with class info + status)
router.get("/:id/class-students", async (req, res) => {
    const teacherId = req.params.id;
    const { rows: classRows } = await pool_1.pool.query(`SELECT DISTINCT ta.class_id, c.grade, c.letter
     FROM teacher_assignments ta JOIN classes c ON c.id = ta.class_id
     WHERE ta.teacher_id = $1`, [teacherId]);
    if (classRows.length === 0) {
        res.json([]);
        return;
    }
    const classIds = classRows.map((r) => r.class_id);
    const classMap = {};
    for (const r of classRows)
        classMap[r.class_id] = { grade: r.grade, letter: r.letter };
    const { rows } = await pool_1.pool.query(`SELECT u.id, u.first_name, u.last_name,
            sp.class_id, sp.approved_at, sp.rejection_reason
     FROM users u JOIN student_profiles sp ON sp.user_id = u.id
     WHERE sp.class_id = ANY($1)
     ORDER BY sp.class_id, u.last_name, u.first_name`, [classIds]);
    res.json(rows.map((r) => ({
        user_id: r.id,
        first_name: r.first_name,
        last_name: r.last_name,
        class_id: r.class_id,
        approved_at: r.approved_at,
        rejection_reason: r.rejection_reason,
        grade: classMap[r.class_id]?.grade ?? null,
        letter: classMap[r.class_id]?.letter ?? null,
    })));
});
// GET /teachers/:id/stats — dashboard counts
router.get("/:id/stats", async (req, res) => {
    const id = req.params.id;
    const [lectures, tests, games, classIds] = await Promise.all([
        pool_1.pool.query(`SELECT COUNT(*) FROM lectures WHERE creator_id = $1`, [id]),
        pool_1.pool.query(`SELECT COUNT(*) FROM tests WHERE teacher_id = $1`, [id]),
        pool_1.pool.query(`SELECT COUNT(*) FROM games WHERE teacher_id = $1`, [id]),
        pool_1.pool.query(`SELECT class_id FROM teacher_assignments WHERE teacher_id = $1`, [id]),
    ]);
    const ids = classIds.rows.map((r) => r.class_id);
    let pendingCount = 0;
    if (ids.length > 0) {
        const { rows } = await pool_1.pool.query(`SELECT COUNT(*) FROM student_profiles WHERE class_id = ANY($1) AND approved_at IS NULL`, [ids]);
        pendingCount = Number(rows[0].count);
    }
    res.json({
        lectures: Number(lectures.rows[0].count),
        tests: Number(tests.rows[0].count),
        games: Number(games.rows[0].count),
        pending: pendingCount,
    });
});
// GET /teachers/:id/school-assignments — for settings page
router.get("/:id/school-assignments", async (req, res) => {
    const { rows } = await pool_1.pool.query(`SELECT ta.school_id, ta.class_id,
            s.name AS school_name, s.address AS school_address,
            c.grade, c.letter
     FROM teacher_assignments ta
     JOIN schools s ON s.id = ta.school_id
     JOIN classes c ON c.id = ta.class_id
     WHERE ta.teacher_id = $1
     ORDER BY s.name, c.grade, c.letter`, [req.params.id]);
    const schoolMap = {};
    for (const r of rows) {
        if (!schoolMap[r.school_id]) {
            schoolMap[r.school_id] = { id: r.school_id, name: r.school_name, address: r.school_address, classes: [] };
        }
        schoolMap[r.school_id].classes.push({ grade: r.grade, letter: r.letter });
    }
    res.json(Object.values(schoolMap));
});
// GET /teachers/:id/subjects-and-classes — for content creation forms
router.get("/:id/subjects-and-classes", async (req, res) => {
    const teacherId = req.params.id;
    const [subjectsRes, classRes] = await Promise.all([
        pool_1.pool.query(`SELECT id, name FROM subjects ORDER BY name`),
        pool_1.pool.query(`SELECT DISTINCT c.id, c.grade, c.letter
       FROM teacher_assignments ta JOIN classes c ON c.id = ta.class_id
       WHERE ta.teacher_id = $1 ORDER BY c.grade, c.letter`, [teacherId]),
    ]);
    res.json({ subjects: subjectsRes.rows, classes: classRes.rows });
});
// GET /teachers/:id/analytics — full analytics for teacher
router.get("/:id/analytics", async (req, res) => {
    const id = req.params.id;
    const [lectureRes, testRes, classIdsRes] = await Promise.all([
        pool_1.pool.query(`SELECT COUNT(*) FROM lectures WHERE creator_id = $1`, [id]),
        pool_1.pool.query(`SELECT id FROM tests WHERE teacher_id = $1`, [id]),
        pool_1.pool.query(`SELECT DISTINCT class_id FROM teacher_assignments WHERE teacher_id = $1`, [id]),
    ]);
    const testIds = testRes.rows.map((r) => r.id);
    const classIds = classIdsRes.rows.map((r) => r.class_id);
    const [studentRes, attemptsRes] = await Promise.all([
        classIds.length > 0
            ? pool_1.pool.query(`SELECT COUNT(*) FROM student_profiles WHERE class_id = ANY($1) AND approved_at IS NOT NULL`, [classIds])
            : Promise.resolve({ rows: [{ count: 0 }] }),
        testIds.length > 0
            ? pool_1.pool.query(`SELECT score, finished_at FROM test_attempts WHERE test_id = ANY($1) AND finished_at IS NOT NULL`, [testIds])
            : Promise.resolve({ rows: [] }),
    ]);
    const attempts = attemptsRes.rows
        .map((a) => ({ ...a, score: a.score !== null ? Number(a.score) : null }));
    const validAttempts = attempts.filter((a) => a.score !== null);
    const avgScore = validAttempts.length > 0
        ? Math.round(validAttempts.reduce((s, a) => s + a.score, 0) / validAttempts.length)
        : null;
    const last7Days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        return d.toISOString().split("T")[0];
    });
    const attemptsByDay = last7Days.map((day) => ({
        day: day.slice(5),
        count: attempts.filter((a) => a.finished_at && new Date(a.finished_at).toISOString().startsWith(day)).length,
    }));
    const scoreDistribution = [
        { label: "A'lo (86–100%)", min: 86, max: 100 },
        { label: "Yaxshi (71–85%)", min: 71, max: 85 },
        { label: "Qoniqarli (56–70%)", min: 56, max: 70 },
        { label: "Qoniqarsiz (0–55%)", min: 0, max: 55 },
    ].map((g) => ({
        ...g,
        count: validAttempts.filter((a) => (a.score ?? 0) >= g.min && (a.score ?? 0) <= g.max).length,
        pct: validAttempts.length > 0
            ? Math.round(validAttempts.filter((a) => (a.score ?? 0) >= g.min && (a.score ?? 0) <= g.max).length / validAttempts.length * 100)
            : 0,
    }));
    res.json({
        students: Number(studentRes.rows[0].count),
        tests: testIds.length,
        lectures: Number(lectureRes.rows[0].count),
        avg_score: avgScore,
        attempts_by_day: attemptsByDay,
        score_distribution: scoreDistribution,
        total_attempts: attempts.length,
    });
});
// GET /teachers/:id/subjects
router.get("/:id/subjects", async (req, res) => {
    const { rows } = await pool_1.pool.query(`SELECT DISTINCT sub.id, sub.name
     FROM teacher_assignments ta
     JOIN subjects sub ON sub.id = ta.subject_id
     WHERE ta.teacher_id = $1`, [req.params.id]);
    res.json(rows);
});
// DELETE /teachers/assignments/:schoolId — remove all assignments for teacher in a school
router.delete("/assignments/:schoolId", (0, role_1.requireRole)("teacher", "super_admin"), async (req, res) => {
    await pool_1.pool.query(`DELETE FROM teacher_assignments WHERE teacher_id = $1 AND school_id = $2`, [req.user.sub, req.params.schoolId]);
    res.json({ ok: true });
});
// POST /teachers/assignments — teacher class+subject biriktirishini ro'yxatdan o'tkazish
router.post("/assignments", (0, role_1.requireRole)("teacher", "super_admin"), async (req, res) => {
    const parsed = zod_1.z.object({
        school_id: zod_1.z.string().uuid(),
        class_ids: zod_1.z.array(zod_1.z.string().uuid()).min(1),
        subject_id: zod_1.z.string().uuid().optional(),
    }).safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message });
        return;
    }
    for (const class_id of parsed.data.class_ids) {
        await pool_1.pool.query(`INSERT INTO teacher_assignments (teacher_id, school_id, class_id, subject_id)
       VALUES ($1,$2,$3,$4) ON CONFLICT (teacher_id, class_id, subject_id) DO NOTHING`, [req.user.sub, parsed.data.school_id, class_id, parsed.data.subject_id ?? "00000000-0000-0000-0000-000000000000"]);
    }
    res.status(201).json({ ok: true });
});
exports.default = router;
