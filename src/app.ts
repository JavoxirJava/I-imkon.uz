import express from "express";
import cors from "cors";
import helmet from "helmet";
import "dotenv/config";
import { logger } from "./utils/logger";

import publicRouter      from "./routes/public";
import authRouter        from "./routes/auth";
import usersRouter       from "./routes/users";
import studentsRouter    from "./routes/students";
import teachersRouter    from "./routes/teachers";
import parentsRouter     from "./routes/parents";
import chatRouter        from "./routes/chat";
import lecturesRouter    from "./routes/lectures";
import testsRouter       from "./routes/tests";
import gamesRouter       from "./routes/games";
import booksRouter       from "./routes/books";
import assignmentsRouter from "./routes/assignments";
import subjectsRouter    from "./routes/subjects";
import classesRouter     from "./routes/classes";
import schoolsRouter     from "./routes/schools";
import leaderboardRouter from "./routes/leaderboard";

const app = express();

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL ?? "http://localhost:3000",
  credentials: true,
}));
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
app.use("/public",      publicRouter);

app.use("/auth",        authRouter);
app.use("/users",       usersRouter);
app.use("/auth",        usersRouter); // change-password endpoint
app.use("/students",    studentsRouter);
app.use("/teachers",    teachersRouter);
app.use("/parents",     parentsRouter);
app.use("/chat",        chatRouter);
app.use("/lectures",    lecturesRouter);
app.use("/tests",       testsRouter);
app.use("/games",       gamesRouter);
app.use("/books",       booksRouter);
app.use("/assignments", assignmentsRouter);
app.use("/subjects",    subjectsRouter);
app.use("/classes",     classesRouter);
app.use("/schools",     schoolsRouter);
app.use("/leaderboard", leaderboardRouter);

app.use((req, res) => {
  logger.warn("404 not found", { method: req.method, path: req.path });
  res.status(404).json({ error: "Topilmadi" });
});

app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("Unhandled error", err, {
    method: req.method,
    path: req.path,
    body: req.body,
  });
  res.status(500).json({ error: "Server xatosi" });
});

export default app;
