import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import type { AuthRequest } from "../types";

const router = Router();

router.get("/", async (req, res) => {
  const { school_id } = req.query as Record<string, string>;
  if (!school_id) { res.status(400).json({ error: "school_id kerak" }); return; }
  const { rows } = await pool.query(
    "SELECT id, grade, letter, school_id FROM classes WHERE school_id=$1 ORDER BY grade, letter",
    [school_id]
  );
  res.json(rows);
});

router.post("/", requireAuth, requireRole("director", "super_admin"), async (req: AuthRequest, res) => {
  const parsed = z.object({
    school_id: z.string().uuid(),
    grade:     z.number().int().min(5).max(9),
    letter:    z.string().length(1),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0]?.message }); return; }

  const { rows } = await pool.query(
    "INSERT INTO classes (school_id, grade, letter) VALUES ($1,$2,$3) RETURNING id",
    [parsed.data.school_id, parsed.data.grade, parsed.data.letter.toUpperCase()]
  );
  res.status(201).json({ id: rows[0].id });
});

router.delete("/:id", requireAuth, requireRole("director", "super_admin"), async (_req, res) => {
  await pool.query("DELETE FROM classes WHERE id=$1", [_req.params.id]);
  res.json({ ok: true });
});

export default router;
