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
 * Creates an Upload row and returns Cloudinary signature + public_id.
 *
 * Enforces policy:
 *  - If deviceMeta.farmId is provided, requester must be authenticated and must own the farm.
 */
export async function signHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const parsed = signRequestSchema.parse(req.body);
    // keep userId undefined when not present (Prisma prefers undefined over null)
    const userId = req.user?.id ?? undefined;

    const { localUploadId, deviceMeta, folder, filename } = parsed;

    // If client is trying to presign with a farmId, enforce strict ownership now
    const declaredFarmId = (deviceMeta as any)?.farmId ?? (deviceMeta as any)?.farm_id ?? null;
    if (declaredFarmId) {
      if (!userId) {
        return sendJson(res, 403, {
          status: "error",
          error: { message: "Authentication required when associating upload with a farm", code: "FORBIDDEN" },
        });
      }
      const farm = await prisma.farm.findUnique({ where: { id: declaredFarmId }, select: { id: true, userId: true } });
      if (!farm) {
        return sendJson(res, 404, { status: "error", error: { message: "Farm not found", code: "FARM_NOT_FOUND" } });
      }
      if (farm.userId !== userId) {
        return sendJson(res, 403, { status: "error", error: { message: "You do not own the specified farm", code: "FORBIDDEN" } });
      }
    }

    const hasCaptureCoords = Boolean(deviceMeta?.captureLat !== undefined && deviceMeta?.captureLon !== undefined && deviceMeta?.captureTimestamp);
    const upload = await prisma.upload.create({
      data: {
        userId,
        localUploadId,
        filename: filename ?? undefined,
        hasCaptureCoords,
        deviceMeta: deviceMeta as Prisma.InputJsonValue,
      },
    });

    const public_id = userId ? `${userId}/${localUploadId}` : `uploads/${localUploadId}`;

    const paramsToSign: Record<string, unknown> = {
      public_id,
      folder: folder ?? "uploads",
    };

    const { signature, timestamp } = signUploadParams(paramsToSign);

    // store a copy of the signed params (cast to Prisma.InputJsonValue)
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
 *
 * - Validate upload & deviceMeta
 * - Enforce strict farm ownership if a farmId was present in deviceMeta:
 *     * If farmId present and requester not authenticated => reject (403)
 *     * If farmId present and farm exists but doesn't belong to user => reject (403)
 * - Proceed to EXIF/device verification, create image row, set geom, attach farmId.
 */
