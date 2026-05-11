"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const role_1 = require("../middleware/role");
const router = (0, express_1.Router)();
router.get("/", async (req, res) => {
    const { school_id } = req.query;
    if (!school_id) {
        res.status(400).json({ error: "school_id kerak" });
        return;
    }
    const { rows } = await pool_1.pool.query("SELECT id, grade, letter, school_id FROM classes WHERE school_id=$1 ORDER BY grade, letter", [school_id]);
    res.json(rows);
});
router.post("/", auth_1.requireAuth, (0, role_1.requireRole)("director", "super_admin"), async (req, res) => {
    const parsed = zod_1.z.object({
        school_id: zod_1.z.string().uuid(),
        grade: zod_1.z.number().int().min(5).max(9),
        letter: zod_1.z.string().length(1),
    }).safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message });
        return;
    }
    const { rows } = await pool_1.pool.query("INSERT INTO classes (school_id, grade, letter) VALUES ($1,$2,$3) RETURNING id", [parsed.data.school_id, parsed.data.grade, parsed.data.letter.toUpperCase()]);
    res.status(201).json({ id: rows[0].id });
});
router.delete("/:id", auth_1.requireAuth, (0, role_1.requireRole)("director", "super_admin"), async (_req, res) => {
    await pool_1.pool.query("DELETE FROM classes WHERE id=$1", [_req.params.id]);
    res.json({ ok: true });
});
exports.default = router;
