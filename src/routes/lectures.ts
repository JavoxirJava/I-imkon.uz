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

// GET /lectures?class_id=&teacher_id=
router.get("/", ah(async (req, res) => {
  const { class_id, teacher_id } = req.query as Record<string, string>;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (teacher_id) { params.push(teacher_id); conditions.push(`l.creator_id = $${params.length}`); }
  if (class_id)   { params.push(class_id);   conditions.push(`l.class_id = $${params.length}`); }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const { rows } = await pool.query(
    `SELECT l.*,
            CASE WHEN t.id IS NOT NULL THEN json_build_object('id', t.id, 'name', t.name, 'subject_id', t.subject_id) ELSE NULL END AS topics,
            CASE WHEN s.id IS NOT NULL THEN json_build_object('id', s.id, 'name', s.name) ELSE NULL END AS fans,
            CASE WHEN c.id IS NOT NULL THEN json_build_object('id', c.id, 'grade', c.grade, 'letter', c.letter) ELSE NULL END AS classes,
            COALESCE(
              (SELECT json_agg(json_build_object('id', ls.id, 'vtt_url', ls.vtt_url, 'source', ls.source))
               FROM lecture_subtitles ls WHERE ls.lecture_id = l.id), '[]'::json
            ) AS lecture_subtitles
     FROM lectures l
     LEFT JOIN topics t ON t.id = l.topic_id
     LEFT JOIN subjects s ON s.id = t.subject_id
     LEFT JOIN classes c ON c.id = l.class_id
     ${where}
     ORDER BY l.created_at DESC`,
    params
  );
  res.json(rows);
}));

// GET /lectures/:id
router.get("/:id", ah(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT l.*,
            CASE WHEN t.id IS NOT NULL THEN json_build_object('id', t.id, 'name', t.name, 'subject_id', t.subject_id) ELSE NULL END AS topics,
            CASE WHEN s.id IS NOT NULL THEN json_build_object('id', s.id, 'name', s.name) ELSE NULL END AS fans,
            CASE WHEN c.id IS NOT NULL THEN json_build_object('id', c.id, 'grade', c.grade, 'letter', c.letter) ELSE NULL END AS classes,
            COALESCE(
              (SELECT json_agg(json_build_object('id', ls.id, 'vtt_url', ls.vtt_url, 'language', ls.language, 'source', ls.source))
               FROM lecture_subtitles ls WHERE ls.lecture_id = l.id), '[]'::json
            ) AS lecture_subtitles
     FROM lectures l
     LEFT JOIN topics t ON t.id = l.topic_id
     LEFT JOIN subjects s ON s.id = t.subject_id
     LEFT JOIN classes c ON c.id = l.class_id
     WHERE l.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) { res.status(404).json({ error: "Topilmadi" }); return; }
  res.json(rows[0]);
}));

// POST /lectures
const LectureSchema = z.object({
  school_id:     z.string().uuid().optional(),
  topic_id:      z.string().uuid(),
  class_id:      z.string().uuid().nullable().optional(),
  title:         z.string().max(500).optional(),
  description:   z.string().nullable().optional(),
  content_type:  z.enum(["pdf", "video", "audio", "ppt", "link"]),
  file_url:      z.string().url(),
  subtitle_vtt_url: z.string().url().optional(),
  subtitle_source:  z.enum(["manual", "ai"]).optional(),
});

