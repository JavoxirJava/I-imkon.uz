"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
function timestamp() {
    return new Date().toISOString();
}
function formatMeta(meta) {
    if (!meta || Object.keys(meta).length === 0)
        return "";
    try {
        return " " + JSON.stringify(meta);
    }
    catch {
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
exports.logger = {
    info(message, meta) {
        console.log(`[${timestamp()}] INFO  ${message}${formatMeta(meta)}`);
    },
    warn(message, meta) {
        console.warn(`[${timestamp()}] WARN  ${message}${formatMeta(meta)}`);
    },
    error(message, error, meta) {
        let errorPart = "";
        if (error instanceof Error) {
            errorPart = ` ${error.stack ?? error.message}`;
        }
        else if (error !== undefined) {
            errorPart = ` ${String(error)}`;
        }
        console.error(`[${timestamp()}] ERROR ${message}${errorPart}${formatMeta(meta)}`);
    },
    req(req, message, meta) {
        const where = `${req.method ?? ""} ${req.originalUrl ?? req.path ?? ""}`.trim();
        console.log(`[${timestamp()}] REQ   ${message}${where ? ` (${where})` : ""}${formatMeta(meta)}`);
    }
function fmt(level, msg, meta) {
    const ts = new Date().toISOString();
    const base = `[${ts}] [${level.toUpperCase()}] ${msg}`;
    return meta ? `${base} ${JSON.stringify(meta)}` : base;
}
exports.logger = {
    info(msg, meta) {
        console.log(fmt("info", msg, meta));
    },
    warn(msg, meta) {
        console.warn(fmt("warn", msg, meta));
    },
    error(msg, err, meta) {
        const errMeta = { ...meta };
        if (err instanceof Error) {
            errMeta.error = err.message;
            errMeta.stack = err.stack;
        }
        else if (err !== undefined) {
            errMeta.error = String(err);
        }
        console.error(fmt("error", msg, errMeta));
    },
    req(req, msg, meta) {
        exports.logger.info(msg, {
            method: req.method,
            path: req.path,
            ip: req.ip,
            ...meta,
        });
    },
};
