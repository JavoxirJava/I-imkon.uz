"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
// GET /chat/rooms — mening xonalarim
router.get("/rooms", async (req, res) => {
    const userId = req.user.sub;
    const role = req.user.role;
    let query;
    if (role === "parent") {
        query = `
      SELECT cr.id, cr.created_at,
             u_t.id AS teacher_id, u_t.first_name AS teacher_first, u_t.last_name AS teacher_last,
             u_s.id AS student_id, u_s.first_name AS student_first, u_s.last_name AS student_last,
             (SELECT content FROM chat_messages WHERE room_id = cr.id ORDER BY created_at DESC LIMIT 1) AS last_message,
             (SELECT created_at FROM chat_messages WHERE room_id = cr.id ORDER BY created_at DESC LIMIT 1) AS last_message_at,
             (SELECT COUNT(*) FROM chat_messages WHERE room_id = cr.id AND sender_id != $1 AND read_at IS NULL) AS unread_count
      FROM chat_rooms cr
      JOIN users u_t ON u_t.id = cr.teacher_id
      JOIN users u_s ON u_s.id = cr.student_id
      WHERE cr.parent_id = $1
      ORDER BY last_message_at DESC NULLS LAST`;
    }
    else {
        query = `
      SELECT cr.id, cr.created_at,
             u_p.id AS parent_id, u_p.first_name AS parent_first, u_p.last_name AS parent_last,
             u_s.id AS student_id, u_s.first_name AS student_first, u_s.last_name AS student_last,
             (SELECT content FROM chat_messages WHERE room_id = cr.id ORDER BY created_at DESC LIMIT 1) AS last_message,
             (SELECT created_at FROM chat_messages WHERE room_id = cr.id ORDER BY created_at DESC LIMIT 1) AS last_message_at,
             (SELECT COUNT(*) FROM chat_messages WHERE room_id = cr.id AND sender_id != $1 AND read_at IS NULL) AS unread_count
      FROM chat_rooms cr
      JOIN users u_p ON u_p.id = cr.parent_id
      JOIN users u_s ON u_s.id = cr.student_id
      WHERE cr.teacher_id = $1
      ORDER BY last_message_at DESC NULLS LAST`;
    }
    const { rows } = await pool_1.pool.query(query, [userId]);
    res.json(rows);
});
// POST /chat/rooms — xona yaratish (parent yoki teacher tomonidan)
router.post("/rooms", async (req, res) => {
    const role = req.user.role;
    const parsed = zod_1.z.object({
        teacher_id: zod_1.z.string().uuid(),
        student_id: zod_1.z.string().uuid(),
        parent_id: zod_1.z.string().uuid().optional(),
    }).safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "teacher_id va student_id kerak" });
        return;
    }
    const teacher_id = role === "teacher" ? req.user.sub : parsed.data.teacher_id;
    const student_id = parsed.data.student_id;
    const parent_id = role === "parent" ? req.user.sub : (parsed.data.parent_id ?? "");
    if (!parent_id) {
        res.status(400).json({ error: "parent_id kerak" });
        return;
    }
    const { rows } = await pool_1.pool.query(`INSERT INTO chat_rooms (parent_id, teacher_id, student_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (parent_id, teacher_id, student_id) DO UPDATE SET parent_id = EXCLUDED.parent_id
     RETURNING *`, [parent_id, teacher_id, student_id]);
    res.status(201).json(rows[0]);
});
// GET /chat/rooms/:roomId/messages
router.get("/rooms/:roomId/messages", async (req, res) => {
    const userId = req.user.sub;
    const { roomId } = req.params;
    const limit = Math.min(parseInt(req.query.limit || "50"), 100);
    const before = req.query.before;
    // Access check
    const { rows: room } = await pool_1.pool.query("SELECT id FROM chat_rooms WHERE id = $1 AND (parent_id = $2 OR teacher_id = $2)", [roomId, userId]);
    if (room.length === 0) {
        res.status(403).json({ error: "Ruxsat yo'q" });
        return;
    }
    const { rows } = await pool_1.pool.query(`SELECT cm.id, cm.content, cm.created_at, cm.read_at,
            cm.sender_id,
            u.first_name AS sender_first, u.last_name AS sender_last, u.role AS sender_role
     FROM chat_messages cm
     JOIN users u ON u.id = cm.sender_id
     WHERE cm.room_id = $1
       ${before ? "AND cm.created_at < $3" : ""}
     ORDER BY cm.created_at DESC
     LIMIT $2`, before ? [roomId, limit, before] : [roomId, limit]);
    // O'qilmagan xabarlarni o'qilgan deb belgilash
    await pool_1.pool.query(`UPDATE chat_messages SET read_at = NOW()
     WHERE room_id = $1 AND sender_id != $2 AND read_at IS NULL`, [roomId, userId]);
    res.json(rows.reverse());
});
// POST /chat/rooms/:roomId/messages (HTTP fallback — asosan Socket.io ishlatiladi)
router.post("/rooms/:roomId/messages", async (req, res) => {
    const userId = req.user.sub;
    const { roomId } = req.params;
    const parsed = zod_1.z.object({ content: zod_1.z.string().min(1).max(4000) }).safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "Xabar matni kerak" });
        return;
    }
    const { rows: room } = await pool_1.pool.query("SELECT id FROM chat_rooms WHERE id = $1 AND (parent_id = $2 OR teacher_id = $2)", [roomId, userId]);
    if (room.length === 0) {
        res.status(403).json({ error: "Ruxsat yo'q" });
        return;
    }
    const { rows } = await pool_1.pool.query(`INSERT INTO chat_messages (room_id, sender_id, content)
     VALUES ($1, $2, $3) RETURNING *`, [roomId, userId, parsed.data.content]);
    res.status(201).json(rows[0]);
});
exports.default = router;
