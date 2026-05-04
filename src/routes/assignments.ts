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
  if (teacher_id) {
    const { rows } = await pool.query(
      `SELECT a.*, sub.name AS subject_name FROM assignments a
       JOIN subjects sub ON sub.id = a.subject_id
       WHERE a.teacher_id=$1 ORDER BY a.created_at DESC`,
      [teacher_id]
    );
    res.json(rows);
  } else if (class_id) {
    const { rows } = await pool.query(
      `SELECT a.*, sub.name AS subject_name FROM assignments a
       JOIN subjects sub ON sub.id = a.subject_id
       WHERE a.class_id=$1 ORDER BY a.created_at DESC`,
      [class_id]
    );
    res.json(rows);
  } else {
    res.status(400).json({ error: "teacher_id yoki class_id kerak" });
  }
}));

router.get("/:id", ah(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.*, sub.name AS subject_name FROM assignments a
     JOIN subjects sub ON sub.id = a.subject_id WHERE a.id=$1`,
    [req.params.id]
  );
  if (!rows[0]) { res.status(404).json({ error: "Topilmadi" }); return; }
  res.json(rows[0]);
}));

const AssignmentSchema = z.object({
  title:            z.string().min(1),
  description:      z.string().nullable().optional(),
  subject_id:       z.string().uuid(),
  class_ids:        z.array(z.string().uuid()).min(1),
  deadline:         z.string().datetime().nullable().optional(),
  max_score:        z.number().int().positive().default(100),
  file_url:         z.string().url().nullable().optional(),
  difficulty_level: z.enum(["low", "medium", "high"]).default("medium"),
  is_for_disabled:  z.boolean().default(false),
});

router.post("/", requireRole("teacher", "super_admin"), ah(async (req: AuthRequest, res) => {
  logger.req(req, "POST /assignments", { user: req.user?.sub });

  const parsed = AssignmentSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.warn("POST /assignments validation failed", { errors: parsed.error.errors, body: req.body });
    res.status(400).json({ error: parsed.error.errors[0]?.message });
    return;
  }
  const d = parsed.data;

  const ids: string[] = [];
  for (const classId of d.class_ids) {
    const { rows } = await pool.query(
      `INSERT INTO assignments (teacher_id, subject_id, class_id, title, description, deadline, max_score, file_url, difficulty_level, is_for_disabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [req.user!.sub, d.subject_id, classId, d.title, d.description ?? null,
       d.deadline ?? null, d.max_score, d.file_url ?? null, d.difficulty_level, d.is_for_disabled]
    );
    ids.push(rows[0].id);
  }
  logger.info("POST /assignments: created", { ids, user: req.user?.sub });
  res.status(201).json({ id: ids[0], ids });
}));

router.delete("/:id", requireRole("teacher", "super_admin"), ah(async (req: AuthRequest, res) => {
  await pool.query(
    "DELETE FROM assignments WHERE id=$1 AND (teacher_id=$2 OR $3='super_admin')",
    [req.params.id, req.user!.sub, req.user!.role]
  );
  res.json({ ok: true });
}));

// GET /assignments/:id/submissions
router.get("/:id/submissions", requireRole("teacher", "director", "super_admin"), ah(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT asub.*, u.first_name, u.last_name
     FROM assignment_submissions asub
     JOIN users u ON u.id = asub.student_id
     WHERE asub.assignment_id=$1
     ORDER BY asub.submitted_at DESC`,
    [req.params.id]
  );
  res.json(rows);
}));

// POST /assignments/:id/submit (student)
router.post("/:id/submit", requireRole("student"), ah(async (req: AuthRequest, res) => {
  const { content, file_url } = req.body as { content?: string; file_url?: string };
  const studentId = req.user!.sub;
  const assignmentId = req.params.id;

  const { rows: existing } = await pool.query(
    "SELECT id FROM assignment_submissions WHERE assignment_id=$1 AND student_id=$2",
    [assignmentId, studentId]
  );

  if (existing.length > 0) {
    await pool.query(
      "UPDATE assignment_submissions SET content=$1, file_url=$2, submitted_at=NOW() WHERE id=$3",
      [content ?? null, file_url ?? null, existing[0].id]
    );
    res.json({ id: existing[0].id });
  } else {
    const { rows } = await pool.query(
      `INSERT INTO assignment_submissions (assignment_id, student_id, content, file_url)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [assignmentId, studentId, content ?? null, file_url ?? null]
    );
    res.status(201).json({ id: rows[0].id });
  }
}));

// GET /assignments/:id/submission (student o'zining topshirig'ini ko'radi)
router.get("/:id/submission", requireRole("student"), ah(async (req: AuthRequest, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM assignment_submissions WHERE assignment_id=$1 AND student_id=$2",
    [req.params.id, req.user!.sub]
  );
  res.json(rows[0] ?? null);
}));

// PUT /submissions/:submissionId/grade (teacher)
router.put("/submissions/:submissionId/grade", requireRole("teacher", "super_admin"), ah(async (req, res) => {
  const parsed = z.object({ score: z.number().min(0), teacher_comment: z.string().nullable().optional() })
    .safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "score kerak" }); return; }

  await pool.query(
    "UPDATE assignment_submissions SET score=$1, teacher_comment=$2 WHERE id=$3",
    [parsed.data.score, parsed.data.teacher_comment ?? null, req.params.submissionId]
  );
  res.json({ ok: true });
}));

export default router;
