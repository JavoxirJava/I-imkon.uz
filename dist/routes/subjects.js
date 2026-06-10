"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const role_1 = require("../middleware/role");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
router.get("/", async (req, res) => {
    const { school_id } = req.query;
    if (school_id) {
        const { rows } = await pool_1.pool.query(`SELECT s.id, s.name FROM subjects s
       JOIN school_subjects ss ON ss.subject_id = s.id
       WHERE ss.school_id=$1 ORDER BY s.name`, [school_id]);
        res.json(rows);
    }
    else {
        const { rows } = await pool_1.pool.query("SELECT id, name FROM subjects ORDER BY name");
        res.json(rows);
    }
});
router.post("/", (0, role_1.requireRole)("super_admin"), async (_req, res) => {
    const parsed = zod_1.z.object({ name: zod_1.z.string().min(1) }).safeParse(_req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "name kerak" });
        return;
    }
    const { rows } = await pool_1.pool.query("INSERT INTO subjects (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING id", [parsed.data.name]);
    res.status(201).json(rows[0] ?? { error: "Allaqachon mavjud" });
});
router.put("/:id", (0, role_1.requireRole)("super_admin"), async (req, res) => {
    const { name } = req.body;
    if (!name?.trim()) {
        res.status(400).json({ error: "name kerak" });
        return;
    }
    await pool_1.pool.query("UPDATE subjects SET name=$1 WHERE id=$2", [name.trim(), req.params.id]);
    res.json({ ok: true });
});
router.delete("/:id", (0, role_1.requireRole)("super_admin"), async (req, res) => {
    await pool_1.pool.query("DELETE FROM subjects WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
});
exports.default = router;
