"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const role_1 = require("../middleware/role");
const asyncHandler_1 = require("../utils/asyncHandler");
const logger_1 = require("../utils/logger");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
function promoteLevel(level) {
    if (level === "low")
        return "medium";
    if (level === "medium")
        return "high";
    return "high";
}
function demoteLevel(level) {
    if (level === "high")
        return "medium";
    if (level === "medium")
        return "low";
    return "low";
}
async function applyLevelDelta(studentId, delta) {
    const profileRes = await pool_1.pool.query("SELECT difficulty_level, level_progress_score FROM student_profiles WHERE user_id=$1", [studentId]);
    const profile = profileRes.rows[0];
    if (!profile)
        return;
    const baseScore = profile.level_progress_score ?? 3;
    const nextScore = Math.max(0, Math.min(6, baseScore + delta));
    if (nextScore >= 6) {
        const nextLevel = promoteLevel(profile.difficulty_level);
        await pool_1.pool.query("UPDATE student_profiles SET difficulty_level=$1, level_progress_score=3 WHERE user_id=$2", [nextLevel, studentId]);
        return;
    }
    if (nextScore <= 0) {
        const nextLevel = demoteLevel(profile.difficulty_level);
        await pool_1.pool.query("UPDATE student_profiles SET difficulty_level=$1, level_progress_score=3 WHERE user_id=$2", [nextLevel, studentId]);
        return;
    }
    await pool_1.pool.query("UPDATE student_profiles SET level_progress_score=$1 WHERE user_id=$2", [nextScore, studentId]);
}
router.get("/", (0, asyncHandler_1.ah)(async (req, res) => {
    const { teacher_id, class_id } = req.query;
    if (teacher_id) {
        try {
            const { rows } = await pool_1.pool.query(`SELECT a.*,
                json_build_object('id', sub.id, 'name', sub.name) AS subjects,
                COALESCE(
                  (
                    SELECT json_agg(
                      json_build_object('id', c2.id, 'grade', c2.grade, 'letter', c2.letter)
                      ORDER BY c2.grade, c2.letter
                    )
                    FROM assignment_classes ac
                    JOIN classes c2 ON c2.id = ac.class_id
                    WHERE ac.assignment_id = a.id
                  ),
                  CASE
                    WHEN c.id IS NOT NULL
                      THEN json_build_array(json_build_object('id', c.id, 'grade', c.grade, 'letter', c.letter))
                    ELSE '[]'::json
                  END
                ) AS classes
         FROM assignments a
         JOIN subjects sub ON sub.id = a.subject_id
         LEFT JOIN classes c ON c.id = a.class_id
         WHERE a.teacher_id=$1 ORDER BY a.created_at DESC`, [teacher_id]);
            res.json(rows);
        }
        catch {
            const { rows } = await pool_1.pool.query(`SELECT a.*,
                json_build_object('id', sub.id, 'name', sub.name) AS subjects,
                CASE
                  WHEN c.id IS NOT NULL
                    THEN json_build_array(json_build_object('id', c.id, 'grade', c.grade, 'letter', c.letter))
                  ELSE '[]'::json
                END AS classes
         FROM assignments a
         JOIN subjects sub ON sub.id = a.subject_id
         LEFT JOIN classes c ON c.id = a.class_id
         WHERE a.teacher_id=$1 ORDER BY a.created_at DESC`, [teacher_id]);
            res.json(rows);
        }
    }
    else if (class_id) {
        try {
            const { rows } = await pool_1.pool.query(`SELECT a.*,
                json_build_object('id', sub.id, 'name', sub.name) AS subjects,
                COALESCE(
                  (
                    SELECT json_agg(
                      json_build_object('id', c2.id, 'grade', c2.grade, 'letter', c2.letter)
                      ORDER BY c2.grade, c2.letter
                    )
                    FROM assignment_classes ac
                    JOIN classes c2 ON c2.id = ac.class_id
                    WHERE ac.assignment_id = a.id
                  ),
                  CASE
                    WHEN c.id IS NOT NULL
                      THEN json_build_array(json_build_object('id', c.id, 'grade', c.grade, 'letter', c.letter))
                    ELSE '[]'::json
                  END
                ) AS classes
         FROM assignments a
         JOIN subjects sub ON sub.id = a.subject_id
         LEFT JOIN classes c ON c.id = a.class_id
         WHERE (
           a.class_id = $1 OR EXISTS (
             SELECT 1 FROM assignment_classes ac
             WHERE ac.assignment_id = a.id AND ac.class_id = $1
           )
         )
         ORDER BY a.created_at DESC`, [class_id]);
            res.json(rows);
        }
        catch {
            const { rows } = await pool_1.pool.query(`SELECT a.*,
                json_build_object('id', sub.id, 'name', sub.name) AS subjects,
                CASE
                  WHEN c.id IS NOT NULL
                    THEN json_build_array(json_build_object('id', c.id, 'grade', c.grade, 'letter', c.letter))
                  ELSE '[]'::json
                END AS classes
         FROM assignments a
         JOIN subjects sub ON sub.id = a.subject_id
         LEFT JOIN classes c ON c.id = a.class_id
         WHERE a.class_id=$1
         ORDER BY a.created_at DESC`, [class_id]);
            res.json(rows);
        }
    }
    else {
        res.status(400).json({ error: "teacher_id yoki class_id kerak" });
    }
}));
router.get("/:id", (0, asyncHandler_1.ah)(async (req, res) => {
    let rows;
    try {
        const result = await pool_1.pool.query(`SELECT a.*,
              json_build_object('id', sub.id, 'name', sub.name) AS subjects,
              COALESCE(
                (
                  SELECT json_agg(
                    json_build_object('id', c2.id, 'grade', c2.grade, 'letter', c2.letter)
                    ORDER BY c2.grade, c2.letter
                  )
                  FROM assignment_classes ac
                  JOIN classes c2 ON c2.id = ac.class_id
                  WHERE ac.assignment_id = a.id
                ),
                CASE
                  WHEN c.id IS NOT NULL
                    THEN json_build_array(json_build_object('id', c.id, 'grade', c.grade, 'letter', c.letter))
                  ELSE '[]'::json
                END
              ) AS classes
       FROM assignments a
       JOIN subjects sub ON sub.id = a.subject_id
       LEFT JOIN classes c ON c.id = a.class_id
       WHERE a.id=$1`, [req.params.id]);
        rows = result.rows;
    }
    catch {
        const result = await pool_1.pool.query(`SELECT a.*,
              json_build_object('id', sub.id, 'name', sub.name) AS subjects,
              CASE
                WHEN c.id IS NOT NULL
                  THEN json_build_array(json_build_object('id', c.id, 'grade', c.grade, 'letter', c.letter))
                ELSE '[]'::json
              END AS classes
       FROM assignments a
       JOIN subjects sub ON sub.id = a.subject_id
       LEFT JOIN classes c ON c.id = a.class_id
       WHERE a.id=$1`, [req.params.id]);
        rows = result.rows;
    }
    if (!rows[0]) {
        res.status(404).json({ error: "Topilmadi" });
        return;
    }
    res.json(rows[0]);
}));
const AssignmentSchema = zod_1.z.object({
    title: zod_1.z.string().min(1),
    description: zod_1.z.string().nullable().optional(),
    subject_id: zod_1.z.string().uuid(),
    class_ids: zod_1.z.array(zod_1.z.string().uuid()).min(1),
    deadline: zod_1.z.string().nullable().optional(),
    max_score: zod_1.z.number().int().positive().default(100),
    file_url: zod_1.z.string().url().nullable().optional(),
    difficulty_level: zod_1.z.enum(["low", "medium", "high"]).default("medium"),
    is_for_disabled: zod_1.z.boolean().default(false),
});
router.post("/", (0, role_1.requireRole)("teacher", "super_admin"), (0, asyncHandler_1.ah)(async (req, res) => {
    logger_1.logger.req(req, "POST /assignments", { user: req.user?.sub });
    const parsed = AssignmentSchema.safeParse(req.body);
    if (!parsed.success) {
        logger_1.logger.warn("POST /assignments validation failed", { errors: parsed.error.errors, body: req.body });
        res.status(400).json({ error: parsed.error.errors[0]?.message });
        return;
    }
    const d = parsed.data;
    const uniqueClassIds = [...new Set(d.class_ids)];
    const primaryClassId = uniqueClassIds[0];
    const { rows } = await pool_1.pool.query(`INSERT INTO assignments (teacher_id, subject_id, class_id, title, description, deadline, max_score, file_url, difficulty_level, is_for_disabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [req.user.sub, d.subject_id, primaryClassId, d.title, d.description ?? null,
        d.deadline ?? null, d.max_score, d.file_url ?? null, d.difficulty_level, d.is_for_disabled]);
    const assignmentId = rows[0].id;
    try {
        for (const classId of uniqueClassIds) {
            await pool_1.pool.query(`INSERT INTO assignment_classes (assignment_id, class_id)
         VALUES ($1,$2)
         ON CONFLICT (assignment_id, class_id) DO NOTHING`, [assignmentId, classId]);
        }
    }
    catch {
        // Jadval yo'q bo'lsa bir marta yaratib, class mapping'ni qayta yozamiz.
        try {
            await pool_1.pool.query(`
        CREATE TABLE IF NOT EXISTS assignment_classes (
          assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
          class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
          PRIMARY KEY (assignment_id, class_id)
        )
      `);
            for (const classId of uniqueClassIds) {
                await pool_1.pool.query(`INSERT INTO assignment_classes (assignment_id, class_id)
           VALUES ($1,$2)
           ON CONFLICT (assignment_id, class_id) DO NOTHING`, [assignmentId, classId]);
            }
        }
        catch {
            // Agar yaratish huquqi bo'lmasa, legacy class_id bilan ishlashda davom etadi.
        }
    }
    logger_1.logger.info("POST /assignments: created", { assignmentId, classIds: uniqueClassIds, user: req.user?.sub });
    res.status(201).json({ id: assignmentId });
}));
router.delete("/:id", (0, role_1.requireRole)("teacher", "super_admin"), (0, asyncHandler_1.ah)(async (req, res) => {
    await pool_1.pool.query("DELETE FROM assignments WHERE id=$1 AND (teacher_id=$2 OR $3='super_admin')", [req.params.id, req.user.sub, req.user.role]);
    res.json({ ok: true });
}));
// GET /assignments/:id/submissions
router.get("/:id/submissions", (0, role_1.requireRole)("teacher", "director", "super_admin"), (0, asyncHandler_1.ah)(async (req, res) => {
    const { rows } = await pool_1.pool.query(`SELECT asub.*, a.difficulty_level, u.first_name, u.last_name
     FROM assignment_submissions asub
     JOIN assignments a ON a.id = asub.assignment_id
     JOIN users u ON u.id = asub.student_id
     WHERE asub.assignment_id=$1
     ORDER BY asub.submitted_at DESC`, [req.params.id]);
    res.json(rows);
}));
// POST /assignments/:id/submit (student)
router.post("/:id/submit", (0, role_1.requireRole)("student"), (0, asyncHandler_1.ah)(async (req, res) => {
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
}));
// POST /assignments/:id/progress (student: bajardim / bajara olmadim)
router.post("/:id/progress", (0, role_1.requireRole)("student"), (0, asyncHandler_1.ah)(async (req, res) => {
    const parsed = zod_1.z.object({
        action: zod_1.z.enum(["done", "cannot_do"]),
    }).safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "action noto'g'ri" });
        return;
    }
    const studentId = req.user.sub;
    const assignmentId = req.params.id;
    const assignmentRes = await pool_1.pool.query("SELECT id, class_id, difficulty_level FROM assignments WHERE id=$1", [assignmentId]);
    const assignment = assignmentRes.rows[0];
    if (!assignment) {
        res.status(404).json({ error: "Topshiriq topilmadi" });
        return;
    }
    const profileRes = await pool_1.pool.query("SELECT class_id FROM student_profiles WHERE user_id=$1", [studentId]);
    const profile = profileRes.rows[0];
    if (!profile) {
        res.status(400).json({ error: "O'quvchi profili topilmadi" });
        return;
    }
    let canAccess = profile.class_id === assignment.class_id;
    if (!canAccess) {
        try {
            const accessRes = await pool_1.pool.query(`SELECT 1
         FROM assignment_classes
         WHERE assignment_id = $1 AND class_id = $2
         LIMIT 1`, [assignmentId, profile.class_id]);
            canAccess = Boolean(accessRes.rows[0]);
        }
        catch {
            canAccess = profile.class_id === assignment.class_id;
        }
    }
    if (!canAccess) {
        res.status(403).json({ error: "Bu topshiriq sizga tegishli emas" });
        return;
    }
    const progressState = parsed.data.action === "done" ? "done_pending" : "cannot_do";
    const { rows: existing } = await pool_1.pool.query("SELECT id FROM assignment_submissions WHERE assignment_id=$1 AND student_id=$2", [assignmentId, studentId]);
    let submissionId;
    if (existing.length > 0) {
        submissionId = existing[0].id;
        await pool_1.pool.query(`UPDATE assignment_submissions
       SET submitted_at=NOW(), progress_state=$1, teacher_reviewed_at=NULL, teacher_reviewed_by=NULL
       WHERE id=$2`, [progressState, submissionId]);
    }
    else {
        const inserted = await pool_1.pool.query(`INSERT INTO assignment_submissions (assignment_id, student_id, progress_state)
       VALUES ($1,$2,$3) RETURNING id`, [assignmentId, studentId, progressState]);
        submissionId = inserted.rows[0].id;
    }
    if (parsed.data.action === "cannot_do")
        await applyLevelDelta(studentId, -1);
    res.status(200).json({ id: submissionId, progress_state: progressState });
}));
// GET /assignments/:id/submission (student o'zining topshirig'ini ko'radi)
router.get("/:id/submission", (0, role_1.requireRole)("student"), (0, asyncHandler_1.ah)(async (req, res) => {
    const { rows } = await pool_1.pool.query("SELECT * FROM assignment_submissions WHERE assignment_id=$1 AND student_id=$2", [req.params.id, req.user.sub]);
    res.json(rows[0] ?? null);
}));
// PUT /assignments/submissions/:submissionId/progress-review (teacher approve/reject)
router.put("/submissions/:submissionId/progress-review", (0, role_1.requireRole)("teacher", "super_admin"), (0, asyncHandler_1.ah)(async (req, res) => {
    const parsed = zod_1.z.object({
        decision: zod_1.z.enum(["approve", "reject"]),
    }).safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "decision noto'g'ri" });
        return;
    }
    const subRes = await pool_1.pool.query(`SELECT asub.id, asub.student_id, asub.progress_state, a.teacher_id, a.difficulty_level
     FROM assignment_submissions asub
     JOIN assignments a ON a.id = asub.assignment_id
     WHERE asub.id=$1`, [req.params.submissionId]);
    const submission = subRes.rows[0];
    if (!submission) {
        res.status(404).json({ error: "Submission topilmadi" });
        return;
    }
    if (req.user.role !== "super_admin" && submission.teacher_id !== req.user.sub) {
        res.status(403).json({ error: "Ruxsat yo'q" });
        return;
    }
    if (submission.progress_state !== "done_pending") {
        res.status(400).json({ error: "Tasdiqlash uchun holat mos emas" });
        return;
    }
    await applyLevelDelta(submission.student_id, parsed.data.decision === "approve" ? 1 : -1);
    await pool_1.pool.query(`UPDATE assignment_submissions
     SET progress_state=$1, teacher_reviewed_at=NOW(), teacher_reviewed_by=$2
     WHERE id=$3`, [parsed.data.decision === "approve" ? "done_approved" : "done_rejected", req.user.sub, req.params.submissionId]);
    res.json({ ok: true });
}));
// PUT /submissions/:submissionId/grade (teacher)
router.put("/submissions/:submissionId/grade", (0, role_1.requireRole)("teacher", "super_admin"), (0, asyncHandler_1.ah)(async (req, res) => {
    const parsed = zod_1.z.object({ score: zod_1.z.number().min(0), teacher_comment: zod_1.z.string().nullable().optional() })
        .safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "score kerak" });
        return;
    }
    await pool_1.pool.query("UPDATE assignment_submissions SET score=$1, teacher_comment=$2 WHERE id=$3", [parsed.data.score, parsed.data.teacher_comment ?? null, req.params.submissionId]);
    res.json({ ok: true });
}));
exports.default = router;
