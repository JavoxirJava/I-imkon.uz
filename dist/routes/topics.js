"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const role_1 = require("../middleware/role");
const asyncHandler_1 = require("../utils/asyncHandler");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
// GET /topics?teacher_id=X
router.get("/", (0, asyncHandler_1.ah)(async (req, res) => {
    const { teacher_id } = req.query;
    if (!teacher_id) {
        res.status(400).json({ error: "teacher_id kerak" });
        return;
    }
    const { rows } = await pool_1.pool.query(`SELECT t.id, t.name, t.subject_id, t.teacher_id, t.created_at,
            s.name AS subject_name
     FROM topics t
     JOIN subjects s ON s.id = t.subject_id
     WHERE t.teacher_id = $1
     ORDER BY s.name, t.name`, [teacher_id]);
    res.json(rows);
}));
const TopicSchema = zod_1.z.object({
    name: zod_1.z.string().min(2),
    subject_id: zod_1.z.string().uuid(),
    class_ids: zod_1.z.array(zod_1.z.string().uuid()).min(1),
});
// POST /topics
router.post("/", (0, role_1.requireRole)("teacher", "super_admin"), (0, asyncHandler_1.ah)(async (req, res) => {
    const parsed = TopicSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message });
        return;
    }
    const { name, subject_id, class_ids } = parsed.data;
    const teacherId = req.user.sub;
    const { rows: subjectRows } = await pool_1.pool.query("SELECT id, name FROM subjects WHERE id = $1", [subject_id]);
    if (!subjectRows[0]) {
        res.status(400).json({ error: "Fan topilmadi" });
        return;
    }
    const { rows } = await pool_1.pool.query(`INSERT INTO topics (name, subject_id, teacher_id)
     VALUES ($1, $2, $3)
     RETURNING id, name, subject_id, teacher_id, created_at`, [name.trim(), subject_id, teacherId]);
    const topic = rows[0];
    await pool_1.pool.query(`INSERT INTO topic_classes (topic_id, class_id)
     SELECT $1, unnest($2::uuid[])
     ON CONFLICT DO NOTHING`, [topic.id, [...new Set(class_ids)]]);
    res.status(201).json({
        ...topic,
        subject_name: subjectRows[0].name,
    });
}));
// DELETE /topics/:id
router.delete("/:id", (0, role_1.requireRole)("teacher", "super_admin"), (0, asyncHandler_1.ah)(async (req, res) => {
    await pool_1.pool.query("DELETE FROM topics WHERE id = $1 AND (teacher_id = $2 OR $3 = 'super_admin')", [req.params.id, req.user.sub, req.user.role]);
    res.json({ ok: true });
}));
exports.default = router;
