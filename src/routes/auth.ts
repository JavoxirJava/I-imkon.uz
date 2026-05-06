import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { pool } from "../db/pool";
import { requireAuth } from "../middleware/auth";
import type { AuthRequest, UserRow } from "../types";

const router = Router();

const RegisterSchema = z.object({
  phone: z.string().min(9).max(20),
  password: z.string().min(6),
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  role: z.enum(["student", "parent", "teacher"]).default("student"),
});

const LoginSchema = z.object({
  phone: z.string(),
  password: z.string(),
});

function issueTokens(userId: string, role: string) {
  const payload = { sub: userId, role };
  const accessExpiry = (process.env.JWT_EXPIRES_IN ?? "900") as `${number}`;
  const refreshExpiry = (process.env.JWT_REFRESH_EXPIRES_IN ?? "2592000") as `${number}`;
  const access = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: accessExpiry });
  const refresh = jwt.sign(payload, process.env.JWT_REFRESH_SECRET!, { expiresIn: refreshExpiry });
  return { access, refresh };
}

// POST /auth/register
router.post("/register", async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message });
    return;
  }
  const { phone, password, first_name, last_name, role } = parsed.data;

  const existing = await pool.query("SELECT id FROM users WHERE phone = $1", [phone]);
  if (existing.rows.length > 0) {
    res.status(409).json({ error: "Bu telefon raqam allaqachon ro'yxatdan o'tgan" });
    return;
  }

  const password_hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (phone, password_hash, first_name, last_name, role, status)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [phone, password_hash, first_name, last_name, role, "pending"]
  );

  const user = rows[0];
  const { access, refresh } = issueTokens(user.id, user.role);

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
    [user.id, refresh]
  );

  res.status(201).json({
    access_token: access,
    refresh_token: refresh,
    user: { id: user.id, first_name: user.first_name, last_name: user.last_name, role: user.role, status: user.status },
  });
});

// POST /auth/login
router.post("/login", async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Telefon va parol kerak" });
    return;
  }
  const { phone, password } = parsed.data;

  const { rows } = await pool.query<UserRow>("SELECT * FROM users WHERE phone = $1", [phone]);
  if (rows.length === 0) {
    res.status(401).json({ error: "Telefon yoki parol noto'g'ri" });
    return;
  }

  const user = rows[0];
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    res.status(401).json({ error: "Telefon yoki parol noto'g'ri" });
    return;
  }

  if (user.status === "rejected") {
    res.status(403).json({ error: "Hisobingiz rad etilgan" });
    return;
  }

  const { access, refresh } = issueTokens(user.id, user.role);

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '30 days')
     ON CONFLICT DO NOTHING`,
    [user.id, refresh]
  );

  res.json({
    access_token: access,
    refresh_token: refresh,
    user: { id: user.id, first_name: user.first_name, last_name: user.last_name, role: user.role, status: user.status },
  });
});

// POST /auth/refresh
router.post("/refresh", async (req, res) => {
  const { refresh_token } = req.body as { refresh_token?: string };
  if (!refresh_token) {
    res.status(400).json({ error: "refresh_token kerak" });
    return;
  }

  let payload: { sub: string; role: string };
  try {
    payload = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET!) as typeof payload;
  } catch {
    res.status(401).json({ error: "Refresh token yaroqsiz" });
    return;
  }

  const { rows } = await pool.query(
    "SELECT id FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()",
    [refresh_token]
  );
  if (rows.length === 0) {
    res.status(401).json({ error: "Refresh token topilmadi yoki muddati o'tgan" });
    return;
  }

  await pool.query("DELETE FROM refresh_tokens WHERE token = $1", [refresh_token]);

  const { access, refresh: newRefresh } = issueTokens(payload.sub, payload.role);
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
    [payload.sub, newRefresh]
  );

  res.json({ access_token: access, refresh_token: newRefresh });
});

// POST /auth/logout
router.post("/logout", requireAuth, async (req: AuthRequest, res) => {
  const { refresh_token } = req.body as { refresh_token?: string };
  if (refresh_token) {
    await pool.query("DELETE FROM refresh_tokens WHERE token = $1", [refresh_token]);
  }
  res.json({ ok: true });
});

// GET /auth/me
router.get("/me", requireAuth, async (req: AuthRequest, res) => {
  const { rows } = await pool.query<UserRow>(
    "SELECT id, phone, first_name, last_name, role, status, created_at FROM users WHERE id = $1",
    [req.user!.sub]
  );
  if (rows.length === 0) {
    res.status(404).json({ error: "Foydalanuvchi topilmadi" });
    return;
  }
  res.json(rows[0]);
});

export default router;
