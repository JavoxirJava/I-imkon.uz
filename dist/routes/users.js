"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const zod_1 = require("zod");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const role_1 = require("../middleware/role");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
// POST /users — admin creates user (director, teacher, etc.)
router.post("/", (0, role_1.requireRole)("super_admin"), async (req, res) => {
    const parsed = zod_1.z.object({
        first_name: zod_1.z.string().min(1).max(100),
        last_name: zod_1.z.string().min(1).max(100),
        phone: zod_1.z.string().regex(/^\+998[0-9]{9}$/),
        password: zod_1.z.string().min(8),
        role: zod_1.z.enum(["director", "teacher", "student"]),
        school_id: zod_1.z.string().uuid().optional(),
    }).safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message });
        return;
    }
    const { first_name, last_name, phone, password, role, school_id } = parsed.data;
    const hash = await bcryptjs_1.default.hash(password, 10);
    const existing = await pool_1.pool.query(`SELECT id FROM users WHERE phone=$1`, [phone]);
    if (existing.rows.length > 0) {
        res.status(400).json({ error: "Bu telefon raqam allaqachon ro'yxatdan o'tgan" });
        return;
    }
    const { rows } = await pool_1.pool.query(`INSERT INTO users (first_name, last_name, phone, password_hash, role, status)
     VALUES ($1,$2,$3,$4,$5,'active') RETURNING id`, [first_name, last_name, phone, hash, role]);
    const userId = rows[0].id;
    if (role === "director" && school_id) {
        await pool_1.pool.query(`UPDATE schools SET director_id=$1 WHERE id=$2`, [userId, school_id]);
    }
    res.status(201).json({ id: userId });
});
// GET /users — list (admin only)
router.get("/", (0, role_1.requireRole)("super_admin"), async (req, res) => {
    const { role, status } = req.query;
    const conditions = [];
    const params = [];
    if (role) {
        params.push(role);
        conditions.push(`role=$${params.length}`);
    }
    if (status) {
        params.push(status);
        conditions.push(`status=$${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await pool_1.pool.query(`SELECT id, first_name, last_name, phone, role, status, created_at FROM users ${where} ORDER BY created_at DESC`, params);
    res.json(rows);
});
// PUT /users/:id/status — approve/reject (admin)
router.put("/:id/status", (0, role_1.requireRole)("super_admin", "teacher", "director"), async (req, res) => {
    const { status, rejection_reason } = req.body;
    await pool_1.pool.query(`UPDATE users SET status=$1 WHERE id=$2`, [status, req.params.id]);
    if (rejection_reason !== undefined) {
        await pool_1.pool.query(`UPDATE student_profiles SET rejection_reason=$1 WHERE user_id=$2`, [rejection_reason, req.params.id]);
    }
    res.json({ ok: true });
});
// PUT /users/:id — profil yangilash
router.put("/:id", async (req, res) => {
    if (req.user.sub !== req.params.id && req.user.role !== "super_admin") {
        res.status(403).json({ error: "Ruxsat yo'q" });
        return;
    }
    const parsed = zod_1.z.object({
        first_name: zod_1.z.string().min(1).max(100).optional(),
        last_name: zod_1.z.string().min(1).max(100).optional(),
    }).safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message });
        return;
    }
    const updates = [];
    const params = [];
    if (parsed.data.first_name) {
        params.push(parsed.data.first_name);
        updates.push(`first_name=$${params.length}`);
    }
    if (parsed.data.last_name) {
        params.push(parsed.data.last_name);
        updates.push(`last_name=$${params.length}`);
    }
    if (!updates.length) {
        res.status(400).json({ error: "Yangilanacak maydon yo'q" });
        return;
    }
    params.push(req.params.id);
    await pool_1.pool.query(`UPDATE users SET ${updates.join(",")} WHERE id=$${params.length}`, params);
    res.json({ ok: true });
});
// POST /auth/change-password
router.post("/change-password", async (req, res) => {
    const { password } = req.body;
    if (!password || password.length < 8) {
        res.status(400).json({ error: "Parol kamida 8 ta belgi" });
        return;
    }
    const hash = await bcryptjs_1.default.hash(password, 10);
    await pool_1.pool.query("UPDATE users SET password_hash=$1 WHERE id=$2", [hash, req.user.sub]);
    res.json({ ok: true });
});
exports.default = router;
