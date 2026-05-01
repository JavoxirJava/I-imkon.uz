import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import type { AuthRequest } from "../types";

const router = Router();
router.use(requireAuth);

// GET /lectures?class_id=&teacher_id=
router.get("/", async (req: AuthRequest, res) => {
  const { class_id, teacher_id } = req.query as Record<string, string>;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (teacher_id) { params.push(teacher_id); conditions.push(`l.creator_id = $${params.length}`); }
  if (class_id)   { params.push(class_id);   conditions.push(`l.class_id = $${params.length}`); }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const { rows } = await pool.query(
    `SELECT l.*, sub.name AS subject_name,
            c.grade, c.letter,
            COALESCE(
              (SELECT json_agg(json_build_object('id', ls.id, 'vtt_url', ls.vtt_url, 'source', ls.source))
               FROM lecture_subtitles ls WHERE ls.lecture_id = l.id), '[]'
            ) AS subtitles
     FROM lectures l
     JOIN subjects sub ON sub.id = l.subject_id
     LEFT JOIN classes c ON c.id = l.class_id
     ${where}
     ORDER BY l.created_at DESC`,
    params
  );
  res.json(rows);
});

// GET /lectures/:id
router.get("/:id", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT l.*, sub.name AS subject_name,
            c.grade, c.letter,
            COALESCE(
              (SELECT json_agg(json_build_object('id', ls.id, 'vtt_url', ls.vtt_url, 'language', ls.language, 'source', ls.source))
               FROM lecture_subtitles ls WHERE ls.lecture_id = l.id), '[]'
            ) AS subtitles
     FROM lectures l
     JOIN subjects sub ON sub.id = l.subject_id
     LEFT JOIN classes c ON c.id = l.class_id
     WHERE l.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) { res.status(404).json({ error: "Topilmadi" }); return; }
  res.json(rows[0]);
});

// POST /lectures
const LectureSchema = z.object({
  subject_id:    z.string().uuid(),
  class_id:      z.string().uuid().nullable().optional(),
  title:         z.string().min(1).max(500),
  description:   z.string().nullable().optional(),
  content_type:  z.enum(["pdf", "video", "audio", "ppt"]),
  file_url:      z.string().url(),
  subtitle_vtt_url: z.string().url().optional(),
  subtitle_source:  z.enum(["manual", "ai"]).optional(),
});

router.post("/", requireRole("teacher", "super_admin"), async (req: AuthRequest, res) => {
  const parsed = LectureSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0]?.message }); return; }
  const d = parsed.data;

  // school_id from teacher assignments
  const { rows: ta } = await pool.query(
    "SELECT school_id FROM teacher_assignments WHERE teacher_id = $1 LIMIT 1",
    [req.user!.sub]
  );
  const school_id = ta[0]?.school_id ?? null;

  const { rows } = await pool.query(
    `INSERT INTO lectures (creator_id, school_id, subject_id, class_id, title, description, content_type, file_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [req.user!.sub, school_id, d.subject_id, d.class_id ?? null, d.title, d.description ?? null, d.content_type, d.file_url]
  );
  const lectureId = rows[0].id;

  if (d.subtitle_vtt_url) {
    await pool.query(
      `INSERT INTO lecture_subtitles (lecture_id, vtt_url, language, source) VALUES ($1,$2,'uz',$3)
       ON CONFLICT DO NOTHING`,
      [lectureId, d.subtitle_vtt_url, d.subtitle_source ?? "manual"]
    );
  }

  res.status(201).json({ id: lectureId });
});

// POST /lectures/:id/subtitles — upsert subtitle (used by Whisper API route)
router.post("/:id/subtitles", async (req, res) => {
  const { vtt_url, language, source } = req.body as { vtt_url: string; language?: string; source?: string };
  if (!vtt_url) { res.status(400).json({ error: "vtt_url kerak" }); return; }
  await pool.query(
    `INSERT INTO lecture_subtitles (lecture_id, vtt_url, language, source)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (lecture_id, language) DO UPDATE SET vtt_url=EXCLUDED.vtt_url, source=EXCLUDED.source`,
    [req.params.id, vtt_url, language ?? "uz", source ?? "ai"]
  );
  res.json({ ok: true });
});

// DELETE /lectures/:id
router.delete("/:id", requireRole("teacher", "super_admin"), async (req: AuthRequest, res) => {
  await pool.query(
    "DELETE FROM lectures WHERE id = $1 AND (creator_id = $2 OR $3 = 'super_admin')",
    [req.params.id, req.user!.sub, req.user!.role]
  );
  res.json({ ok: true });
});

export default router;
