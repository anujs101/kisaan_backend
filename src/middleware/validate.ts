// src/middleware/validate.ts
import type { Request, Response, NextFunction } from "express";
import { ZodType, ZodError } from "zod";
import { fromZodError } from "@utils/errors";

/**
 * validate(schema, 'body' | 'params' | 'query')
 * Usage:
 *  router.post("/", validate(createSchema, "body"), handler);
 */
export function validate(schema: ZodType<any>, target: "body" | "params" | "query") {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse(req[target]);
      // Replace with parsed (useful for defaults/transforms)
      (req as any)[target] = parsed;
      return next();
    } catch (err) {
      if (err instanceof ZodError) {
        return next(fromZodError(err));
      }
      return next(err);
    }
  };
}
