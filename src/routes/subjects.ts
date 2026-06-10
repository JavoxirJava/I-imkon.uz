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

export default router;
