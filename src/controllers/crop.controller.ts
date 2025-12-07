// src/controllers/crop.controller.ts
import type { Request, Response, NextFunction } from "express";
import type { Crop } from "@prisma/client";
import { prisma } from "@lib/prisma";
import { ZodError } from "zod";
import { createCropSchema } from "@validators/crop.schema";
import type { CreateCropInput } from "@validators/crop.schema";
import { fromZodError, APIError } from "@utils/errors";
import { addAuditLog } from "@utils/audit";

/**
 * AuthRequest mirrors pattern used across controllers.
 */
type AuthRequest = Request & { user?: { id: string; role?: string } };

function sendJson(res: Response, status: number, body: unknown) {
  return res.status(status).json(body);
}

/**
 * POST /api/crops
 * Create a new crop. Any authenticated user can call this endpoint (per your choice).
 * `code` is required (caller-provided) and must be unique.
 */
export async function createCropHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const parsed = createCropSchema.parse(req.body) as CreateCropInput;
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401, "UNAUTHORIZED");

    // Defensive uniqueness check: prefer a user-friendly error rather than Prisma exception
    const existing = await prisma.crop.findFirst({
      where: {
        OR: [{ code: parsed.code }, { name: parsed.name }],
      },
      select: { id: true, code: true, name: true },
    });

    if (existing) {
      // If code collision or name collision -> 409
      throw new APIError("Crop with the same code or name already exists", 409, "DUPLICATE_CROP");
    }

    const crop = await prisma.crop.create({
      data: {
        name: parsed.name,
        code: parsed.code,
        seasons: parsed.seasons ?? [],
        active: parsed.active ?? true,
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
 * Simple list endpoint used by the test script / frontend dropdown.
 * Supports optional pagination via ?page & ?perPage but will return all if omitted.
 */
export async function listCropsHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // basic pagination defaults (same style as farms)
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