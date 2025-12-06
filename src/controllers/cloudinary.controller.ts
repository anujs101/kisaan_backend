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

    const declaredFarmId = (deviceMeta as any)?.farmId ?? (deviceMeta as any)?.farm_id ?? null;
    if (declaredFarmId) {
      if (!userId) {
        return sendJson(res, 403, {
          status: "error",
          error: { message: "Authentication required when associating upload with a farm", code: "FORBIDDEN" },
        });
      }
      const farm = await prisma.farm.findUnique({
        where: { id: declaredFarmId },
        select: { id: true, userId: true },
      });
      if (!farm) {
        return sendJson(res, 404, { status: "error", error: { message: "Farm not found", code: "FARM_NOT_FOUND" } });
      }
      if (farm.userId !== userId) {
        return sendJson(res, 403, { status: "error", error: { message: "You do not own the specified farm", code: "FORBIDDEN" } });
      }
    }

    const hasCaptureCoords =
      deviceMeta?.captureLat !== undefined &&
      deviceMeta?.captureLon !== undefined &&
      deviceMeta?.captureTimestamp;

    await prisma.upload.create({
      data: {
        userId,
        localUploadId,
        filename: filename ?? undefined,
        hasCaptureCoords,
        deviceMeta: deviceMeta as Prisma.InputJsonValue,
      },
    });

    const public_id = userId ? `${userId}/${localUploadId}` : `uploads/${localUploadId}`;

    const { signature, timestamp } = signUploadParams({
      public_id,
      folder: folder ?? "uploads",
    });

    await updateUploadCloudMeta(localUploadId, {
      signedParams: { public_id, folder: folder ?? "uploads" } as Prisma.InputJsonValue,
      uploadStatus: "PENDING",
    });

    return sendJson(res, 200, {
      status: "ok",
      data: {
        signature,
        timestamp,
        apiKey: process.env.CLOUDINARY_API_KEY,
        cloudName: process.env.CLOUDINARY_CLOUD_NAME,
        public_id,
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
      return sendJson(res, 404, { status: "error", error: { message: "Upload not found", code: "NOT_FOUND" } });

    if (upload.userId && userId && upload.userId !== userId) {
      return sendJson(res, 403, {
        status: "error",
        error: { message: "Forbidden - upload belongs to a different user", code: "FORBIDDEN" },
      });
    }

    const deviceMeta = upload.deviceMeta as any;
    if (!deviceMeta?.captureLat || !deviceMeta?.captureLon || !deviceMeta?.captureTimestamp) {
      await updateUploadCloudMeta(localUploadId, { uploadStatus: "FAILED" });
      return sendJson(res, 400, {
        status: "error",
        error: { message: "Device-capture metadata missing — upload rejected", code: "BAD_REQUEST" },
      });
    }

    const deviceLat = Number(deviceMeta.captureLat);
    const deviceLon = Number(deviceMeta.captureLon);

    let deviceTs: Date | null = null;
    try {
      deviceTs = normalizeExifTimestamp(deviceMeta.captureTimestamp);
    } catch {
      await updateUploadCloudMeta(localUploadId, { cloudinaryPublicId: public_id, uploadStatus: "FAILED" });
      return sendJson(res, 400, { status: "error", error: { message: "Invalid capture timestamp", code: "BAD_REQUEST" } });
    }

    // =============== NEW LOGIC HERE ==================
    // Provided crop ID (if farmId declared)
    let providedCropId: string | null = null;
    const farmIdDeclared = deviceMeta?.farmId ?? deviceMeta?.farm_id ?? null;

    if (farmIdDeclared) {
      if (!userId)
        return sendJson(res, 403, {
          status: "error",
          error: { message: "Authentication required for farm-linked upload", code: "FORBIDDEN" },
        });

      const farm = await prisma.farm.findUnique({
        where: { id: farmIdDeclared },
        select: { id: true, userId: true, currentCropId: true },
      });

      if (!farm)
        return sendJson(res, 404, { status: "error", error: { message: "Farm not found", code: "FARM_NOT_FOUND" } });

      if (farm.userId !== userId)
        return sendJson(res, 403, {
          status: "error",
          error: { message: "You do not own the specified farm", code: "FORBIDDEN" },
        });

      providedCropId = farm.currentCropId;
    }
    // =================================================

    // Fetch Cloudinary resource EXIF
    const resource = await fetchResourceMetadata(public_id);
    const exif = (resource as any).exif ?? null;
    if (!exif) {
      await updateUploadCloudMeta(localUploadId, { cloudinaryPublicId: public_id, uploadStatus: "FAILED" });
      return sendJson(res, 400, {
        status: "error",
        error: { message: "EXIF missing — upload rejected", code: "BAD_REQUEST" },
      });
    }

    const gpsLatRaw = exif.GPSLatitude ?? exif["GPSLatitude"];
    const gpsLonRaw = exif.GPSLongitude ?? exif["GPSLongitude"];
    const timeRaw =
      exif.DateTimeOriginal ?? exif["DateTimeOriginal"] ?? exif.DateTime ?? null;

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

    const distanceMeters = haversineDistanceMeters(deviceLat, deviceLon, exifLat, exifLon);
    const tolerance = Number(process.env.VERIFICATION_TOLERANCE_METERS ?? "50");

    let verificationOutcome: "VERIFIED" | "FLAGGED" =
      distanceMeters <= tolerance ? "VERIFIED" : "FLAGGED";

    const secureUrl = (resource as any).secure_url ?? (resource as any).url ?? "";
    const thumbnailUrl = secureUrl ? `${secureUrl}?w=400` : null;

    let normalizedUploadTs: Date | null = null;
    if (parsed.uploadTimestamp) {
      try {
        normalizedUploadTs = normalizeExifTimestamp(parsed.uploadTimestamp);
      } catch {
        await updateUploadCloudMeta(localUploadId, {
          uploadStatus: "FAILED",
          cloudinaryPublicId: public_id,
        });
        return sendJson(res, 400, {
          status: "error",
          error: { message: "uploadTimestamp invalid", code: "BAD_REQUEST" },
        });
      }
    }

    // ================ CREATE IMAGE RECORD (UPDATED) ====================
    let image: any;
    try {
      image = await createImageRecordRaw({
        userId: upload.userId ?? null,
        uploadId: upload.id,
        localUploadId,
        cloudinaryPublicId: public_id,
        storageUrl: secureUrl,
        thumbnailUrl,
        exif: exif ?? {},
        exifLat,
        exifLon,
        exifTimestamp: exifTs,
        captureLat: deviceLat,
        captureLon: deviceLon,
        captureTimestamp: deviceTs,
        uploadLat: parsed.uploadLat ?? null,
        uploadLon: parsed.uploadLon ?? null,
        uploadTimestamp: normalizedUploadTs,
        farmId: farmIdDeclared ?? null,
        providedCropId, // NEW
      });
    } catch (err) {
      console.error("[completeHandler] createImageRecordRaw failed", err);
      await updateUploadCloudMeta(localUploadId, {
        cloudinaryPublicId: public_id,
        uploadStatus: "FAILED",
      });
      return sendJson(res, 400, {
        status: "error",
        error: { message: "Failed to create image record", details: String(err) },
      });
    }
    // ================================================================

    const imageId = (image as any)?.id;
    if (!imageId) {
      await updateUploadCloudMeta(localUploadId, { cloudinaryPublicId: public_id, uploadStatus: "FAILED" });
      return sendJson(res, 500, {
        status: "error",
        error: { message: "Failed to create image record", code: "INTERNAL" },
      });
    }

    try {
      await setImageGeom(imageId, exifLat, exifLon);
    } catch (e) {
      console.error("setImageGeom failed", e);
    }

    await updateUploadCloudMeta(localUploadId, {
      cloudinaryPublicId: public_id,
      uploadStatus: "COMPLETED",
    });

    await prisma.$executeRaw`
      UPDATE images
      SET verification_status = ${verificationOutcome},
          verification_reason = ${
            verificationOutcome === "VERIFIED"
              ? "EXIF matches device-capture"
              : "EXIF/device mismatch"
          },
          verification_distance_m = ${distanceMeters}
      WHERE id = ${imageId};
    `;

    return sendJson(res, 200, {
      status: "ok",
      data: {
        imageId,
        providedCropId,
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
