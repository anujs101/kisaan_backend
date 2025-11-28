// src/middleware/rateLimiter.ts
import type { Request, Response, NextFunction } from "express";
import { APIError } from "@utils/errors";

/**
 * Simple in-memory rate limiter for quick protection in dev/hackathon.
 * NOT suitable for multi-process production. For production use Redis or a gateway.
 *
 * Usage:
 *  app.use(rateLimiter({ windowMs: 60000, max: 60 }));
 */
type Opts = { windowMs?: number; max?: number };

export function rateLimiter(opts: Opts = {}) {
  const windowMs = opts.windowMs ?? 60_000; // 1 min
  const max = opts.max ?? 60;

  // Map key -> { count, firstSeen }
  const store = new Map<string, { count: number; firstSeen: number }>();

  // clean-up interval
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of store.entries()) {
      if (now - v.firstSeen > windowMs) store.delete(k);
    }
  }, windowMs).unref();

  return (req: Request, _res: Response, next: NextFunction) => {
    // identify by IP (behind proxies set trust proxy and use X-Forwarded-For)
    // Parentheses required because mixing || and ?? needs explicit grouping
    const key = (req.ip || req.headers["x-forwarded-for"]?.toString()) ?? "anon";

    const now = Date.now();
    const entry = store.get(key);
    if (!entry) {
      store.set(key, { count: 1, firstSeen: now });
      return next();
    }

    if (now - entry.firstSeen > windowMs) {
      store.set(key, { count: 1, firstSeen: now });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      return next(new APIError("Too many requests", 429, "RATE_LIMIT_EXCEEDED"));
    }

    return next();
  };
}