router.post("/", requireRole("teacher", "super_admin"), ah(async (req: AuthRequest, res) => {
  logger.req(req, "POST /lectures", { user: req.user?.sub, content_type: req.body?.content_type });

  const parsed = LectureSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.warn("POST /lectures validation failed", { errors: parsed.error.errors, body: req.body });
    res.status(400).json({ error: parsed.error.errors[0]?.message });
    return;
  }
  const d = parsed.data;

  if (req.user!.role !== "super_admin") {
    const { rows: topicAccess } = await pool.query(
      "SELECT 1 FROM topics WHERE id = $1 AND teacher_id = $2 LIMIT 1",
      [d.topic_id, req.user!.sub]
    );
    if (!topicAccess[0]) {
      res.status(403).json({ error: "Tanlangan mavzu sizga tegishli emas" });
      return;
    }
  }

  let resolvedSchoolId: string | null = d.school_id ?? null;
  if (d.class_id) {
    const { rows: classRow } = await pool.query("SELECT school_id FROM classes WHERE id = $1 LIMIT 1", [d.class_id]);
    if (!classRow[0]) { res.status(400).json({ error: "Sinf topilmadi" }); return; }
    resolvedSchoolId = classRow[0].school_id as string;
  }

  const { rows } = await pool.query(
    `INSERT INTO lectures (creator_id, school_id, topic_id, class_id, title, description, content_type, file_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      req.user!.sub,
      resolvedSchoolId,
      d.topic_id,
      d.class_id ?? null,
      d.title || "Tashqi havola",
      d.description ?? null,
      d.content_type,
      d.file_url,
    ]
  );
  const lectureId = rows[0].id;
  logger.info("POST /lectures: created", { lectureId, user: req.user?.sub });

  if (d.subtitle_vtt_url) {
    await pool.query(
      `INSERT INTO lecture_subtitles (lecture_id, vtt_url, language, source) VALUES ($1,$2,'uz',$3)
       ON CONFLICT DO NOTHING`,
      [lectureId, d.subtitle_vtt_url, d.subtitle_source ?? "manual"]
    );
  }

  res.status(201).json({ id: lectureId });
}));

// POST /lectures/:id/subtitles — upsert subtitle (used by Whisper API route)
router.post("/:id/subtitles", ah(async (req, res) => {
  const { vtt_url, language, source } = req.body as { vtt_url: string; language?: string; source?: string };
  if (!vtt_url) { res.status(400).json({ error: "vtt_url kerak" }); return; }
  const lang = language ?? "uz";
  const updated = await pool.query(
    `UPDATE lecture_subtitles
     SET vtt_url=$1, source=$2
     WHERE lecture_id=$3 AND language=$4
     RETURNING id`,
    [vtt_url, source ?? "ai", req.params.id, lang]
  );
  if (!updated.rows[0]) {
    await pool.query(
      `INSERT INTO lecture_subtitles (lecture_id, vtt_url, language, source)
       VALUES ($1,$2,$3,$4)`,
      [req.params.id, vtt_url, lang, source ?? "ai"]
    );
  }
  res.json({ ok: true });
}));

// POST /lectures/pdf-text
router.post("/pdf-text", ah(async (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url) {
    res.status(400).json({ error: "url kerak" });
    return;
  }

  const fileRes = await fetch(url);
  if (!fileRes.ok) {
    res.status(400).json({ error: "PDF yuklab bo'lmadi" });
    return;
  }

  const contentType = fileRes.headers.get("content-type") ?? "";
  if (!contentType.includes("pdf") && !url.toLowerCase().includes(".pdf")) {
    res.status(400).json({ error: "Fayl PDF emas" });
    return;
  }

  const pdfParseModuleName = "pdf-parse";
  let PDFParseCtor: { new (options: { data: Buffer }): { getText: () => Promise<{ text: string }>; destroy: () => Promise<void> } };
  try {
    const mod = await import(pdfParseModuleName);
    PDFParseCtor = mod.PDFParse;
  } catch {
    res.status(500).json({ error: "Serverda PDF parser o'rnatilmagan" });
    return;
  }
  const parser = new PDFParseCtor({ data: Buffer.from(await fileRes.arrayBuffer()) });
  const parsed = await parser.getText();
  await parser.destroy();

  const text = parsed.text.replace(/\s+/g, " ").trim();
  if (!text) {
    res.status(422).json({ error: "PDF ichida o'qiladigan matn topilmadi" });
    return;
  }

  res.json({ text });
}));

// PUT /lectures/:id
const UpdateLectureSchema = z.object({
  topic_id:      z.string().uuid(),
  class_id:      z.string().uuid().nullable().optional(),
  title:         z.string().min(1).max(500),
  description:   z.string().nullable().optional(),
  content_type:  z.enum(["pdf", "video", "audio", "ppt"]),
  file_url:      z.string().url(),
  subtitle_vtt_url: z.string().url().nullable().optional(),
  subtitle_source:  z.enum(["manual", "ai"]).optional(),
});

router.put("/:id", requireRole("teacher", "super_admin"), ah(async (req: AuthRequest, res) => {
  const parsed = UpdateLectureSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message });
    return;
  }
  const d = parsed.data;

  const { rows } = await pool.query(
    `UPDATE lectures
     SET topic_id=$1, class_id=$2, title=$3, description=$4, content_type=$5, file_url=$6
     WHERE id=$7 AND (creator_id=$8 OR $9='super_admin')
     RETURNING id`,
    [
      d.topic_id,
      d.class_id ?? null,
      d.title,
      d.description ?? null,
      d.content_type,
      d.file_url,
      req.params.id,
      req.user!.sub,
      req.user!.role,
    ]
  );
  if (!rows[0]) {
    res.status(404).json({ error: "Topilmadi yoki ruxsat yo'q" });
    return;
  }

  if (d.subtitle_vtt_url) {
    const updated = await pool.query(
      `UPDATE lecture_subtitles
       SET vtt_url=$1, source=$2
       WHERE lecture_id=$3 AND language='uz'
       RETURNING id`,
      [d.subtitle_vtt_url, d.subtitle_source ?? "manual", req.params.id]
    );
    if (!updated.rows[0]) {
      await pool.query(
        `INSERT INTO lecture_subtitles (lecture_id, vtt_url, language, source)
         VALUES ($1,$2,'uz',$3)`,
        [req.params.id, d.subtitle_vtt_url, d.subtitle_source ?? "manual"]
      );
    }
  }

  res.json({ ok: true });
}));

// DELETE /lectures/:id
router.delete("/:id", requireRole("teacher", "super_admin"), ah(async (req: AuthRequest, res) => {
  await pool.query(
    "DELETE FROM lectures WHERE id = $1 AND (creator_id = $2 OR $3 = 'super_admin')",
    [req.params.id, req.user!.sub, req.user!.role]
  );
  res.json({ ok: true });
}));

export default router;
