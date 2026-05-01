import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import type { AuthRequest } from "../types";

const router = Router();
router.use(requireAuth);

// POST /users — admin creates user (director, teacher, etc.)
router.post("/", requireRole("super_admin"), async (req: AuthRequest, res) => {
  const parsed = z.object({
    first_name: z.string().min(1).max(100),
    last_name:  z.string().min(1).max(100),
    phone:      z.string().regex(/^\+998[0-9]{9}$/),
    password:   z.string().min(8),
    role:       z.enum(["director", "teacher", "student"]),
    school_id:  z.string().uuid().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0]?.message }); return; }

  const { first_name, last_name, phone, password, role, school_id } = parsed.data;
  const hash = await bcrypt.hash(password, 10);

  const existing = await pool.query(`SELECT id FROM users WHERE phone=$1`, [phone]);
  if (existing.rows.length > 0) { res.status(400).json({ error: "Bu telefon raqam allaqachon ro'yxatdan o'tgan" }); return; }

  const { rows } = await pool.query(
    `INSERT INTO users (first_name, last_name, phone, password_hash, role, status)
     VALUES ($1,$2,$3,$4,$5,'active') RETURNING id`,
    [first_name, last_name, phone, hash, role]
  );
  const userId = rows[0].id;

  if (role === "director" && school_id) {
    await pool.query(`UPDATE schools SET director_id=$1 WHERE id=$2`, [userId, school_id]);
  }

  res.status(201).json({ id: userId });
});

// GET /users — list (admin only)
router.get("/", requireRole("super_admin"), async (req, res) => {
  const { role, status } = req.query as Record<string, string>;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (role)   { params.push(role);   conditions.push(`role=$${params.length}`); }
  if (status) { params.push(status); conditions.push(`status=$${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT id, first_name, last_name, phone, role, status, created_at FROM users ${where} ORDER BY created_at DESC`,
    params
  );
  res.json(rows);
});

// PUT /users/:id/status — approve/reject (admin)
router.put("/:id/status", requireRole("super_admin", "teacher", "director"), async (req, res) => {
  const { status, rejection_reason } = req.body as { status: string; rejection_reason?: string };
  await pool.query(`UPDATE users SET status=$1 WHERE id=$2`, [status, req.params.id]);
  if (rejection_reason !== undefined) {
    await pool.query(`UPDATE student_profiles SET rejection_reason=$1 WHERE user_id=$2`, [rejection_reason, req.params.id]);
  }
  res.json({ ok: true });
});

// PUT /users/:id — profil yangilash
router.put("/:id", async (req: AuthRequest, res) => {
  if (req.user!.sub !== req.params.id && req.user!.role !== "super_admin") {
    res.status(403).json({ error: "Ruxsat yo'q" }); return;
  }

  const parsed = z.object({
    first_name: z.string().min(1).max(100).optional(),
    last_name:  z.string().min(1).max(100).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0]?.message }); return; }

  const updates: string[] = [];
  const params: unknown[] = [];
  if (parsed.data.first_name) { params.push(parsed.data.first_name); updates.push(`first_name=$${params.length}`); }
  if (parsed.data.last_name)  { params.push(parsed.data.last_name);  updates.push(`last_name=$${params.length}`); }

  if (!updates.length) { res.status(400).json({ error: "Yangilanacak maydon yo'q" }); return; }

  params.push(req.params.id);
  await pool.query(`UPDATE users SET ${updates.join(",")} WHERE id=$${params.length}`, params);
  res.json({ ok: true });
});

// POST /auth/change-password
router.post("/change-password", async (req: AuthRequest, res) => {
  const { password } = req.body as { password?: string };
  if (!password || password.length < 8) {
    res.status(400).json({ error: "Parol kamida 8 ta belgi" }); return;
  }
  const hash = await bcrypt.hash(password, 10);
  await pool.query("UPDATE users SET password_hash=$1 WHERE id=$2", [hash, req.user!.sub]);
  res.json({ ok: true });
});

export default router;
