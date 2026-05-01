import type { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool";
import type { JwtPayload } from "../types";

export function setupSocket(io: Server) {
  // JWT autentifikatsiya middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token as string | undefined;
    if (!token) return next(new Error("Token kerak"));
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
      socket.data.user = payload;
      next();
    } catch {
      next(new Error("Token yaroqsiz"));
    }
  });

  io.on("connection", (socket) => {
    const user = socket.data.user as JwtPayload;

    // Xonaga qo'shilish
    socket.on("join_room", async (roomId: string) => {
      const { rows } = await pool.query(
        "SELECT id FROM chat_rooms WHERE id = $1 AND (parent_id = $2 OR teacher_id = $2)",
        [roomId, user.sub]
      );
      if (rows.length === 0) {
        socket.emit("error", { message: "Ruxsat yo'q" });
        return;
      }
      socket.join(`room:${roomId}`);
      socket.emit("joined", { roomId });
    });

    // Xabar yuborish
    socket.on("send_message", async (data: { roomId: string; content: string }) => {
      if (!data.content?.trim()) return;

      const { rows: room } = await pool.query(
        "SELECT id FROM chat_rooms WHERE id = $1 AND (parent_id = $2 OR teacher_id = $2)",
        [data.roomId, user.sub]
      );
      if (room.length === 0) {
        socket.emit("error", { message: "Ruxsat yo'q" });
        return;
      }

      const { rows } = await pool.query(
        `INSERT INTO chat_messages (room_id, sender_id, content)
         VALUES ($1, $2, $3) RETURNING *`,
        [data.roomId, user.sub, data.content.trim()]
      );

      const msg = rows[0];

      // Senderning ismini olish
      const { rows: userRows } = await pool.query(
        "SELECT first_name, last_name, role FROM users WHERE id = $1",
        [user.sub]
      );
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
    socket.on("mark_read", async (roomId: string) => {
      await pool.query(
        `UPDATE chat_messages SET read_at = NOW()
         WHERE room_id = $1 AND sender_id != $2 AND read_at IS NULL`,
        [roomId, user.sub]
      );
      io.to(`room:${roomId}`).emit("messages_read", { roomId, by: user.sub });
    });

    socket.on("leave_room", (roomId: string) => {
      socket.leave(`room:${roomId}`);
    });
  });
}
