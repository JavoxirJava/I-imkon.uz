"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
require("dotenv/config");
const logger_1 = require("./utils/logger");
const public_1 = __importDefault(require("./routes/public"));
const auth_1 = __importDefault(require("./routes/auth"));
const users_1 = __importDefault(require("./routes/users"));
const students_1 = __importDefault(require("./routes/students"));
const teachers_1 = __importDefault(require("./routes/teachers"));
const parents_1 = __importDefault(require("./routes/parents"));
const chat_1 = __importDefault(require("./routes/chat"));
const lectures_1 = __importDefault(require("./routes/lectures"));
const tests_1 = __importDefault(require("./routes/tests"));
const games_1 = __importDefault(require("./routes/games"));
const books_1 = __importDefault(require("./routes/books"));
const assignments_1 = __importDefault(require("./routes/assignments"));
const subjects_1 = __importDefault(require("./routes/subjects"));
const classes_1 = __importDefault(require("./routes/classes"));
const schools_1 = __importDefault(require("./routes/schools"));
const leaderboard_1 = __importDefault(require("./routes/leaderboard"));
const app = (0, express_1.default)();
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({ origin: true, credentials: true }));
app.use(express_1.default.json({ limit: "2mb" }));
app.use((req, _res, next) => {
    logger_1.logger.info(`${req.method} ${req.path}`, { ip: req.ip, body: req.method !== "GET" ? req.body : undefined });
    next();
});
app.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
app.use("/public", public_1.default);
app.use("/auth", auth_1.default);
app.use("/users", users_1.default);
app.use("/auth", users_1.default); // change-password endpoint
app.use("/students", students_1.default);
app.use("/teachers", teachers_1.default);
app.use("/parents", parents_1.default);
app.use("/chat", chat_1.default);
app.use("/lectures", lectures_1.default);
app.use("/tests", tests_1.default);
app.use("/games", games_1.default);
app.use("/books", books_1.default);
app.use("/assignments", assignments_1.default);
app.use("/subjects", subjects_1.default);
app.use("/classes", classes_1.default);
app.use("/schools", schools_1.default);
app.use("/leaderboard", leaderboard_1.default);
app.use((req, res) => {
    logger_1.logger.warn("404 not found", { method: req.method, path: req.path });
    res.status(404).json({ error: "Topilmadi" });
});
app.use((err, req, res, _next) => {
    logger_1.logger.error("Unhandled error", err, {
        method: req.method,
        path: req.path,
        body: req.body,
    });
    res.status(500).json({ error: "Server xatosi" });
});
exports.default = app;
