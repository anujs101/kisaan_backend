// src/controllers/cloudinary.controller.ts
import type { Request, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { signRequestSchema, completeRequestSchema } from "@validators/upload.schema";
import {
  signUploadParams,
  fetchResourceMetadata,
  parseExifGps,
  haversineDistanceMeters,
  updateUploadCloudMeta,
  setImageGeom,
} from "@services/cloudinary.service";
import { prisma } from "@lib/prisma";
import { createImageRecordRaw } from "@services/createImageRecordRaw";
import { normalizeExifTimestamp } from "@utils/normalizeExifTimestamp";
import { addAuditLog } from "@utils/audit";

type AuthRequest = Request & { user?: { id: string } };

function sendJson(res: Response, status: number, body: unknown) {
  return res.status(status).json(body);
}

/**
 * POST /api/uploads/cloudinary/sign
 */
export async function signHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const parsed = signRequestSchema.parse(req.body);
    const userId = req.user?.id ?? undefined;

    const { localUploadId, deviceMeta, folder, filename } = parsed;

    // Validate farm ownership if farmId is provided
    const declaredFarmId =
      (deviceMeta as any)?.farmId ?? (deviceMeta as any)?.farm_id ?? null;

    if (declaredFarmId) {
      if (!userId) {
        return sendJson(res, 403, {
          status: "error",
          error: {
            message: "Authentication required when associating upload with a farm",
            code: "FORBIDDEN",
          },
        });
      }

      const farm = await prisma.farm.findUnique({
        where: { id: declaredFarmId },
        select: { id: true, userId: true },
      });

      if (!farm) {
        return sendJson(res, 404, {
          status: "error",
          error: { message: "Farm not found", code: "FARM_NOT_FOUND" },
        });
      }

      if (farm.userId !== userId) {
        return sendJson(res, 403, {
          status: "error",
          error: { message: "You do not own the specified farm", code: "FORBIDDEN" },
        });
      }
    }

    // Detect if device-capture metadata is complete
    const hasCaptureCoords =
      deviceMeta?.captureLat != null &&
      deviceMeta?.captureLon != null &&
      deviceMeta?.captureTimestamp != null;

    // Store upload record
    await prisma.upload.create({
      data: {
        userId,
        localUploadId,
        filename: filename ?? undefined,
        hasCaptureCoords,
        deviceMeta: deviceMeta as Prisma.InputJsonValue,
      },
    });

    // Construct Cloudinary public_id
    const public_id = userId
      ? `${userId}/${localUploadId}`
      : `uploads/${localUploadId}`;

    // FINAL — Folder must be consistent across signature/client/Cloudinary
    const signedFolder = folder ?? "uploads";

    // Generate signature WITH folder included
    const { signature, timestamp } = signUploadParams({
      public_id,
      folder: signedFolder,
    });

    // Persist metadata
    await updateUploadCloudMeta(localUploadId, {
      signedParams: {
        public_id,
        folder: signedFolder,
      } as Prisma.InputJsonValue,
      uploadStatus: "PENDING",
    });

    // SEND FOLDER TO CLIENT — VERY IMPORTANT
    return sendJson(res, 200, {
      status: "ok",
      data: {
        signature,
        timestamp,
        apiKey: process.env.CLOUDINARY_API_KEY,
        cloudName: process.env.CLOUDINARY_CLOUD_NAME,
        public_id,
        folder: signedFolder, // >>> REQUIRED for signature match
      },
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/uploads/cloudinary/complete
 */
export async function completeHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const parsed = completeRequestSchema.parse(req.body);
    const userId = req.user?.id ?? null;
    const { localUploadId, public_id, version } = parsed;

    const upload = await prisma.upload.findUnique({ where: { localUploadId } });
    if (!upload)
      return sendJson(res, 404, {
        status: "error",
        error: { message: "Upload not found", code: "NOT_FOUND" },
      });

    if (upload.userId && userId && upload.userId !== userId) {
      return sendJson(res, 403, {
        status: "error",
        error: {
          message: "Forbidden - upload belongs to a different user",
          code: "FORBIDDEN",
        },
      });
    }

    const deviceMeta = upload.deviceMeta as any;

    // Ensure required EXIF device metadata exists
    if (
      !deviceMeta?.captureLat ||
      !deviceMeta?.captureLon ||
      !deviceMeta?.captureTimestamp
    ) {
      await updateUploadCloudMeta(localUploadId, { uploadStatus: "FAILED" });
      return sendJson(res, 400, {
        status: "error",
        error: {
          message: "Device-capture metadata missing — upload rejected",
          code: "BAD_REQUEST",
        },
      });
    }

    const deviceLat = Number(deviceMeta.captureLat);
    const deviceLon = Number(deviceMeta.captureLon);

    let deviceTs: Date;
    try {
      deviceTs = normalizeExifTimestamp(deviceMeta.captureTimestamp);
    } catch {
      await updateUploadCloudMeta(localUploadId, {
        cloudinaryPublicId: public_id,
        uploadStatus: "FAILED",
      });
      return sendJson(res, 400, {
        status: "error",
        error: { message: "Invalid capture timestamp", code: "BAD_REQUEST" },
      });
    }

    // Provided crop ID via farm
    let providedCropId: string | null = null;
    const farmIdDeclared = deviceMeta?.farmId ?? deviceMeta?.farm_id ?? null;

    if (farmIdDeclared) {
      const farm = await prisma.farm.findUnique({
        where: { id: farmIdDeclared },
        select: { id: true, userId: true, currentCropId: true },
      });

      if (farm && farm.userId === userId) {
        providedCropId = farm.currentCropId ?? null;
      }
    }

    // Fetch EXIF from Cloudinary
    const resource = await fetchResourceMetadata(public_id);
    const exif = (resource as any).exif ?? null;

    if (!exif) {
      await updateUploadCloudMeta(localUploadId, {
        cloudinaryPublicId: public_id,
        uploadStatus: "FAILED",
      });
      return sendJson(res, 400, {
        status: "error",
        error: { message: "EXIF missing — upload rejected", code: "BAD_REQUEST" },
      });
    }

    const gpsLatRaw = exif.GPSLatitude;
    const gpsLonRaw = exif.GPSLongitude;
    const timeRaw =
      exif.DateTimeOriginal ??
      exif["DateTimeOriginal"] ??
      exif.DateTime ??
      null;

    const exifLat = parseExifGps(gpsLatRaw);
    const exifLon = parseExifGps(gpsLonRaw);

    if (exifLat == null || exifLon == null) {
      await updateUploadCloudMeta(localUploadId, {
        cloudinaryPublicId: public_id,
        uploadStatus: "FAILED",
      });
      return sendJson(res, 400, {
        status: "error",
        error: { message: "EXIF GPS missing — upload rejected", code: "BAD_REQUEST" },
      });
    }

    let exifTs: Date;
    try {
      exifTs = normalizeExifTimestamp(timeRaw);
    } catch {
      await updateUploadCloudMeta(localUploadId, {
        cloudinaryPublicId: public_id,
        uploadStatus: "FAILED",
      });
      return sendJson(res, 400, {
        status: "error",
        error: { message: "EXIF timestamp invalid", code: "BAD_REQUEST" },
      });
    }

    // Verification Logic
    const distanceMeters = haversineDistanceMeters(
      deviceLat,
      deviceLon,
      exifLat,
      exifLon
    );
    const tolerance = Number(process.env.VERIFICATION_TOLERANCE_METERS ?? "50");
    const verificationOutcome = distanceMeters <= tolerance ? "VERIFIED" : "FLAGGED";

    const secureUrl = (resource as any).secure_url ?? (resource as any).url ?? "";
    const thumbnailUrl = secureUrl ? `${secureUrl}?w=400` : null;

    let normalizedUploadTs: Date | null = null;
    if (parsed.uploadTimestamp) {
        try { normalizedUploadTs = normalizeExifTimestamp(parsed.uploadTimestamp); } catch {}
    }

    // Create Image Record
    let image: any;
    try {
      image = await createImageRecordRaw({
        userId: upload.userId ?? null,
        uploadId: upload.id,
        localUploadId,
        cloudinaryPublicId: public_id,
        storageUrl: secureUrl,
        thumbnailUrl,
        exif,
        exifLat,
        exifLon,
        exifTimestamp: exifTs,
        captureLat: deviceLat,
        captureLon: deviceLon,
        captureTimestamp: deviceTs,
        // Pass optional fields safely (even if ignored by SQL)
        uploadLat: parsed.uploadLat ?? null,
        uploadLon: parsed.uploadLon ?? null,
        uploadTimestamp: normalizedUploadTs,
        farmId: farmIdDeclared ?? null,
        providedCropId,
      });
    } catch (err) {
      console.error("[completeHandler] createImageRecordRaw failed", err);
      await updateUploadCloudMeta(localUploadId, {
        cloudinaryPublicId: public_id,
        uploadStatus: "FAILED",
      });
      return sendJson(res, 400, {
        status: "error",
        error: {
          message: "Failed to create image record",
          details: String(err),
        },
      });
    }

    const imageId = (image as any)?.id;
    if (!imageId) throw new Error("Image created but ID missing");

    try {
      await setImageGeom(imageId, exifLat, exifLon);
    } catch (e) {
      console.error("setImageGeom failed", e);
    }

    await updateUploadCloudMeta(localUploadId, {
      cloudinaryPublicId: public_id,
      uploadStatus: "COMPLETED",
    });

    // ---------------------------------------------------------
    // NEW: Link Image to Sampling Session Block
    // ---------------------------------------------------------
    const sessionBlockId = (deviceMeta as any)?.sessionBlockId;
    let linkedBlockId = null;

    if (sessionBlockId) {
      try {
        const block = await prisma.samplingSessionBlock.update({
          where: { id: sessionBlockId },
          data: {
            imageId: imageId,
            status: "COMPLETED",
            attempts: { increment: 1 },
            completedAt: new Date(),
            captureLat: deviceLat,
            captureLon: deviceLon,
            captureTimestamp: deviceTs,
          },
        });
        linkedBlockId = block.id;
      } catch (e) {
        console.error(`Failed to link image ${imageId} to session block ${sessionBlockId}:`, e);
      }
    }

    // Audit log the verification outcome
    await addAuditLog({
      eventType: "image_auto_verification",
      userId: upload.userId ?? null,
      relatedId: imageId,
      payload: {
        verificationOutcome,
        distanceMeters,
        tolerance,
        linkedBlockId,
      },
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    });

    return sendJson(res, 200, {
      status: "ok",
      data: {
        imageId,
        sessionBlockId: linkedBlockId, // Client needs to know this confirmed
        verification: verificationOutcome.toLowerCase(),
        distanceMeters,
        exif: { lat: exifLat, lon: exifLon, ts: exifTs },
        cloudinary: { public_id, version },
      },
    });
  } catch (err) {
    return next(err);
  }
}