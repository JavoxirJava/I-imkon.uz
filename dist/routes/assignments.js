"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const role_1 = require("../middleware/role");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
router.get("/", async (req, res) => {
    const { teacher_id, class_id } = req.query;
    if (teacher_id) {
        const { rows } = await pool_1.pool.query(`SELECT a.*, sub.name AS subject_name FROM assignments a
       JOIN subjects sub ON sub.id = a.subject_id
       WHERE a.teacher_id=$1 ORDER BY a.created_at DESC`, [teacher_id]);
        res.json(rows);
    }
    else if (class_id) {
        const { rows } = await pool_1.pool.query(`SELECT a.*, sub.name AS subject_name FROM assignments a
       JOIN subjects sub ON sub.id = a.subject_id
       WHERE a.class_id=$1 ORDER BY a.created_at DESC`, [class_id]);
        res.json(rows);
    }
    else {
        res.status(400).json({ error: "teacher_id yoki class_id kerak" });
    }
});
router.get("/:id", async (req, res) => {
    const { rows } = await pool_1.pool.query(`SELECT a.*, sub.name AS subject_name FROM assignments a
     JOIN subjects sub ON sub.id = a.subject_id WHERE a.id=$1`, [req.params.id]);
    if (!rows[0]) {
        res.status(404).json({ error: "Topilmadi" });
        return;
    }
    res.json(rows[0]);
});
const AssignmentSchema = zod_1.z.object({
    title: zod_1.z.string().min(1),
    description: zod_1.z.string().nullable().optional(),
    subject_id: zod_1.z.string().uuid(),
    class_ids: zod_1.z.array(zod_1.z.string().uuid()).min(1),
    deadline: zod_1.z.string().datetime().nullable().optional(),
    max_score: zod_1.z.number().int().positive().default(100),
    file_url: zod_1.z.string().url().nullable().optional(),
});
router.post("/", (0, role_1.requireRole)("teacher", "super_admin"), async (req, res) => {
    const parsed = AssignmentSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message });
        return;
    }
    const d = parsed.data;
    const ids = [];
    for (const classId of d.class_ids) {
        const { rows } = await pool_1.pool.query(`INSERT INTO assignments (teacher_id, subject_id, class_id, title, description, deadline, max_score, file_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [req.user.sub, d.subject_id, classId, d.title, d.description ?? null,
            d.deadline ?? null, d.max_score, d.file_url ?? null]);
        ids.push(rows[0].id);
    }
    res.status(201).json({ id: ids[0], ids });
});
router.delete("/:id", (0, role_1.requireRole)("teacher", "super_admin"), async (req, res) => {
    await pool_1.pool.query("DELETE FROM assignments WHERE id=$1 AND (teacher_id=$2 OR $3='super_admin')", [req.params.id, req.user.sub, req.user.role]);
    res.json({ ok: true });
});
// GET /assignments/:id/submissions
router.get("/:id/submissions", (0, role_1.requireRole)("teacher", "director", "super_admin"), async (_req, res) => {
    const { rows } = await pool_1.pool.query(`SELECT asub.*, u.first_name, u.last_name
     FROM assignment_submissions asub
     JOIN users u ON u.id = asub.student_id
     WHERE asub.assignment_id=$1
     ORDER BY asub.submitted_at DESC`, [_req.params.id]);
    res.json(rows);
});
// POST /assignments/:id/submit (student)
router.post("/:id/submit", (0, role_1.requireRole)("student"), async (req, res) => {
    const { content, file_url } = req.body;
    const studentId = req.user.sub;
    const assignmentId = req.params.id;
    const { rows: existing } = await pool_1.pool.query("SELECT id FROM assignment_submissions WHERE assignment_id=$1 AND student_id=$2", [assignmentId, studentId]);
    if (existing.length > 0) {
        await pool_1.pool.query("UPDATE assignment_submissions SET content=$1, file_url=$2, submitted_at=NOW() WHERE id=$3", [content ?? null, file_url ?? null, existing[0].id]);
        res.json({ id: existing[0].id });
    }
    else {
        const { rows } = await pool_1.pool.query(`INSERT INTO assignment_submissions (assignment_id, student_id, content, file_url)
       VALUES ($1,$2,$3,$4) RETURNING id`, [assignmentId, studentId, content ?? null, file_url ?? null]);
        res.status(201).json({ id: rows[0].id });
    }
});
// GET /assignments/:id/submission (student o'zining topshirig'ini ko'radi)
router.get("/:id/submission", (0, role_1.requireRole)("student"), async (req, res) => {
    const { rows } = await pool_1.pool.query("SELECT * FROM assignment_submissions WHERE assignment_id=$1 AND student_id=$2", [req.params.id, req.user.sub]);
    res.json(rows[0] ?? null);
});
// PUT /submissions/:submissionId/grade (teacher)
router.put("/submissions/:submissionId/grade", (0, role_1.requireRole)("teacher", "super_admin"), async (_req, res) => {
    const parsed = zod_1.z.object({ score: zod_1.z.number().min(0), teacher_comment: zod_1.z.string().nullable().optional() })
        .safeParse(_req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "score kerak" });
        return;
    }
    await pool_1.pool.query("UPDATE assignment_submissions SET score=$1, teacher_comment=$2 WHERE id=$3", [parsed.data.score, parsed.data.teacher_comment ?? null, _req.params.submissionId]);
    res.json({ ok: true });
});
exports.default = router;
