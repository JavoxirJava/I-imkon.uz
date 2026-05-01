"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = require("http");
const socket_io_1 = require("socket.io");
require("dotenv/config");
const app_1 = __importDefault(require("./app"));
const socket_1 = require("./socket");
const pool_1 = require("./db/pool");
const PORT = parseInt(process.env.PORT ?? "4000", 10);
const httpServer = (0, http_1.createServer)(app_1.default);
const io = new socket_io_1.Server(httpServer, {
    cors: {
        origin: process.env.FRONTEND_URL ?? "http://localhost:3000",
        credentials: true,
    },
});
(0, socket_1.setupSocket)(io);
async function start() {
    // DB ulanishini tekshirish
    try {
        await pool_1.pool.query("SELECT 1");
        console.log("✅ PostgreSQL ulandi");
    }
    catch (err) {
        console.error("❌ PostgreSQL ulanmadi:", err);
        process.exit(1);
    }
    httpServer.listen(PORT, () => {
        console.log(`🚀 Server: http://localhost:${PORT}`);
    });
}
start();
