import type { Response, NextFunction } from "express";
import type { AuthRequest, UserRole } from "../types";

export function requireRole(...roles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "Ruxsat yo'q" });
      return;
    }
    next();
  };
}
