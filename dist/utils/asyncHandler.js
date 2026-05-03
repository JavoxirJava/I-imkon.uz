"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ah = ah;
// Express 4 does not catch async errors automatically — wrap every async handler with this
function ah(fn) {
    return (req, res, next) => {
        fn(req, res, next).catch(next);
    };
}
