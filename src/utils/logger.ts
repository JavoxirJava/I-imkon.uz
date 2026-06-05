import type { Request } from "express";

type Meta = Record<string, unknown>;

function timestamp(): string {
  return new Date().toISOString();
}

function formatMeta(meta?: Meta): string {
  if (!meta || Object.keys(meta).length === 0) return "";
  try {
    return " " + JSON.stringify(meta);
  } catch {
    return " [meta serialize qilib bo'lmadi]";
  }
}

/**
 * Oddiy, bog'liqliksiz strukturali logger. Console'ga yozadi.
 * Ishlatilishi:
 *   logger.info("xabar", { meta })
 *   logger.warn("xabar", { meta })
 *   logger.error("xabar", err, { meta })
 *   logger.req(req, "xabar", { meta })
 */
export const logger = {
  info(message: string, meta?: Meta): void {
    console.log(`[${timestamp()}] INFO  ${message}${formatMeta(meta)}`);
  },

  warn(message: string, meta?: Meta): void {
    console.warn(`[${timestamp()}] WARN  ${message}${formatMeta(meta)}`);
  },

  error(message: string, error?: unknown, meta?: Meta): void {
    let errorPart = "";
    if (error instanceof Error) {
      errorPart = ` ${error.stack ?? error.message}`;
    } else if (error !== undefined) {
      errorPart = ` ${String(error)}`;
    }
    console.error(`[${timestamp()}] ERROR ${message}${errorPart}${formatMeta(meta)}`);
  },

  req(req: Pick<Request, "method" | "originalUrl" | "path">, message: string, meta?: Meta): void {
    const where = `${req.method ?? ""} ${req.originalUrl ?? req.path ?? ""}`.trim();
    console.log(`[${timestamp()}] REQ   ${message}${where ? ` (${where})` : ""}${formatMeta(meta)}`);
  },
};
