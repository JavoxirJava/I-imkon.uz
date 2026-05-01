"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const pool_1 = require("../db/pool");
const router = (0, express_1.Router)();
// GET /public/schools — ro'yxatdan o'tish uchun (auth kerak emas)
router.get("/schools", async (_req, res) => {
    const { rows } = await pool_1.pool.query(`SELECT id, name FROM schools ORDER BY name`);
    res.json(rows);
});
exports.default = router;
