// src/controllers/damage.controller.ts
import type { Request, Response, NextFunction } from "express";
import { prisma } from "@lib/prisma";
import { startSessionSchema, submitSessionSchema } from "@validators/damage.schema";
import { createSamplingSession, fetchSessionFull } from "@services/sampling.service";
import { addAuditLog } from "@utils/audit";

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
        return sendJson(res, 400, { status: "error", error: { message: "Farm ID is required" } });
    }

    const farm = await prisma.farm.findUnique({
        where: { id: farmId },
        select: { userId: true, gridResolutionM: true }
    });

    if (!farm || farm.userId !== userId) {
        return sendJson(res, 403, { status: "error", error: { message: "Farm not found or access denied" } });
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
        return sendJson(res, 404, { status: "error", error: { message: "Session not found" } });
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
        return sendJson(res, 404, { status: "error", error: { message: "Session not found" } });
    }

    if (session.status !== 'ACTIVE') {
        return sendJson(res, 400, { status: "error", error: { message: `Session is already ${session.status}` } });
    }

    // FIX: Explicitly type 'b' as 'any' to resolve TS7006 error
    const completedBlocks = session.sessionBlocks.filter((b: any) => b.status === 'COMPLETED' && b.imageId);
    
    if (completedBlocks.length === 0) {
        return sendJson(res, 400, { status: "error", error: { message: "No completed blocks found. Cannot submit empty session." } });
    }

    const imageIds = completedBlocks.map((b: any) => b.imageId!);

    // 2. Create Damage Report
    const report = await prisma.damageReport.create({
        data: {
            farmId,
            userId,
            damageStatus: "PENDING",
            claimTimestamp: new Date(),
            processedBy: "system_submit",
        }
    });

    // 3. Link Images to Report
    await prisma.image.updateMany({
        where: { id: { in: imageIds } },
        data: { damageReportId: report.id }
    });

    // 4. Mark Session Completed
    await prisma.samplingSession.update({
        where: { id: session.id },
        data: { status: "COMPLETED", completedAt: new Date() }
    });

    await addAuditLog({
        eventType: "session_submitted",
        userId,
        relatedId: report.id,
        payload: { sessionId: session.id, imageCount: imageIds.length },
        ip: req.ip,
        userAgent: req.get("user-agent")
    });

    // 5. Enqueue ML Job (Mock)
    console.log(`[ML-JOB] Enqueuing report ${report.id} for images: ${imageIds.join(', ')}`);

    return sendJson(res, 200, {
        status: "ok",
        data: {
            damageReportId: report.id,
            damageStatus: "PENDING"
        }
    });

  } catch (err) {
    next(err);
  }
}