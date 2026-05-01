export type UserRole = "super_admin" | "director" | "teacher" | "student" | "parent";
export type UserStatus = "pending" | "active" | "rejected";

export interface UserRow {
  id: string;
  phone: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
}

export interface JwtPayload {
  sub: string;   // user id
  role: UserRole;
  iat?: number;
  exp?: number;
}

// Express request with user attached after JWT verify
import type { Request } from "express";
export interface AuthRequest extends Request {
  user?: JwtPayload;
}
