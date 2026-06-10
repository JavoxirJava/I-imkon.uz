import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import { ah } from "../utils/asyncHandler";
import type { AuthRequest } from "../types";

const router = Router();
router.use(requireAuth);

// GET /topics?teacher_id=X
router.get("/", ah(async (req, res) => {
  const { teacher_id } = req.query as Record<string, string>;
  if (!teacher_id) { res.status(400).json({ error: "teacher_id kerak" }); return; }
  const { rows } = await pool.query(
    `SELECT t.id, t.name, t.subject_id, t.teacher_id, t.created_at,
            s.name AS subject_name
     FROM topics t
     JOIN subjects s ON s.id = t.subject_id
     WHERE t.teacher_id = $1
     ORDER BY s.name, t.name`,
    [teacher_id]
  );
  res.json(rows);
}));

const TopicSchema = z.object({
  name:       z.string().min(2),
  subject_id: z.string().uuid(),
  class_ids:  z.array(z.string().uuid()).min(1),
});

// POST /topics
router.post("/", requireRole("teacher", "super_admin"), ah(async (req: AuthRequest, res) => {
  const parsed = TopicSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0]?.message }); return; }
  const { name, subject_id, class_ids } = parsed.data;
  const teacherId = req.user!.sub;

  const { rows: subjectRows } = await pool.query(
    "SELECT id, name FROM subjects WHERE id = $1",
    [subject_id]
  );
  if (!subjectRows[0]) { res.status(400).json({ error: "Fan topilmadi" }); return; }

  const { rows } = await pool.query(
    `INSERT INTO topics (name, subject_id, teacher_id)
     VALUES ($1, $2, $3)
     RETURNING id, name, subject_id, teacher_id, created_at`,
    [name.trim(), subject_id, teacherId]
  );
  const topic = rows[0] as { id: string; name: string; subject_id: string };

  await pool.query(
    `INSERT INTO topic_classes (topic_id, class_id)
     SELECT $1, unnest($2::uuid[])
     ON CONFLICT DO NOTHING`,
    [topic.id, [...new Set(class_ids)]]
  );

  res.status(201).json({
    ...topic,
    subject_name: subjectRows[0].name as string,
  });
}));

// DELETE /topics/:id
router.delete("/:id", requireRole("teacher", "super_admin"), ah(async (req: AuthRequest, res) => {
  await pool.query(
    "DELETE FROM topics WHERE id = $1 AND (teacher_id = $2 OR $3 = 'super_admin')",
    [req.params.id, req.user!.sub, req.user!.role]
  );
  res.json({ ok: true });
}));

export default router;
