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

type DifficultyLevel = "low" | "medium" | "high";
type ProgressState = "done_pending" | "done_approved" | "done_rejected" | "cannot_do";
type StudentProfileLevelState = {
  difficulty_level: DifficultyLevel;
  level_progress_score: number | null;
};

function promoteLevel(level: DifficultyLevel): DifficultyLevel {
  if (level === "low") return "medium";
  if (level === "medium") return "high";
  return "high";
}

function demoteLevel(level: DifficultyLevel): DifficultyLevel {
  if (level === "high") return "medium";
  if (level === "medium") return "low";
  return "low";
}

async function applyLevelDelta(studentId: string, delta: 1 | -1) {
  const profileRes = await pool.query(
    "SELECT difficulty_level, level_progress_score FROM student_profiles WHERE user_id=$1",
    [studentId]
  );
  const profile = profileRes.rows[0] as StudentProfileLevelState | undefined;
  if (!profile) return;

  const baseScore = profile.level_progress_score ?? 3;
  const nextScore = Math.max(0, Math.min(6, baseScore + delta));

  if (nextScore >= 6) {
    const nextLevel = promoteLevel(profile.difficulty_level);
    await pool.query(
      "UPDATE student_profiles SET difficulty_level=$1, level_progress_score=3 WHERE user_id=$2",
      [nextLevel, studentId]
    );
    return;
  }

  if (nextScore <= 0) {
    const nextLevel = demoteLevel(profile.difficulty_level);
    await pool.query(
      "UPDATE student_profiles SET difficulty_level=$1, level_progress_score=3 WHERE user_id=$2",
      [nextLevel, studentId]
    );
    return;
  }

  await pool.query(
    "UPDATE student_profiles SET level_progress_score=$1 WHERE user_id=$2",
    [nextScore, studentId]
  );
}

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
  deadline:         z.string().nullable().optional(),
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
    `SELECT asub.*, a.difficulty_level, u.first_name, u.last_name
     FROM assignment_submissions asub
     JOIN assignments a ON a.id = asub.assignment_id
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

// POST /assignments/:id/progress (student: bajardim / bajara olmadim)
router.post("/:id/progress", requireRole("student"), ah(async (req: AuthRequest, res) => {
  const parsed = z.object({
    action: z.enum(["done", "cannot_do"]),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "action noto'g'ri" });
    return;
  }

  const studentId = req.user!.sub;
  const assignmentId = req.params.id;

  const assignmentRes = await pool.query(
    "SELECT id, class_id, difficulty_level FROM assignments WHERE id=$1",
    [assignmentId]
  );
  const assignment = assignmentRes.rows[0] as { id: string; class_id: string; difficulty_level: DifficultyLevel } | undefined;
  if (!assignment) {
    res.status(404).json({ error: "Topshiriq topilmadi" });
    return;
  }

  const profileRes = await pool.query(
    "SELECT class_id FROM student_profiles WHERE user_id=$1",
    [studentId]
  );
  const profile = profileRes.rows[0] as { class_id: string } | undefined;
  if (!profile) {
    res.status(400).json({ error: "O'quvchi profili topilmadi" });
    return;
  }
  if (profile.class_id !== assignment.class_id) {
    res.status(403).json({ error: "Bu topshiriq sizga tegishli emas" });
    return;
  }

  const progressState: ProgressState = parsed.data.action === "done" ? "done_pending" : "cannot_do";
  const { rows: existing } = await pool.query(
    "SELECT id FROM assignment_submissions WHERE assignment_id=$1 AND student_id=$2",
    [assignmentId, studentId]
  );

  let submissionId: string;
  if (existing.length > 0) {
    submissionId = existing[0].id as string;
    await pool.query(
      `UPDATE assignment_submissions
       SET submitted_at=NOW(), progress_state=$1, teacher_reviewed_at=NULL, teacher_reviewed_by=NULL
       WHERE id=$2`,
      [progressState, submissionId]
    );
  } else {
    const inserted = await pool.query(
      `INSERT INTO assignment_submissions (assignment_id, student_id, progress_state)
       VALUES ($1,$2,$3) RETURNING id`,
      [assignmentId, studentId, progressState]
    );
    submissionId = inserted.rows[0].id as string;
  }

  if (parsed.data.action === "cannot_do") await applyLevelDelta(studentId, -1);

  res.status(200).json({ id: submissionId, progress_state: progressState });
}));

// GET /assignments/:id/submission (student o'zining topshirig'ini ko'radi)
router.get("/:id/submission", requireRole("student"), ah(async (req: AuthRequest, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM assignment_submissions WHERE assignment_id=$1 AND student_id=$2",
    [req.params.id, req.user!.sub]
  );
  res.json(rows[0] ?? null);
}));

// PUT /assignments/submissions/:submissionId/progress-review (teacher approve/reject)
router.put("/submissions/:submissionId/progress-review", requireRole("teacher", "super_admin"), ah(async (req: AuthRequest, res) => {
  const parsed = z.object({
    decision: z.enum(["approve", "reject"]),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "decision noto'g'ri" });
    return;
  }

  const subRes = await pool.query(
    `SELECT asub.id, asub.student_id, asub.progress_state, a.teacher_id, a.difficulty_level
     FROM assignment_submissions asub
     JOIN assignments a ON a.id = asub.assignment_id
     WHERE asub.id=$1`,
    [req.params.submissionId]
  );
  const submission = subRes.rows[0] as {
    id: string;
    student_id: string;
    progress_state: ProgressState | null;
    teacher_id: string;
    difficulty_level: DifficultyLevel;
  } | undefined;
  if (!submission) {
    res.status(404).json({ error: "Submission topilmadi" });
    return;
  }
  if (req.user!.role !== "super_admin" && submission.teacher_id !== req.user!.sub) {
    res.status(403).json({ error: "Ruxsat yo'q" });
    return;
  }
  if (submission.progress_state !== "done_pending") {
    res.status(400).json({ error: "Tasdiqlash uchun holat mos emas" });
    return;
  }

  await applyLevelDelta(submission.student_id, parsed.data.decision === "approve" ? 1 : -1);

  await pool.query(
    `UPDATE assignment_submissions
     SET progress_state=$1, teacher_reviewed_at=NOW(), teacher_reviewed_by=$2
     WHERE id=$3`,
    [parsed.data.decision === "approve" ? "done_approved" : "done_rejected", req.user!.sub, req.params.submissionId]
  );

  res.json({ ok: true });
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
