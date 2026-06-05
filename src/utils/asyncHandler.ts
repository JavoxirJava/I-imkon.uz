import type { Request, Response, NextFunction, RequestHandler } from "express";

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
export function ah<R extends Request = Request>(
  fn: (req: R, res: Response, next: NextFunction) => unknown | Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as R, res, next)).catch(next);
  };
}
