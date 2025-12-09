// src/controllers/weekly.controller.ts
import type { Request, Response, NextFunction } from "express";
import { prisma } from "@lib/prisma";
import { startWeeklySessionSchema, submitWeeklySessionSchema } from "@validators/weekly.schema";
import { createSamplingSession, fetchSessionFull } from "@services/sampling.service";
import { addAuditLog } from "@utils/audit";
import { APIError } from "@utils/errors";

type AuthRequest = Request & { user?: { id: string } };

function sendJson(res: Response, status: number, body: unknown) {
  return res.status(status).json(body);
}

/**
 * POST /api/farms/:farmId/weekly-sessions/start
 * Starts a new sampling session for weekly monitoring.
 */
export async function startSessionHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { farmId } = req.params;
    const userId = req.user!.id;
    const body = startWeeklySessionSchema.parse(req.body);

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

    // Reuse existing sampling service logic
    const sessionData = await createSamplingSession(userId, farmId, resM);

    await addAuditLog({
        eventType: "weekly_session_started",
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
 * GET /api/farms/:farmId/weekly-sessions/:sessionUuid
 * Retrieve the status of the current session (blocks, images, etc.)
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
 * POST /api/farms/:farmId/weekly-sessions/:sessionUuid/submit
 * Finalizes the session and creates a WeeklyReport.
 */
export async function submitSessionHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { farmId, sessionUuid } = req.params;
    const userId = req.user!.id;
    const body = submitWeeklySessionSchema.parse(req.body);
    
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

    // Filter for blocks that have an image attached
    const completedBlocks = session.sessionBlocks.filter((b: any) => b.status === 'COMPLETED' && b.imageId);
    
    if (completedBlocks.length === 0) {
        throw new APIError("No completed blocks found. Cannot submit empty session.", 400);
    }

    const imageIds = completedBlocks.map((b: any) => b.imageId!);

    // 1. Create Weekly Report
    const report = await prisma.weeklyReport.create({
        data: {
            farmId,
            userId,
            farmerGrowthStage: body.farmerGrowthStage,
            summary: body.notes ? { notes: body.notes } : undefined,
            // healthScore, predictedGrowthStage etc. will be filled by async ML jobs
        }
    });

    // 2. Link Images to Weekly Report
    await prisma.image.updateMany({
        where: { id: { in: imageIds } },
        data: { weeklyReportId: report.id }
    });

    // 3. Mark Session Completed
    await prisma.samplingSession.update({
        where: { id: session.id },
        data: { status: "COMPLETED", completedAt: new Date() }
    });

    await addAuditLog({
        eventType: "weekly_session_submitted",
        userId,
        relatedId: report.id,
        payload: { sessionId: session.id, imageCount: imageIds.length },
        ip: req.ip,
        userAgent: req.get("user-agent")
    });

    // 4. (Optional) Trigger Weekly Analysis Job here
    console.log(`[JOB] Enqueuing Weekly Analysis for Report ${report.id}`);

    return sendJson(res, 200, {
        status: "ok",
        data: {
            weeklyReportId: report.id,
            status: "SUBMITTED"
        }
    });

  } catch (err) {
    next(err);
  }
}