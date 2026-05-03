import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import { ah } from "../utils/asyncHandler";
import { logger } from "../utils/logger";
import type { AuthRequest } from "../types";

const router = Router();
router.use(requireAuth);

router.get("/", ah(async (req, res) => {
  const { teacher_id, class_id } = req.query as Record<string, string>;
  if (class_id) {
    const { rows } = await pool.query(
      `SELECT b.* FROM books b
       JOIN book_classes bc ON bc.book_id = b.id
       WHERE bc.class_id = $1 ORDER BY b.created_at DESC`,
      [class_id]
    );
    res.json(rows);
  } else if (teacher_id) {
    const { rows } = await pool.query(
      "SELECT * FROM books WHERE uploader_id=$1 ORDER BY created_at DESC",
      [teacher_id]
    );
    res.json(rows);
  } else {
    const { rows } = await pool.query("SELECT * FROM books ORDER BY created_at DESC");
    res.json(rows);
  }
}));

router.get("/:id", ah(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT b.*,
            COALESCE((SELECT json_agg(bc.class_id) FROM book_classes bc WHERE bc.book_id = b.id), '[]') AS class_ids
     FROM books b WHERE b.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) { res.status(404).json({ error: "Topilmadi" }); return; }
  res.json(rows[0]);
}));

const BookSchema = z.object({
  title:        z.string().min(1),
  description:  z.string().nullable().optional(),
  pdf_url:      z.string().url().nullable().optional(),
  audio_url:    z.string().url().nullable().optional(),
  audio_source: z.enum(["uploaded", "web_speech", "google_tts"]).nullable().optional(),
  ocr_required: z.boolean().default(false),
  class_ids:    z.array(z.string().uuid()).default([]),
});

router.post("/", requireRole("teacher", "super_admin"), ah(async (req: AuthRequest, res) => {
  logger.req(req, "POST /books", { user: req.user?.sub });

  const parsed = BookSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.warn("POST /books validation failed", { errors: parsed.error.errors, body: req.body });
    res.status(400).json({ error: parsed.error.errors[0]?.message });
    return;
  }
  const d = parsed.data;

  const { rows } = await pool.query(
    `INSERT INTO books (uploader_id, title, description, pdf_url, audio_url, audio_source, ocr_required)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [req.user!.sub, d.title, d.description ?? null, d.pdf_url ?? null, d.audio_url ?? null, d.audio_source ?? null, d.ocr_required]
  );
  const bookId = rows[0].id;
  logger.info("POST /books: created", { bookId, user: req.user?.sub });

  if (d.class_ids.length > 0) {
    await pool.query(
      `INSERT INTO book_classes (book_id, class_id) SELECT $1, unnest($2::uuid[])`,
      [bookId, d.class_ids]
    );
  }
  res.status(201).json({ id: bookId });
}));

router.put("/:id", requireRole("teacher", "super_admin"), ah(async (req: AuthRequest, res) => {
  logger.req(req, `PUT /books/${req.params.id}`, { user: req.user?.sub });

  const parsed = BookSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.warn("PUT /books validation failed", { errors: parsed.error.errors, id: req.params.id });
    res.status(400).json({ error: parsed.error.errors[0]?.message });
    return;
  }
  const d = parsed.data;

  await pool.query(
    `UPDATE books SET title=$1, description=$2, pdf_url=$3, audio_url=$4, audio_source=$5, ocr_required=$6
     WHERE id=$7 AND (uploader_id=$8 OR $9='super_admin')`,
    [d.title, d.description ?? null, d.pdf_url ?? null, d.audio_url ?? null, d.audio_source ?? null, d.ocr_required,
     req.params.id, req.user!.sub, req.user!.role]
  );
  await pool.query("DELETE FROM book_classes WHERE book_id=$1", [req.params.id]);
  if (d.class_ids.length > 0) {
    await pool.query(
      `INSERT INTO book_classes (book_id, class_id) SELECT $1, unnest($2::uuid[])`,
      [req.params.id, d.class_ids]
    );
  }
  res.json({ ok: true });
}));

router.delete("/:id", requireRole("teacher", "super_admin"), ah(async (req: AuthRequest, res) => {
  await pool.query(
    "DELETE FROM books WHERE id=$1 AND (uploader_id=$2 OR $3='super_admin')",
    [req.params.id, req.user!.sub, req.user!.role]
  );
  res.json({ ok: true });
}));

// Bookmarks
router.get("/:id/bookmarks", ah(async (req: AuthRequest, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM book_bookmarks WHERE user_id=$1 AND book_id=$2 ORDER BY page",
    [req.user!.sub, req.params.id]
  );
  res.json(rows);
}));

router.put("/:id/bookmark", ah(async (req: AuthRequest, res) => {
  const { page, audio_timestamp } = req.body as { page: number; audio_timestamp?: number };
  await pool.query(
    `INSERT INTO book_bookmarks (user_id, book_id, page, audio_timestamp)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, book_id) DO UPDATE SET page=EXCLUDED.page, audio_timestamp=EXCLUDED.audio_timestamp, updated_at=NOW()`,
    [req.user!.sub, req.params.id, page, audio_timestamp ?? null]
  );
  res.json({ ok: true });
}));

router.delete("/:id/bookmark", ah(async (req: AuthRequest, res) => {
  await pool.query(
    `DELETE FROM book_bookmarks WHERE user_id=$1 AND book_id=$2`,
    [req.user!.sub, req.params.id]
  );
  res.json({ ok: true });
}));

export default router;
