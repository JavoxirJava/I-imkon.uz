import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import type { AuthRequest } from "../types";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const { teacher_id, class_id } = req.query as Record<string, string>;
  if (class_id) {
    const { rows } = await pool.query(
      `SELECT g.*, sub.name AS subject_name
       FROM games g
       JOIN game_classes gc ON gc.game_id = g.id
       JOIN subjects sub ON sub.id = g.subject_id
       WHERE gc.class_id = $1 ORDER BY g.created_at DESC`,
      [class_id]
    );
    res.json(rows);
  } else if (teacher_id) {
    const { rows } = await pool.query(
      `SELECT g.*, sub.name AS subject_name FROM games g
       JOIN subjects sub ON sub.id = g.subject_id
       WHERE g.teacher_id = $1 ORDER BY g.created_at DESC`,
      [teacher_id]
    );
    res.json(rows);
  } else {
    res.status(400).json({ error: "teacher_id yoki class_id kerak" });
  }
});

router.get("/:id", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT g.*, sub.name AS subject_name,
            COALESCE((SELECT json_agg(gc.class_id) FROM game_classes gc WHERE gc.game_id = g.id), '[]') AS class_ids
     FROM games g JOIN subjects sub ON sub.id = g.subject_id WHERE g.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) { res.status(404).json({ error: "Topilmadi" }); return; }
  res.json(rows[0]);
});

const GameSchema = z.object({
  title:         z.string().min(1),
  template_type: z.enum(["word_match", "ordering", "memory"]),
  subject_id:    z.string().uuid(),
  content_json:  z.record(z.unknown()).default({}),
  class_ids:     z.array(z.string().uuid()).default([]),
});

router.post("/", requireRole("teacher", "super_admin"), async (req: AuthRequest, res) => {
  const parsed = GameSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0]?.message }); return; }
  const d = parsed.data;

  const { rows } = await pool.query(
    `INSERT INTO games (teacher_id, template_type, subject_id, title, content_json)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [req.user!.sub, d.template_type, d.subject_id, d.title, JSON.stringify(d.content_json)]
  );
  const gameId = rows[0].id;
  if (d.class_ids.length > 0) {
    await pool.query(
      `INSERT INTO game_classes (game_id, class_id) SELECT $1, unnest($2::uuid[])`,
      [gameId, d.class_ids]
    );
  }
  res.status(201).json({ id: gameId });
});

router.delete("/:id", requireRole("teacher", "super_admin"), async (req: AuthRequest, res) => {
  await pool.query(
    "DELETE FROM games WHERE id=$1 AND (teacher_id=$2 OR $3='super_admin')",
    [req.params.id, req.user!.sub, req.user!.role]
  );
  res.json({ ok: true });
});

// POST /games/:id/attempts
router.post("/:id/attempts", requireRole("student"), async (req: AuthRequest, res) => {
  const { rows } = await pool.query(
    "INSERT INTO game_attempts (student_id, game_id, score, duration) VALUES ($1,$2,0,0) RETURNING id",
    [req.user!.sub, req.params.id]
  );
  res.status(201).json({ attempt_id: rows[0].id });
});

// PUT /games/attempts/:attemptId/finish
router.put("/attempts/:attemptId/finish", requireRole("student"), async (req: AuthRequest, res) => {
  const { score, duration } = req.body as { score: number; duration: number };
  await pool.query(
    "UPDATE game_attempts SET score=$1, duration=$2, completed_at=NOW() WHERE id=$3 AND student_id=$4",
    [score, duration, req.params.attemptId, req.user!.sub]
  );
  res.json({ ok: true });
});

router.get("/:id/attempts", async (req, res) => {
  const { student_id } = req.query as Record<string, string>;
  if (!student_id) { res.status(400).json({ error: "student_id kerak" }); return; }
  const { rows } = await pool.query(
    "SELECT * FROM game_attempts WHERE student_id=$1 AND game_id=$2 ORDER BY completed_at DESC",
    [student_id, req.params.id]
  );
  res.json(rows);
});

export default router;
