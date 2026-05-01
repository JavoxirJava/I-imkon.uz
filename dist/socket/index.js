"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupSocket = setupSocket;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const pool_1 = require("../db/pool");
function setupSocket(io) {
    // JWT autentifikatsiya middleware
    io.use((socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token)
            return next(new Error("Token kerak"));
        try {
            const payload = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
            socket.data.user = payload;
            next();
        }
        catch {
            next(new Error("Token yaroqsiz"));
        }
    });
    io.on("connection", (socket) => {
        const user = socket.data.user;
        // Xonaga qo'shilish
        socket.on("join_room", async (roomId) => {
            const { rows } = await pool_1.pool.query("SELECT id FROM chat_rooms WHERE id = $1 AND (parent_id = $2 OR teacher_id = $2)", [roomId, user.sub]);
            if (rows.length === 0) {
                socket.emit("error", { message: "Ruxsat yo'q" });
                return;
            }
            socket.join(`room:${roomId}`);
            socket.emit("joined", { roomId });
        });
        // Xabar yuborish
        socket.on("send_message", async (data) => {
            if (!data.content?.trim())
                return;
            const { rows: room } = await pool_1.pool.query("SELECT id FROM chat_rooms WHERE id = $1 AND (parent_id = $2 OR teacher_id = $2)", [data.roomId, user.sub]);
            if (room.length === 0) {
                socket.emit("error", { message: "Ruxsat yo'q" });
                return;
            }
            const { rows } = await pool_1.pool.query(`INSERT INTO chat_messages (room_id, sender_id, content)
         VALUES ($1, $2, $3) RETURNING *`, [data.roomId, user.sub, data.content.trim()]);
            const msg = rows[0];
            // Senderning ismini olish
            const { rows: userRows } = await pool_1.pool.query("SELECT first_name, last_name, role FROM users WHERE id = $1", [user.sub]);
            const sender = userRows[0];
            const payload = {
                ...msg,
                sender_id: user.sub,
                sender_first: sender.first_name,
                sender_last: sender.last_name,
                sender_role: sender.role,
            };
            io.to(`room:${data.roomId}`).emit("new_message", payload);
        });
        // O'qildi belgisi
        socket.on("mark_read", async (roomId) => {
            await pool_1.pool.query(`UPDATE chat_messages SET read_at = NOW()
         WHERE room_id = $1 AND sender_id != $2 AND read_at IS NULL`, [roomId, user.sub]);
            io.to(`room:${roomId}`).emit("messages_read", { roomId, by: user.sub });
        });
        socket.on("leave_room", (roomId) => {
            socket.leave(`room:${roomId}`);
        });
    });
}
