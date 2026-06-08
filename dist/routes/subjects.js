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
// POST /subjects/fix-orphaned-links — fansiz mavzularni ko'rsatilgan fanga biriktiradi
router.post("/fix-orphaned-links", (0, role_1.requireRole)("super_admin"), async (req, res) => {
    const parsed = zod_1.z.object({
        fan_subject_id: zod_1.z.string().uuid().optional(),
        fan_name: zod_1.z.string().min(1).optional(),
    }).refine((d) => d.fan_subject_id || d.fan_name, {
        message: "fan_subject_id yoki fan_name kerak",
    }).safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message });
        return;
    }
    // ID yoki nom bo'yicha fan topish
    const { rows: fanRows } = parsed.data.fan_subject_id
        ? await pool_1.pool.query("SELECT id, name FROM subjects WHERE id = $1", [parsed.data.fan_subject_id])
        : await pool_1.pool.query("SELECT id, name FROM subjects WHERE name = $1 LIMIT 1", [parsed.data.fan_name]);
    if (!fanRows[0]) {
        res.status(404).json({ error: "Fan topilmadi" });
        return;
    }
    const fan_subject_id = fanRows[0].id;
    await pool_1.pool.query(`
    CREATE TABLE IF NOT EXISTS subject_topic_links (
      topic_subject_id UUID PRIMARY KEY REFERENCES subjects(id) ON DELETE CASCADE,
      fan_subject_id   UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    // teacher_assignments'dagi barcha subjectlar ichidan:
    // - subject_topic_links da yo'qlar (orphan)
    // - o'zi fan_subject_id sifatida ishlatilmaganlar (ya'ni fan emas)
    // - berilgan fan_subject_id ning o'zi emas
    const { rows } = await pool_1.pool.query(`
    INSERT INTO subject_topic_links (topic_subject_id, fan_subject_id)
    SELECT DISTINCT ta.subject_id, $1
    FROM teacher_assignments ta
    WHERE ta.subject_id != $1
      AND NOT EXISTS (
        SELECT 1 FROM subject_topic_links stl WHERE stl.topic_subject_id = ta.subject_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM subject_topic_links stl WHERE stl.fan_subject_id = ta.subject_id
      )
    ON CONFLICT (topic_subject_id) DO NOTHING
    RETURNING topic_subject_id
  `, [fan_subject_id]);
    res.json({ linked: rows.length, fan: fanRows[0].name });
});
exports.default = router;
