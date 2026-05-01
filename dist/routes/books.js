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
    if (class_id) {
        const { rows } = await pool_1.pool.query(`SELECT b.* FROM books b
       JOIN book_classes bc ON bc.book_id = b.id
       WHERE bc.class_id = $1 ORDER BY b.created_at DESC`, [class_id]);
        res.json(rows);
    }
    else if (teacher_id) {
        const { rows } = await pool_1.pool.query("SELECT * FROM books WHERE uploader_id=$1 ORDER BY created_at DESC", [teacher_id]);
        res.json(rows);
    }
    else {
        const { rows } = await pool_1.pool.query("SELECT * FROM books ORDER BY created_at DESC");
        res.json(rows);
    }
});
router.get("/:id", async (req, res) => {
    const { rows } = await pool_1.pool.query(`SELECT b.*,
            COALESCE((SELECT json_agg(bc.class_id) FROM book_classes bc WHERE bc.book_id = b.id), '[]') AS class_ids
     FROM books b WHERE b.id = $1`, [req.params.id]);
    if (!rows[0]) {
        res.status(404).json({ error: "Topilmadi" });
        return;
    }
    res.json(rows[0]);
});
const BookSchema = zod_1.z.object({
    title: zod_1.z.string().min(1),
    description: zod_1.z.string().nullable().optional(),
    pdf_url: zod_1.z.string().url().nullable().optional(),
    audio_url: zod_1.z.string().url().nullable().optional(),
    audio_source: zod_1.z.enum(["uploaded", "web_speech", "google_tts"]).nullable().optional(),
    ocr_required: zod_1.z.boolean().default(false),
    class_ids: zod_1.z.array(zod_1.z.string().uuid()).default([]),
});
router.post("/", (0, role_1.requireRole)("teacher", "super_admin"), async (req, res) => {
    const parsed = BookSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message });
        return;
    }
    const d = parsed.data;
    const { rows } = await pool_1.pool.query(`INSERT INTO books (uploader_id, title, description, pdf_url, audio_url, audio_source, ocr_required)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [req.user.sub, d.title, d.description ?? null, d.pdf_url ?? null, d.audio_url ?? null, d.audio_source ?? null, d.ocr_required]);
    const bookId = rows[0].id;
    if (d.class_ids.length > 0) {
        await pool_1.pool.query(`INSERT INTO book_classes (book_id, class_id) SELECT $1, unnest($2::uuid[])`, [bookId, d.class_ids]);
    }
    res.status(201).json({ id: bookId });
});
router.put("/:id", (0, role_1.requireRole)("teacher", "super_admin"), async (req, res) => {
    const parsed = BookSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message });
        return;
    }
    const d = parsed.data;
    await pool_1.pool.query(`UPDATE books SET title=$1, description=$2, pdf_url=$3, audio_url=$4, audio_source=$5, ocr_required=$6
     WHERE id=$7 AND (uploader_id=$8 OR $9='super_admin')`, [d.title, d.description ?? null, d.pdf_url ?? null, d.audio_url ?? null, d.audio_source ?? null, d.ocr_required,
        req.params.id, req.user.sub, req.user.role]);
    await pool_1.pool.query("DELETE FROM book_classes WHERE book_id=$1", [req.params.id]);
    if (d.class_ids.length > 0) {
        await pool_1.pool.query(`INSERT INTO book_classes (book_id, class_id) SELECT $1, unnest($2::uuid[])`, [req.params.id, d.class_ids]);
    }
    res.json({ ok: true });
});
router.delete("/:id", (0, role_1.requireRole)("teacher", "super_admin"), async (req, res) => {
    await pool_1.pool.query("DELETE FROM books WHERE id=$1 AND (uploader_id=$2 OR $3='super_admin')", [req.params.id, req.user.sub, req.user.role]);
    res.json({ ok: true });
});
// Bookmarks
router.get("/:id/bookmarks", async (req, res) => {
    const { rows } = await pool_1.pool.query("SELECT * FROM book_bookmarks WHERE user_id=$1 AND book_id=$2 ORDER BY page", [req.user.sub, req.params.id]);
    res.json(rows);
});
router.put("/:id/bookmark", async (req, res) => {
    const { page, audio_timestamp } = req.body;
    await pool_1.pool.query(`INSERT INTO book_bookmarks (user_id, book_id, page, audio_timestamp)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, book_id) DO UPDATE SET page=EXCLUDED.page, audio_timestamp=EXCLUDED.audio_timestamp, updated_at=NOW()`, [req.user.sub, req.params.id, page, audio_timestamp ?? null]);
    res.json({ ok: true });
});
router.delete("/:id/bookmark", async (req, res) => {
    await pool_1.pool.query(`DELETE FROM book_bookmarks WHERE user_id=$1 AND book_id=$2`, [req.user.sub, req.params.id]);
    res.json({ ok: true });
});
exports.default = router;
