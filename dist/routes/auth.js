"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const zod_1 = require("zod");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
const RegisterSchema = zod_1.z.object({
    phone: zod_1.z.string().min(9).max(20),
    password: zod_1.z.string().min(6),
    first_name: zod_1.z.string().min(1).max(100),
    last_name: zod_1.z.string().min(1).max(100),
    role: zod_1.z.enum(["student", "parent"]).default("student"),
});
const LoginSchema = zod_1.z.object({
    phone: zod_1.z.string(),
    password: zod_1.z.string(),
});
function issueTokens(userId, role) {
    const payload = { sub: userId, role };
    const accessExpiry = (process.env.JWT_EXPIRES_IN ?? "900");
    const refreshExpiry = (process.env.JWT_REFRESH_EXPIRES_IN ?? "2592000");
    const access = jsonwebtoken_1.default.sign(payload, process.env.JWT_SECRET, { expiresIn: accessExpiry });
    const refresh = jsonwebtoken_1.default.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: refreshExpiry });
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
    const existing = await pool_1.pool.query("SELECT id FROM users WHERE phone = $1", [phone]);
    if (existing.rows.length > 0) {
        res.status(409).json({ error: "Bu telefon raqam allaqachon ro'yxatdan o'tgan" });
        return;
    }
    const password_hash = await bcryptjs_1.default.hash(password, 10);
    const { rows } = await pool_1.pool.query(`INSERT INTO users (phone, password_hash, first_name, last_name, role, status)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, [phone, password_hash, first_name, last_name, role, "pending"]);
    const user = rows[0];
    const { access, refresh } = issueTokens(user.id, user.role);
    await pool_1.pool.query(`INSERT INTO refresh_tokens (user_id, token, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '30 days')`, [user.id, refresh]);
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
    const { rows } = await pool_1.pool.query("SELECT * FROM users WHERE phone = $1", [phone]);
    if (rows.length === 0) {
        res.status(401).json({ error: "Telefon yoki parol noto'g'ri" });
        return;
    }
    const user = rows[0];
    const match = await bcryptjs_1.default.compare(password, user.password_hash);
    if (!match) {
        res.status(401).json({ error: "Telefon yoki parol noto'g'ri" });
        return;
    }
    if (user.status === "rejected") {
        res.status(403).json({ error: "Hisobingiz rad etilgan" });
        return;
    }
    const { access, refresh } = issueTokens(user.id, user.role);
    await pool_1.pool.query(`INSERT INTO refresh_tokens (user_id, token, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '30 days')
     ON CONFLICT DO NOTHING`, [user.id, refresh]);
    res.json({
        access_token: access,
        refresh_token: refresh,
        user: { id: user.id, first_name: user.first_name, last_name: user.last_name, role: user.role, status: user.status },
    });
});
// POST /auth/refresh
router.post("/refresh", async (req, res) => {
    const { refresh_token } = req.body;
    if (!refresh_token) {
        res.status(400).json({ error: "refresh_token kerak" });
        return;
    }
    let payload;
    try {
        payload = jsonwebtoken_1.default.verify(refresh_token, process.env.JWT_REFRESH_SECRET);
    }
    catch {
        res.status(401).json({ error: "Refresh token yaroqsiz" });
        return;
    }
    const { rows } = await pool_1.pool.query("SELECT id FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()", [refresh_token]);
    if (rows.length === 0) {
        res.status(401).json({ error: "Refresh token topilmadi yoki muddati o'tgan" });
        return;
    }
    await pool_1.pool.query("DELETE FROM refresh_tokens WHERE token = $1", [refresh_token]);
    const { access, refresh: newRefresh } = issueTokens(payload.sub, payload.role);
    await pool_1.pool.query(`INSERT INTO refresh_tokens (user_id, token, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '30 days')`, [payload.sub, newRefresh]);
    res.json({ access_token: access, refresh_token: newRefresh });
});
// POST /auth/logout
router.post("/logout", auth_1.requireAuth, async (req, res) => {
    const { refresh_token } = req.body;
    if (refresh_token) {
        await pool_1.pool.query("DELETE FROM refresh_tokens WHERE token = $1", [refresh_token]);
    }
    res.json({ ok: true });
});
// GET /auth/me
router.get("/me", auth_1.requireAuth, async (req, res) => {
    const { rows } = await pool_1.pool.query("SELECT id, phone, first_name, last_name, role, status, created_at FROM users WHERE id = $1", [req.user.sub]);
    if (rows.length === 0) {
        res.status(404).json({ error: "Foydalanuvchi topilmadi" });
        return;
    }
    res.json(rows[0]);
});
exports.default = router;
