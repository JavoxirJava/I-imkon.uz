import type { Request } from "express";

type Level = "info" | "warn" | "error";

function fmt(level: Level, msg: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase()}] ${msg}`;
  return meta ? `${base} ${JSON.stringify(meta)}` : base;
}

export const logger = {
  info(msg: string, meta?: Record<string, unknown>) {
    console.log(fmt("info", msg, meta));
  },
  warn(msg: string, meta?: Record<string, unknown>) {
    console.warn(fmt("warn", msg, meta));
  },
  error(msg: string, err?: unknown, meta?: Record<string, unknown>) {
    const errMeta: Record<string, unknown> = { ...meta };
    if (err instanceof Error) {
      errMeta.error = err.message;
      errMeta.stack = err.stack;
    } else if (err !== undefined) {
      errMeta.error = String(err);
    }
    console.error(fmt("error", msg, errMeta));
  },
  req(req: Request, msg: string, meta?: Record<string, unknown>) {
    logger.info(msg, {
      method: req.method,
      path: req.path,
      ip: req.ip,
      ...meta,
    });
  },
};
