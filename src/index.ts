import { createServer } from "http";
import { Server as SocketServer } from "socket.io";
import "dotenv/config";
import app from "./app";
import { setupSocket } from "./socket";
import { pool } from "./db/pool";

const PORT = parseInt(process.env.PORT ?? "4000", 10);

const httpServer = createServer(app);

const io = new SocketServer(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL ?? "http://localhost:3000",
    credentials: true,
  },
});

setupSocket(io);

async function start() {
  // DB ulanishini tekshirish
  try {
    await pool.query("SELECT 1");
    console.log("✅ PostgreSQL ulandi");
  } catch (err) {
    console.error("❌ PostgreSQL ulanmadi:", err);
    process.exit(1);
  }

  httpServer.listen(PORT, () => {
    console.log(`🚀 Server: http://localhost:${PORT}`);
  });
}

start();
