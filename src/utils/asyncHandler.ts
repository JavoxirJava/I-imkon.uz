import type { Request, Response, NextFunction, RequestHandler } from "express";

// Express 4 does not catch async errors automatically — wrap every async handler with this
export function ah(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
