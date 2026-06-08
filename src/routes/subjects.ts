import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import type { AuthRequest } from "../types";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const { school_id } = req.query as Record<string, string>;
  if (school_id) {
    const { rows } = await pool.query(
      `SELECT s.id, s.name FROM subjects s
       JOIN school_subjects ss ON ss.subject_id = s.id
       WHERE ss.school_id=$1 ORDER BY s.name`,
      [school_id]
    );
    res.json(rows);
  } else {
    const { rows } = await pool.query("SELECT id, name FROM subjects ORDER BY name");
    res.json(rows);
  }
});

router.post("/", requireRole("super_admin"), async (_req: AuthRequest, res) => {
  const parsed = z.object({ name: z.string().min(1) }).safeParse(_req.body);
  if (!parsed.success) { res.status(400).json({ error: "name kerak" }); return; }
  const { rows } = await pool.query(
    "INSERT INTO subjects (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING id",
    [parsed.data.name]
  );
  res.status(201).json(rows[0] ?? { error: "Allaqachon mavjud" });
});

router.put("/:id", requireRole("super_admin"), async (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: "name kerak" }); return; }
  await pool.query("UPDATE subjects SET name=$1 WHERE id=$2", [name.trim(), req.params.id]);
  res.json({ ok: true });
});

router.delete("/:id", requireRole("super_admin"), async (req, res) => {
  await pool.query("DELETE FROM subjects WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

// POST /subjects/fix-orphaned-links — fansiz mavzularni ko'rsatilgan fanga biriktiradi
router.post("/fix-orphaned-links", requireRole("super_admin"), async (req: AuthRequest, res) => {
  const parsed = z.object({
    fan_subject_id: z.string().uuid().optional(),
    fan_name: z.string().min(1).optional(),
  }).refine((d) => d.fan_subject_id || d.fan_name, {
    message: "fan_subject_id yoki fan_name kerak",
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0]?.message }); return; }

  // ID yoki nom bo'yicha fan topish
  const { rows: fanRows } = parsed.data.fan_subject_id
    ? await pool.query("SELECT id, name FROM subjects WHERE id = $1", [parsed.data.fan_subject_id])
    : await pool.query("SELECT id, name FROM subjects WHERE name = $1 LIMIT 1", [parsed.data.fan_name]);

  if (!fanRows[0]) { res.status(404).json({ error: "Fan topilmadi" }); return; }
  const fan_subject_id = fanRows[0].id as string;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subject_topic_links (
      topic_subject_id UUID PRIMARY KEY REFERENCES subjects(id) ON DELETE CASCADE,
      fan_subject_id   UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // teacher_assignments'dagi barcha subjectlar ichidan:
  // - subject_topic_links da yo'qlar (orphan)
  // - o'zi fan_subject_id sifatida ishlatilmaganlar (ya'ni fan emas)
  // - berilgan fan_subject_id ning o'zi emas
  const { rows } = await pool.query(`
    INSERT INTO subject_topic_links (topic_subject_id, fan_subject_id)
    SELECT DISTINCT ta.subject_id, $1
    FROM teacher_assignments ta
    WHERE ta.subject_id != $1
      AND NOT EXISTS (
        SELECT 1 FROM subject_topic_links stl WHERE stl.topic_subject_id = ta.subject_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM subject_topic_links stl WHERE stl.fan_subject_id = ta.subject_id
      )
    ON CONFLICT (topic_subject_id) DO NOTHING
    RETURNING topic_subject_id
  `, [fan_subject_id]);

  res.json({ linked: rows.length, fan: fanRows[0].name });
});

export default router;
