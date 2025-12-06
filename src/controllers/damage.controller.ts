import type { Request, Response, NextFunction } from "express";
import { createDamageReportSchema } from "@validators/damage.schema";
import { prisma } from "@lib/prisma";
import { APIError, fromZodError } from "@utils/errors";
import { damageService } from "@services/damage.service";
import { ZodError } from "zod";

type AuthRequest = Request & { user?: { id: string } };

function sendJson(res: Response, status: number, body: unknown) {
  return res.status(status).json(body);
}

/**
 * POST /damage-report
 * Initialize a new damage report
 */
export async function createDamageReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    if (!userId) throw new APIError("Unauthorized", 401, "UNAUTHORIZED");

    const parsed = createDamageReportSchema.parse(req.body);

    // Validate Farm Ownership
    const farm = await prisma.farm.findUnique({
      where: { id: parsed.farmId }
    });

    if (!farm) throw new APIError("Farm not found", 404);
    if (farm.userId !== userId) throw new APIError("You do not own this farm", 403);

    // Create Entry
    const damageCase = await prisma.damageCase.create({
      data: {
        createdBy: userId,
        farmId: parsed.farmId,
        damageType: parsed.damageType,
        status: "processing", // Initial status
        
        // Store initial photos in the JSON blob for reference
        reportDetails: {
          photos: parsed.photos.map(url => ({ type: "field", url })),
          cropTypeInput: parsed.cropType
        }
      }
    });

    return sendJson(res, 201, {
      status: "ok",
      message: "Damage report initialized",
      data: {
        reportId: damageCase.id,
        status: damageCase.status
      }
    });

  } catch (err) {
    if (err instanceof ZodError) return next(fromZodError(err));
    return next(err);
  }
}

/**
 * GET /damage-report/:id
 * Lazy-load processing: If 'processing', runs pipeline synchronously then returns.
 */
export async function getDamageReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    if (!userId) throw new APIError("Unauthorized", 401);

    const report = await prisma.damageCase.findUnique({
      where: { id }
    });

    if (!report) throw new APIError("Report not found", 404);
    if (report.createdBy !== userId) throw new APIError("Forbidden", 403);

    // If completed, return data
    if (report.status === "completed" && report.reportDetails) {
      return sendJson(res, 200, report.reportDetails);
    }

    // If processing, RUN PIPELINE
    if (report.status === "processing") {
      try {
        // Trigger the pipeline synchronously (as requested)
        const result = await damageService.processDamageReport(id!);
        return sendJson(res, 200, result);
      } catch (pipelineErr) {
        console.error("Pipeline failed", pipelineErr);
        // Mark failed
        await prisma.damageCase.update({
          where: { id },
          data: { status: "failed" }
        });
        throw new APIError("Analysis pipeline failed", 500, "ANALYSIS_FAILED", { originalError: String(pipelineErr) });
      }
    }

    // Default fallback (e.g. if failed or unknown)
    return sendJson(res, 200, {
      id: report.id,
      status: report.status,
      note: "Report is not in a valid processing state or has failed."
    });

  } catch (err) {
    return next(err);
  }
}