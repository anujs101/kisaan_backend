// src/controllers/damage.controller.ts
import type { Request, Response, NextFunction } from "express";
import { prisma } from "@lib/prisma";
import { startSessionSchema, submitSessionSchema } from "@validators/damage.schema";
import { createSamplingSession, fetchSessionFull } from "@services/sampling.service";
import { addAuditLog } from "@utils/audit";
import { APIError } from "@utils/errors";
import * as MLService from "@services/ml.service"; // Import ML Service

type AuthRequest = Request & { user?: { id: string } };

function sendJson(res: Response, status: number, body: unknown) {
  return res.status(status).json(body);
}

/**
 * POST /api/farms/:farmId/damage-sessions/start
 */
export async function startSessionHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { farmId } = req.params;
    const userId = req.user!.id;
    const body = startSessionSchema.parse(req.body);

    if (!farmId) {
        throw new APIError("Farm ID is required", 400);
    }

    const farm = await prisma.farm.findUnique({
        where: { id: farmId },
        select: { userId: true, gridResolutionM: true }
    });

    if (!farm || farm.userId !== userId) {
        throw new APIError("Farm not found or access denied", 403);
    }

    const resM = farm.gridResolutionM ?? body.gridResolutionM ?? 50;

    const sessionData = await createSamplingSession(userId, farmId, resM);

    await addAuditLog({
        eventType: "session_started",
        userId,
        relatedId: sessionData.id,
        payload: { farmId, resM },
        ip: req.ip,
        userAgent: req.get("user-agent")
    });

    return sendJson(res, 200, {
        status: "ok",
        data: sessionData
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/farms/:farmId/damage-sessions/:sessionUuid
 */
export async function getSessionHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { farmId, sessionUuid } = req.params;
    
    const session = await prisma.samplingSession.findUnique({
        where: { sessionUuid },
    });

    if (!session || session.farmId !== farmId) {
        throw new APIError("Session not found", 404);
    }
    
    const fullSession = await fetchSessionFull(session.id);

    return sendJson(res, 200, {
        status: "ok",
        data: fullSession
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/farms/:farmId/damage-sessions/:sessionUuid/submit
 */
export async function submitSessionHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { farmId, sessionUuid } = req.params;
    const userId = req.user!.id;
    
    const session = await prisma.samplingSession.findUnique({
        where: { sessionUuid },
        include: { sessionBlocks: true }
    });

    if (!session || session.farmId !== farmId) {
        throw new APIError("Session not found", 404);
    }

    if (session.status !== 'ACTIVE') {
        throw new APIError(`Session is already ${session.status}`, 400);
    }

    const completedBlocks = session.sessionBlocks.filter((b: any) => b.status === 'COMPLETED' && b.imageId);
    
    if (completedBlocks.length === 0) {
        throw new APIError("No completed blocks found.", 400);
    }

    const imageIds = completedBlocks.map((b: any) => b.imageId!);

    // --- AI INTEGRATION START ---
    
    // 1. Satellite Damage Calculation (Endpoint 5)
    // Needs: poly_id, claim_date (Unix)
    const farm = await prisma.farm.findUnique({ 
        where: { id: farmId },
        include: { currentCrop: true } 
    });
    
    let satelliteResult = null;
    if (farm?.agromonitoringId) {
       const claimDateUnix = Math.floor(Date.now() / 1000);
       satelliteResult = await MLService.calculateSatelliteDamage(farm.agromonitoringId, claimDateUnix);
    }

    // 2. Create Damage Report (With Satellite Data)
    const report = await prisma.damageReport.create({
        data: {
            farmId,
            userId,
            damageStatus: "PENDING",
            claimTimestamp: new Date(),
            processedBy: "system_ml",
            
            // Map Endpoint 5 response fields
            damagePercentage: satelliteResult?.damage_percentage,
            baselineNdviAvg: satelliteResult?.details?.baseline_ndvi_avg,
            currentNdviAvg: satelliteResult?.details?.current_ndvi_avg,
            satelliteImagesAnalyzed: satelliteResult?.details?.satellite_images_analyzed,
        }
    });

    // 3. Link Images & Close Session
    await prisma.image.updateMany({ where: { id: { in: imageIds } }, data: { damageReportId: report.id } });
    await prisma.samplingSession.update({ where: { id: session.id }, data: { status: "COMPLETED", completedAt: new Date() } });

    // 4. Analyze Images Visuals (Endpoint 1 & 4)
    const images = await prisma.image.findMany({ where: { id: { in: imageIds } } });
    const cropName = farm?.currentCrop?.name || "Wheat"; 
    const damageReasons: string[] = [];

    await Promise.all(images.map(async (img: any) => {
        if (!img.storageUrl) return;

        const [cropCheck, visualDamage] = await Promise.all([
            // Endpoint 1: Verify Crop
            MLService.verifyCrop(img.storageUrl, cropName),
            // Endpoint 4: Assess Damage
            MLService.assessVisualDamage(img.storageUrl, cropName)
        ]);

        if (visualDamage?.predicted_reason) {
            damageReasons.push(visualDamage.predicted_reason);
        }

        // Update Image
        await prisma.image.update({
            where: { id: img.id },
            data: {
                aiAnalysis: {
                    crop_verification: cropCheck, // { predicted_name, match, confidence }
                    visual_damage: visualDamage   // { predicted_reason, match, confidence }
                }
            }
        });
    }));

    // 5. Update Report with Consensus Damage Type
    // If multiple images show "pest", we tag the report as "pest"
    if (damageReasons.length > 0) {
        const modeReason = damageReasons.sort((a,b) =>
          damageReasons.filter(v => v===a).length - damageReasons.filter(v => v===b).length
        ).pop();

        await prisma.damageReport.update({
            where: { id: report.id },
            data: { aiDamageType: modeReason }
        });
    }
    // --- AI INTEGRATION END ---

    await addAuditLog({
        eventType: "session_submitted",
        userId,
        relatedId: report.id,
        payload: { sessionId: session.id, imageCount: imageIds.length, satResult: !!satelliteResult },
        ip: req.ip,
        userAgent: req.get("user-agent")
    });

    return sendJson(res, 200, {
        status: "ok",
        data: {
            damageReportId: report.id,
            damageStatus: "PENDING",
            satelliteData: satelliteResult 
        }
    });

  } catch (err) {
    next(err);
  }
}