// inside same file - replace existing completeHandler with this version
export async function completeHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const parsed = completeRequestSchema.parse(req.body);
    const userId = req.user?.id ?? null;

    const { localUploadId, public_id, version } = parsed;

    const upload = await prisma.upload.findUnique({ where: { localUploadId } });
    if (!upload) return sendJson(res, 404, { status: "error", error: { message: "Upload not found", code: "NOT_FOUND" } });

    if (upload.userId && userId && upload.userId !== userId) {
      return sendJson(res, 403, { status: "error", error: { message: "Forbidden - upload belongs to different user", code: "FORBIDDEN" } });
    }

    const deviceMeta = upload.deviceMeta as any;
    if (!deviceMeta || deviceMeta.captureLat === undefined || deviceMeta.captureLon === undefined || !deviceMeta.captureTimestamp) {
      await updateUploadCloudMeta(localUploadId, { uploadStatus: "FAILED" });
      return sendJson(res, 400, { status: "error", error: { message: "Device-capture metadata missing on server - upload rejected", code: "BAD_REQUEST" } });
    }
    const deviceLat = Number(deviceMeta.captureLat);
    const deviceLon = Number(deviceMeta.captureLon);

    // ===== normalize capture timestamp safely =====
    let deviceTs: Date | null = null;
    try {
      deviceTs = normalizeExifTimestamp(deviceMeta.captureTimestamp);
    } catch (tsErr) {
      console.error("[completeHandler] captureTimestamp normalization failed", { raw: deviceMeta.captureTimestamp, err: tsErr });
      await updateUploadCloudMeta(localUploadId, { cloudinaryPublicId: public_id, uploadStatus: "FAILED" });
      return sendJson(res, 400, { status: "error", error: { message: "captureTimestamp unparsable - upload rejected", code: "BAD_REQUEST" } });
    }

    // Strict farm ownership enforcement: if a farmId was submitted in deviceMeta, require authenticated owner.
    const farmIdDeclared = deviceMeta?.farmId ?? deviceMeta?.farm_id ?? null;
    if (farmIdDeclared) {
      if (!userId) {
        return sendJson(res, 403, { status: "error", error: { message: "Authentication required when upload declares a farmId", code: "FORBIDDEN" } });
      }
      const farm = await prisma.farm.findUnique({ where: { id: farmIdDeclared }, select: { id: true, userId: true } });
      if (!farm) {
        return sendJson(res, 404, { status: "error", error: { message: "Declared farm not found", code: "FARM_NOT_FOUND" } });
      }
      if (farm.userId !== userId) {
        return sendJson(res, 403, { status: "error", error: { message: "You do not own the declared farm", code: "FORBIDDEN" } });
      }
      if (upload.userId && upload.userId !== userId) {
        return sendJson(res, 403, { status: "error", error: { message: "Upload user mismatch for declared farm", code: "FORBIDDEN" } });
      }
    }

    // fetch Cloudinary resource metadata (includes EXIF)
    const resource = await fetchResourceMetadata(public_id);
    const exif = (resource as any).exif ?? null;
    if (!exif) {
      await updateUploadCloudMeta(localUploadId, { cloudinaryPublicId: public_id, uploadStatus: "FAILED" });
      return sendJson(res, 400, { status: "error", error: { message: "EXIF missing from image — upload rejected", code: "BAD_REQUEST" } });
    }

    const gpsLatRaw = exif.GPSLatitude ?? exif["GPSLatitude"] ?? null;
    const gpsLonRaw = exif.GPSLongitude ?? exif["GPSLongitude"] ?? null;
    const dateTimeOriginalRaw = exif.DateTimeOriginal ?? exif["DateTimeOriginal"] ?? exif.DateTime ?? null;

    const exifLat = parseExifGps(gpsLatRaw);
    const exifLon = parseExifGps(gpsLonRaw);

    // normalize EXIF timestamp
    let exifTs: Date;
    try {
      exifTs = normalizeExifTimestamp(dateTimeOriginalRaw);
    } catch (e) {
      console.error("EXIF timestamp parse failed:", { raw: dateTimeOriginalRaw, err: e });
      await updateUploadCloudMeta(localUploadId, {
        cloudinaryPublicId: public_id,
        uploadStatus: "FAILED",
      });
      return res.status(400).json({
        status: "error",
        error: "EXIF timestamp unparsable — upload rejected",
      });
    }

    if (exifLat === null || exifLon === null) {
      await updateUploadCloudMeta(localUploadId, { cloudinaryPublicId: public_id, uploadStatus: "FAILED" });
      return sendJson(res, 400, { status: "error", error: { message: "EXIF GPS missing or unparsable — upload rejected", code: "BAD_REQUEST" } });
    }

    const distanceMeters = haversineDistanceMeters(deviceLat, deviceLon, exifLat, exifLon);
    const TOLERANCE_METERS = Number(process.env.VERIFICATION_TOLERANCE_METERS ?? "50");

    let verificationOutcome: "VERIFIED" | "FLAGGED" = distanceMeters <= TOLERANCE_METERS ? "VERIFIED" : "FLAGGED";

    // build safe thumbnail URL
    const secureUrl = String((resource as any).secure_url ?? (resource as any).url ?? "");
    const thumbnailUrl = secureUrl ? `${secureUrl}?w=400` : null;

    // normalize parsed.uploadTimestamp (if present)
    let normalizedUploadTs: Date | null = null;
    if (parsed.uploadTimestamp != null) {
      try {
        normalizedUploadTs = normalizeExifTimestamp(parsed.uploadTimestamp);
      } catch (uErr) {
        console.error("[completeHandler] uploadTimestamp normalization failed", { raw: parsed.uploadTimestamp, err: uErr });
        // don't block — mark upload failed so client can retry with proper value
        await updateUploadCloudMeta(localUploadId, { cloudinaryPublicId: public_id, uploadStatus: "FAILED" });
        return sendJson(res, 400, { status: "error", error: { message: "uploadTimestamp unparsable - upload rejected", code: "BAD_REQUEST" } });
      }
    }

    // create image row (wrap in try/catch so we can mark upload FAILED)
    let image: any;
    try {
      image = await createImageRecordRaw({
        userId: upload.userId ?? null,
        uploadId: upload.id,
        localUploadId,
        cloudinaryPublicId: String(public_id),
        storageUrl: secureUrl,
        thumbnailUrl: thumbnailUrl,
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
      });
    } catch (createErr) {
      console.error("[completeHandler] createImageRecordRaw failed", { err: createErr, localUploadId, public_id });
      await updateUploadCloudMeta(localUploadId, { cloudinaryPublicId: public_id, uploadStatus: "FAILED" });
      return sendJson(res, 400, { status: "error", error: { message: "Failed to create image record", details: String(createErr) } });
    }

    const imageId = (image as any)?.id;
    if (!imageId) {
      console.error("createImageRecordRaw returned unexpected result:", image);
      await updateUploadCloudMeta(localUploadId, { cloudinaryPublicId: public_id, uploadStatus: "FAILED" });
      return sendJson(res, 500, { status: "error", error: { message: "Failed to create image record", code: "INTERNAL" } });
    }

    try {
      await setImageGeom(imageId, exifLat, exifLon);
    } catch (e) {
      console.error("setImageGeom failed", e);
    }

    await updateUploadCloudMeta(localUploadId, { cloudinaryPublicId: public_id, uploadStatus: "COMPLETED" });

    await prisma.$executeRaw`
      UPDATE images
      SET verification_status = ${verificationOutcome === "VERIFIED" ? "VERIFIED" : "FLAGGED"},
          verification_reason = ${verificationOutcome === "VERIFIED" ? "EXIF matches device-capture" : "EXIF/device-capture distance exceeds tolerance"},
          verification_distance_m = ${distanceMeters}
      WHERE id = ${imageId};
    `;

    // farm validation (same logic as you had)
    // farm validation - FIXED: Cast geography to geometry for ST_IsValid
    let farmValidation: { farmId?: string; isValid?: boolean; contains?: boolean; distanceToCenterMeters?: number | null } | null = null;
    try {
      const farmId = deviceMeta?.farmId ?? deviceMeta?.farm_id ?? null;
      if (farmId) {
        // FIXED: Cast geography to geometry for ST_IsValid
        const isValidRes = (await prisma.$queryRaw<{ is_valid: boolean }[]>`
          SELECT ST_IsValid(boundary::geometry) AS is_valid
          FROM farms
          WHERE id = ${farmId}
          LIMIT 1;
        `) as { is_valid: boolean }[] | null;

        const isValid = Array.isArray(isValidRes) && isValidRes.length > 0 ? Boolean(isValidRes[0]?.is_valid) : false;

        // FIXED: Use ST_DWithin for geography distance checks (more efficient than ST_DistanceSphere)
        // ST_Contains requires geometry, so cast boundary to geometry
        const containsRes = (await prisma.$queryRaw<{ meters: number | null; contains: boolean | null }[]>`
          SELECT
            ST_Distance(
              ST_SetSRID(ST_MakePoint(${exifLon}, ${exifLat}), 4326)::geography,
              COALESCE("center", ST_SetSRID(ST_MakePoint(${exifLon}, ${exifLat}), 4326)::geography)
            ) AS meters,
            ST_Contains(
              boundary::geometry,
              ST_SetSRID(ST_MakePoint(${exifLon}, ${exifLat}), 4326)::geometry
            ) AS contains
          FROM farms
          WHERE id = ${farmId}
          LIMIT 1;
        `) as { meters: number | null; contains: boolean | null }[] | null;

        const contains = Array.isArray(containsRes) && containsRes.length > 0 ? (containsRes[0]?.contains === true) : false;
        const meters = Array.isArray(containsRes) && containsRes.length > 0 ? (typeof containsRes[0]?.meters === "number" ? containsRes[0].meters : null) : null;

        farmValidation = { farmId, isValid, contains, distanceToCenterMeters: meters };

        if (!isValid) {
          console.warn(`Farm ${farmId} boundary is invalid (ST_IsValid=false)`);
          await prisma.$executeRaw`
            UPDATE images
            SET verification_reason = coalesce(verification_reason,'') || ' | farm boundary invalid'
            WHERE id = ${imageId};
          `;
        }

        if (!contains) {
          await prisma.$executeRaw`
            UPDATE images
            SET verification_status = 'FLAGGED',
                verification_reason = coalesce(verification_reason,'') || ' | exif point outside farm boundary',
                verification_distance_m = COALESCE(verification_distance_m, ${meters})
            WHERE id = ${imageId};
          `;
          verificationOutcome = "FLAGGED";
        } else {
          await prisma.$executeRaw`
            UPDATE images
            SET verification_reason = coalesce(verification_reason,'') || ' | exif point inside farm boundary'
            WHERE id = ${imageId};
          `;
        }

        await prisma.$executeRaw`
          UPDATE images
          SET "farmId" = ${farmId}
          WHERE id = ${imageId};
        `;
      }
    } catch (farmErr) {
      console.error("Farm validation error:", farmErr);
    }

    const verificationMessage = verificationOutcome === "VERIFIED" ? "verified" : "flagged";

    return sendJson(res, 200, {
      status: "ok",
      data: {
        verification: verificationMessage,
        distanceMeters,
        exif: { lat: exifLat, lon: exifLon, ts: exifTs },
        imageId,
        cloudinary: { public_id, version },
        farmValidation,
      },
    });
  } catch (err) {
    return next(err);
  }
}
