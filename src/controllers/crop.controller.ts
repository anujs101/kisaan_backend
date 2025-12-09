import type { Request, Response, NextFunction } from "express";
import type { Crop, Role } from "@prisma/client";
import { prisma } from "@lib/prisma";
import { ZodError } from "zod";
import { createCropSchema } from "@validators/crop.schema";
import type { CreateCropInput } from "@validators/crop.schema";
import { fromZodError, APIError } from "@utils/errors";
import { addAuditLog } from "@utils/audit";

/**
 * AuthRequest mirrors pattern used across controllers.
 * Note: User.role is now an enum (Role) in the new schema; keep type-safe here.
 */
type AuthRequest = Request & { user?: { id: string; role?: Role | string } };

function sendJson(res: Response, status: number, body: unknown) {
  return res.status(status).json(body);
}

/**
 * POST /api/crops
 * Create a new crop.
 *
 * IMPORTANT (schema migration):
 * - New Prisma schema's Crop model only guarantees `code` as unique.
 * - `seasons` / `active` were removed in the new schema, so we only persist
 *   fields that exist in the new schema (name, code).
 *
 * Assumes createCropSchema is updated to match the new Crop shape.
 */
export async function createCropHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const parsed = createCropSchema.parse(req.body) as CreateCropInput;
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401, "UNAUTHORIZED");

    // Defensive uniqueness check: only `code` is unique in the new schema.
    const existing = await prisma.crop.findUnique({
      where: { code: parsed.code },
      select: { id: true, code: true },
    });

    if (existing) {
      throw new APIError("Crop with the same code already exists", 409, "DUPLICATE_CROP");
    }

    const crop = await prisma.crop.create({
      data: {
        name: parsed.name,
        code: parsed.code,
      },
    });

    await addAuditLog({
      eventType: "crop_created",
      userId,
      relatedId: crop.id,
      payload: { name: crop.name, code: crop.code },
      ip: req.ip,
      userAgent: req.get("user-agent") ?? null,
    });

    return sendJson(res, 201, { status: "ok", data: { crop } });
  } catch (err: unknown) {
    if (err instanceof ZodError) return next(fromZodError(err));
    return next(err);
  }
}

/**
 * GET /api/crops
 * List crops with optional pagination.
 *
 * No model changes required here other than types aligning with the new schema.
 */
export async function listCropsHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const perPage = Math.min(500, Math.max(1, Number(req.query.perPage ?? 100)));
    const offset = (page - 1) * perPage;

    const crops = await prisma.crop.findMany({
      orderBy: { name: "asc" },
      skip: offset,
      take: perPage,
    });

    return sendJson(res, 200, { status: "ok", data: { crops, page, perPage } });
  } catch (err) {
    return next(err);
  }
}