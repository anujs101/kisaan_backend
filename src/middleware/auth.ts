// src/middleware/auth.ts
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { APIError } from "@utils/errors";
import { prisma } from "@lib/prisma";

const ACCESS_TOKEN_SECRET = process.env.JWT_ACCESS_SECRET;
if (!ACCESS_TOKEN_SECRET) {
  throw new Error("JWT_ACCESS_SECRET is not set in environment");
}

export type AuthRequest = Request & {
  user?: { id: string; role?: string; email?: string; phone?: string };
};

export function auth() {
  return async (req: AuthRequest, _res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw new APIError("Missing or invalid Authorization header", 401, "NO_AUTH");
      }

      const token = authHeader.split(" ")[1];
      if (!token) throw new APIError("Missing token", 401, "NO_TOKEN");

      let payload: unknown;
      try {
        if (!ACCESS_TOKEN_SECRET) {
          throw new Error("JWT_ACCESS_SECRET is not set in environment");
        }
        payload = jwt.verify(token, ACCESS_TOKEN_SECRET);
      } catch (_err) {
        throw new APIError("Invalid or expired token", 401, "INVALID_TOKEN");
      }

      const parsed = payload as {
        sub?: string;
        email?: string;
        phone?: string;
        role?: string;
      };

      if (!parsed?.sub) {
        throw new APIError("Token missing subject (sub)", 401, "INVALID_TOKEN_PAYLOAD");
      }

      // Load minimal user info
      const user = await prisma.user.findUnique({
        where: { id: parsed.sub },
        select: { id: true, email: true, phone: true, role: true },
      });

      if (!user) throw new APIError("User not found", 401, "USER_NOT_FOUND");

      req.user = {
        id: user.id,
        email: user.email ?? undefined,
        phone: user.phone ?? undefined,
        role: user.role ?? undefined,
      };

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

// Optional admin-only guard
export function requireRole(role: string) {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new APIError("Not authenticated", 401, "NO_AUTH"));
    }
    if (req.user.role !== role) {
      return next(new APIError("Forbidden", 403, "FORBIDDEN"));
    }
    return next();
  };
}
