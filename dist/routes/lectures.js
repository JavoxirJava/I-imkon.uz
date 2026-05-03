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
// GET /lectures?class_id=&teacher_id=
router.get("/", (0, asyncHandler_1.ah)(async (req, res) => {
    const { class_id, teacher_id } = req.query;
    const conditions = [];
    const params = [];
    if (teacher_id) {
        params.push(teacher_id);
        conditions.push(`l.creator_id = $${params.length}`);
    }
    if (class_id) {
        params.push(class_id);
        conditions.push(`l.class_id = $${params.length}`);
    }
    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    const { rows } = await pool_1.pool.query(`SELECT l.*, sub.name AS subject_name,
            c.grade, c.letter,
            COALESCE(
              (SELECT json_agg(json_build_object('id', ls.id, 'vtt_url', ls.vtt_url, 'source', ls.source))
               FROM lecture_subtitles ls WHERE ls.lecture_id = l.id), '[]'
            ) AS subtitles
     FROM lectures l
     JOIN subjects sub ON sub.id = l.subject_id
     LEFT JOIN classes c ON c.id = l.class_id
     ${where}
     ORDER BY l.created_at DESC`, params);
    res.json(rows);
}));
// GET /lectures/:id
router.get("/:id", (0, asyncHandler_1.ah)(async (req, res) => {
    const { rows } = await pool_1.pool.query(`SELECT l.*, sub.name AS subject_name,
            c.grade, c.letter,
            COALESCE(
              (SELECT json_agg(json_build_object('id', ls.id, 'vtt_url', ls.vtt_url, 'language', ls.language, 'source', ls.source))
               FROM lecture_subtitles ls WHERE ls.lecture_id = l.id), '[]'
            ) AS subtitles
     FROM lectures l
     JOIN subjects sub ON sub.id = l.subject_id
     LEFT JOIN classes c ON c.id = l.class_id
     WHERE l.id = $1`, [req.params.id]);
    if (!rows[0]) {
        res.status(404).json({ error: "Topilmadi" });
        return;
    }
    res.json(rows[0]);
}));
// POST /lectures
const LectureSchema = zod_1.z.object({
    subject_id: zod_1.z.string().uuid(),
    class_id: zod_1.z.string().uuid().nullable().optional(),
    title: zod_1.z.string().min(1).max(500),
    description: zod_1.z.string().nullable().optional(),
    content_type: zod_1.z.enum(["pdf", "video", "audio", "ppt"]),
    file_url: zod_1.z.string().url(),
    subtitle_vtt_url: zod_1.z.string().url().optional(),
    subtitle_source: zod_1.z.enum(["manual", "ai"]).optional(),
});
router.post("/", (0, role_1.requireRole)("teacher", "super_admin"), (0, asyncHandler_1.ah)(async (req, res) => {
    logger_1.logger.req(req, "POST /lectures", { user: req.user?.sub, content_type: req.body?.content_type });
    const parsed = LectureSchema.safeParse(req.body);
    if (!parsed.success) {
        logger_1.logger.warn("POST /lectures validation failed", { errors: parsed.error.errors, body: req.body });
        res.status(400).json({ error: parsed.error.errors[0]?.message });
        return;
    }
    const d = parsed.data;
    // school_id from teacher assignments
    const { rows: ta } = await pool_1.pool.query("SELECT school_id FROM teacher_assignments WHERE teacher_id = $1 LIMIT 1", [req.user.sub]);
    const school_id = ta[0]?.school_id ?? null;
    if (!school_id) {
        logger_1.logger.warn("POST /lectures: teacher has no school assignment", { user: req.user?.sub });
    }
    const { rows } = await pool_1.pool.query(`INSERT INTO lectures (creator_id, school_id, subject_id, class_id, title, description, content_type, file_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [req.user.sub, school_id, d.subject_id, d.class_id ?? null, d.title, d.description ?? null, d.content_type, d.file_url]);
    const lectureId = rows[0].id;
    logger_1.logger.info("POST /lectures: created", { lectureId, user: req.user?.sub });
    if (d.subtitle_vtt_url) {
        await pool_1.pool.query(`INSERT INTO lecture_subtitles (lecture_id, vtt_url, language, source) VALUES ($1,$2,'uz',$3)
       ON CONFLICT DO NOTHING`, [lectureId, d.subtitle_vtt_url, d.subtitle_source ?? "manual"]);
    }
    res.status(201).json({ id: lectureId });
}));
// POST /lectures/:id/subtitles — upsert subtitle (used by Whisper API route)
router.post("/:id/subtitles", (0, asyncHandler_1.ah)(async (req, res) => {
    const { vtt_url, language, source } = req.body;
    if (!vtt_url) {
        res.status(400).json({ error: "vtt_url kerak" });
        return;
    }
    await pool_1.pool.query(`INSERT INTO lecture_subtitles (lecture_id, vtt_url, language, source)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (lecture_id, language) DO UPDATE SET vtt_url=EXCLUDED.vtt_url, source=EXCLUDED.source`, [req.params.id, vtt_url, language ?? "uz", source ?? "ai"]);
    res.json({ ok: true });
}));
// DELETE /lectures/:id
router.delete("/:id", (0, role_1.requireRole)("teacher", "super_admin"), (0, asyncHandler_1.ah)(async (req, res) => {
    await pool_1.pool.query("DELETE FROM lectures WHERE id = $1 AND (creator_id = $2 OR $3 = 'super_admin')", [req.params.id, req.user.sub, req.user.role]);
    res.json({ ok: true });
}));
exports.default = router;
