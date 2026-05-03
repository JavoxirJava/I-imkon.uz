"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
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
