"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
// GET /leaderboard?period=all_time|weekly&class_id=
router.get("/", async (req, res) => {
    const period = req.query.period === "weekly" ? "weekly" : "all_time";
    const { class_id } = req.query;
    const timeFilter = period === "weekly"
        ? "AND ta.finished_at >= NOW() - INTERVAL '7 days'"
        : "";
    const classFilter = class_id ? "AND sp.class_id = $1" : "";
    const params = class_id ? [class_id] : [];
    const { rows } = await pool_1.pool.query(`SELECT u.id AS user_id,
            u.first_name, u.last_name,
            COALESCE(SUM(ta.score), 0)::numeric AS total_score,
            COUNT(ta.id)::int AS attempt_count,
            ROW_NUMBER() OVER (ORDER BY COALESCE(SUM(ta.score),0) DESC)::int AS rank
     FROM users u
     JOIN student_profiles sp ON sp.user_id = u.id
     LEFT JOIN test_attempts ta
       ON ta.student_id = u.id AND ta.finished_at IS NOT NULL ${timeFilter}
     WHERE u.role = 'student' AND u.status = 'active' ${classFilter}
     GROUP BY u.id, u.first_name, u.last_name
     ORDER BY total_score DESC
     LIMIT 100`, params);
    res.json(rows);
});
exports.default = router;
