"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ah = ah;
/**
 * `ah` (async handler) — async route handler'larni o'rab, ichidagi
 * Promise rejection'larni Express error middleware'iga uzatadi.
 * Aks holda async handler ichidagi `throw` "unhandled rejection" bo'lib qoladi.
 *
 * Generic `R` tufayli handler `req` ni `AuthRequest` (yoki Request'dan kengaytirilgan
 * boshqa tip) sifatida e'lon qilishi mumkin:
 *   router.post("/", ah(async (req: AuthRequest, res) => { ... }))
 *   router.get("/",  ah(async (req, res) => { ... }))
 */
function ah(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}
