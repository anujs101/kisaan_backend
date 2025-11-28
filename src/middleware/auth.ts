// src/middleware/auth.ts
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { APIError } from "@utils/errors";
import { prisma } from "@lib/prisma";

const ACCESS_TOKEN_SECRET = process.env.JWT_ACCESS_SECRET || "accesstokensecret";
if (!ACCESS_TOKEN_SECRET) {
  // Throw at import time to catch missing env early; after this check,
  // TypeScript knows ACCESS_TOKEN_SECRET is a string.
  throw new Error("JWT_ACCESS_SECRET is not set in environment");
}

export type AuthRequest = Request & { user?: { id: string; role?: string; email?: string } };

/**
 * auth() middleware
 * - expects Authorization: Bearer <token>
 * - verifies JWT signature
 * - attaches user object to req.user (id, role, email)
 */
export function auth() {
  return async (req: AuthRequest, _res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw new APIError("Missing or invalid Authorization header", 401, "NO_AUTH");
      }

      const token = authHeader.split(" ")[1];
      if (!token || typeof token !== "string") {
        throw new APIError("Missing token", 401, "NO_TOKEN");
      }

      let payload: unknown;
      try {
        // ACCESS_TOKEN_SECRET is guaranteed to be a string above
        payload = jwt.verify(token, ACCESS_TOKEN_SECRET);
      } catch (err) {
        throw new APIError("Invalid or expired token", 401, "INVALID_TOKEN");
      }

      // Expect token to contain at least sub (user id). Keep type-check careful.
      const parsed = payload as { sub?: string; email?: string; role?: string };

      if (!parsed?.sub) {
        throw new APIError("Token payload missing subject (sub)", 401, "INVALID_TOKEN_PAYLOAD");
      }

      // Load user from DB (minimal select)
      const user = await prisma.user.findUnique({
        where: { id: parsed.sub },
        select: { id: true, email: true, role: true },
      });

      if (!user) {
        throw new APIError("User not found", 401, "USER_NOT_FOUND");
      }

      req.user = { id: user.id, email: user.email ?? undefined, role: user.role ?? undefined };
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * optionally: adminOnly middleware generator
 */
export function requireRole(role: string) {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      return next(new APIError("Not authenticated", 401, "NO_AUTH"));
    }
    if (user.role !== role) {
      return next(new APIError("Forbidden", 403, "FORBIDDEN"));
    }
    return next();
  };
}
