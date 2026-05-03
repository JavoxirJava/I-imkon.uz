"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const role_1 = require("../middleware/role");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
// GET /parents/children — mening bolalarim
router.get("/children", (0, role_1.requireRole)("parent"), async (req, res) => {
    const { rows } = await pool_1.pool.query(`SELECT u.id, u.first_name, u.last_name, u.phone, u.status,
            sp.class_id, sp.school_id, sp.approved_at,
            c.grade, c.letter,
            s.name AS school_name
     FROM parent_students ps
     JOIN users u ON u.id = ps.student_id
     LEFT JOIN student_profiles sp ON sp.user_id = u.id
     LEFT JOIN classes c ON c.id = sp.class_id
     LEFT JOIN schools s ON s.id = sp.school_id
     WHERE ps.parent_id = $1`, [req.user.sub]);
    res.json(rows);
});
// POST /parents/link — bolani bog'lash (telefon raqami orqali)
router.post("/link", (0, role_1.requireRole)("parent"), async (req, res) => {
    const parsed = zod_1.z.object({ phone: zod_1.z.string() }).safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "Bolaning telefon raqami kerak" });
        return;
    }
    const { rows: studentRows } = await pool_1.pool.query("SELECT id, first_name, last_name, role FROM users WHERE phone = $1 AND role = 'student'", [parsed.data.phone]);
    if (studentRows.length === 0) {
        res.status(404).json({ error: "Bu raqamda o'quvchi topilmadi" });
        return;
    }
    const student = studentRows[0];
    await pool_1.pool.query(`INSERT INTO parent_students (parent_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [req.user.sub, student.id]);
    res.json({ ok: true, student: { id: student.id, first_name: student.first_name, last_name: student.last_name } });
});
// GET /parents/children/:studentId/results — bolaning natijalari
router.get("/children/:studentId/results", (0, role_1.requireRole)("parent"), async (req, res) => {
    const parentId = req.user.sub;
    const { studentId } = req.params;
    // Ota-ona o'sha bolaga biriktirilganligini tekshirish
    const { rows: link } = await pool_1.pool.query("SELECT 1 FROM parent_students WHERE parent_id = $1 AND student_id = $2", [parentId, studentId]);
    if (link.length === 0) {
        res.status(403).json({ error: "Bu o'quvchiga ruxsat yo'q" });
        return;
    }
    // Test natijalari
    const { rows: testResults } = await pool_1.pool.query(`SELECT ta.id, ta.started_at, ta.finished_at, ta.score,
            t.title AS test_title, t.test_type,
            sub.name AS subject_name
     FROM test_attempts ta
     JOIN tests t ON t.id = ta.test_id
     JOIN subjects sub ON sub.id = t.subject_id
     WHERE ta.student_id = $1 AND ta.finished_at IS NOT NULL
     ORDER BY ta.finished_at DESC
     LIMIT 50`, [studentId]);
    // O'yin natijalari
    const { rows: gameResults } = await pool_1.pool.query(`SELECT ga.id, ga.score, ga.duration, ga.completed_at,
            g.title AS game_title,
            sub.name AS subject_name
     FROM game_attempts ga
     JOIN games g ON g.id = ga.game_id
     JOIN subjects sub ON sub.id = g.subject_id
     WHERE ga.student_id = $1
     ORDER BY ga.completed_at DESC
     LIMIT 20`, [studentId]);
    // Vazifa natijalari
    const { rows: assignmentResults } = await pool_1.pool.query(`SELECT asub.id, asub.submitted_at, asub.score, asub.teacher_comment,
            a.title AS assignment_title, a.max_score,
            sub.name AS subject_name
     FROM assignment_submissions asub
     JOIN assignments a ON a.id = asub.assignment_id
     JOIN subjects sub ON sub.id = a.subject_id
     WHERE asub.student_id = $1
     ORDER BY asub.submitted_at DESC
     LIMIT 20`, [studentId]);
    res.json({ tests: testResults, games: gameResults, assignments: assignmentResults });
});
// GET /parents/children/:studentId/teachers — bolaning o'qituvchilari
router.get("/children/:studentId/teachers", (0, role_1.requireRole)("parent"), async (req, res) => {
    const { studentId } = req.params;
    const parentId = req.user.sub;
    const { rows: link } = await pool_1.pool.query("SELECT 1 FROM parent_students WHERE parent_id = $1 AND student_id = $2", [parentId, studentId]);
    if (link.length === 0) {
        res.status(403).json({ error: "Ruxsat yo'q" });
        return;
    }
    const { rows } = await pool_1.pool.query(`SELECT DISTINCT u.id, u.first_name, u.last_name, u.phone,
                     sub.name AS subject_name
     FROM student_profiles sp
     JOIN teacher_assignments ta ON ta.class_id = sp.class_id
     JOIN users u ON u.id = ta.teacher_id
     JOIN subjects sub ON sub.id = ta.subject_id
     WHERE sp.user_id = $1`, [studentId]);
    res.json(rows);
});
// GET /parents/list — director/teacher uchun barcha parentlar (pending + active)
router.get("/list", (0, role_1.requireRole)("director", "teacher", "super_admin"), async (req, res) => {
    const userId = req.user.sub;
    const role = req.user.role;
    let schoolId = null;
    if (role === "director") {
        const { rows } = await pool_1.pool.query(`SELECT id FROM schools WHERE director_id = $1`, [userId]);
        schoolId = rows[0]?.id ?? null;
    }
    else if (role === "teacher") {
        const { rows } = await pool_1.pool.query(`SELECT DISTINCT school_id FROM teacher_assignments WHERE teacher_id = $1 LIMIT 1`, [userId]);
        schoolId = rows[0]?.school_id ?? null;
    }
    const query = `
    SELECT u.id, u.first_name, u.last_name, u.phone, u.status, u.created_at,
           (SELECT json_agg(json_build_object('id', s.id, 'first_name', s.first_name, 'last_name', s.last_name))
            FROM parent_students ps2
            JOIN users s ON s.id = ps2.student_id
            WHERE ps2.parent_id = u.id) AS children
    FROM users u
    WHERE u.role = 'parent'
      ${schoolId ? `AND EXISTS (
          SELECT 1 FROM parent_students ps
          JOIN student_profiles sp ON sp.user_id = ps.student_id
          WHERE ps.parent_id = u.id AND sp.school_id = $1
        )` : ""}
    ORDER BY u.status = 'pending' DESC, u.created_at DESC`;
    const { rows } = await pool_1.pool.query(query, schoolId ? [schoolId] : []);
    res.json(rows);
});
// GET /parents/pending — faqat pending (orqaga mos kelish uchun)
router.get("/pending", (0, role_1.requireRole)("director", "teacher", "super_admin"), async (req, res) => {
    const userId = req.user.sub;
    const role = req.user.role;
    let schoolId = null;
    if (role === "director") {
        const { rows } = await pool_1.pool.query(`SELECT id FROM schools WHERE director_id = $1`, [userId]);
        schoolId = rows[0]?.id ?? null;
    }
    else if (role === "teacher") {
        const { rows } = await pool_1.pool.query(`SELECT DISTINCT school_id FROM teacher_assignments WHERE teacher_id = $1 LIMIT 1`, [userId]);
        schoolId = rows[0]?.school_id ?? null;
    }
    const query = `
    SELECT u.id, u.first_name, u.last_name, u.phone, u.status, u.created_at,
           (SELECT json_agg(json_build_object('id', s.id, 'first_name', s.first_name, 'last_name', s.last_name))
            FROM parent_students ps2
            JOIN users s ON s.id = ps2.student_id
            WHERE ps2.parent_id = u.id) AS children
    FROM users u
    WHERE u.role = 'parent' AND u.status = 'pending'
      ${schoolId ? `AND EXISTS (
          SELECT 1 FROM parent_students ps
          JOIN student_profiles sp ON sp.user_id = ps.student_id
          WHERE ps.parent_id = u.id AND sp.school_id = $1
        )` : ""}
    ORDER BY u.created_at DESC`;
    const { rows } = await pool_1.pool.query(query, schoolId ? [schoolId] : []);
    res.json(rows);
});
// PUT /parents/approve/:parentId
router.put("/approve/:parentId", (0, role_1.requireRole)("director", "teacher", "super_admin"), async (req, res) => {
    await pool_1.pool.query(`UPDATE users SET status='active' WHERE id=$1 AND role='parent'`, [req.params.parentId]);
    res.json({ ok: true });
});
// PUT /parents/reject/:parentId
router.put("/reject/:parentId", (0, role_1.requireRole)("director", "teacher", "super_admin"), async (req, res) => {
    const { reason } = req.body;
    await pool_1.pool.query(`UPDATE users SET status='rejected' WHERE id=$1 AND role='parent'`, [req.params.parentId]);
    res.json({ ok: true, reason });
});
exports.default = router;
