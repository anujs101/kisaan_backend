// src/controllers/cloudinary.controller.ts
import type { Request, Response, NextFunction } from "express";
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
import { Prisma } from "@prisma/client";
import { createImageRecordRaw } from "@services/createImageRecordRaw";

type AuthRequest = Request & { user?: { id: string } };

/**
 * POST /api/uploads/cloudinary/sign
 */
export async function signHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const parsed = signRequestSchema.parse(req.body);
    // keep userId undefined when not present (Prisma prefers undefined over null)
    const userId = req.user?.id ?? undefined;

    const { localUploadId, deviceMeta, folder, filename } = parsed;

    const upload = await prisma.upload.create({
      data: {
        userId,
        localUploadId,
        // use undefined instead of null for optional fields
        filename: filename ?? undefined,
        hasCaptureCoords: true,
        // cast to Prisma.InputJsonValue for create/update input
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

    return res.json({
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
    if (!upload) return res.status(404).json({ status: "error", error: "Upload not found" });

    if (upload.userId && userId && upload.userId !== userId) {
      return res.status(403).json({ status: "error", error: "Forbidden - upload belongs to different user" });
    }

    const deviceMeta = upload.deviceMeta as any;
    if (!deviceMeta || deviceMeta.captureLat === undefined || deviceMeta.captureLon === undefined || !deviceMeta.captureTimestamp) {
      await updateUploadCloudMeta(localUploadId, { uploadStatus: "FAILED" });
      return res.status(400).json({ status: "error", error: "Device-capture metadata missing on server - upload rejected" });
    }
    const deviceLat = Number(deviceMeta.captureLat);
    const deviceLon = Number(deviceMeta.captureLon);
    const deviceTs = new Date(String(deviceMeta.captureTimestamp));

    // fetch Cloudinary resource metadata (includes EXIF)
    const resource = await fetchResourceMetadata(public_id);
    const exif = (resource as any).exif ?? null;
    if (!exif) {
      await updateUploadCloudMeta(localUploadId, { cloudinaryPublicId: public_id, uploadStatus: "FAILED" });
      return res.status(400).json({ status: "error", error: "EXIF missing from image — upload rejected" });
    }

    const gpsLatRaw = exif.GPSLatitude ?? exif["GPSLatitude"] ?? null;
    const gpsLonRaw = exif.GPSLongitude ?? exif["GPSLongitude"] ?? null;
    const dateTimeOriginalRaw = exif.DateTimeOriginal ?? exif["DateTimeOriginal"] ?? exif.DateTime ?? null;

    const exifLat = parseExifGps(gpsLatRaw);
    const exifLon = parseExifGps(gpsLonRaw);
    const exifTs = dateTimeOriginalRaw ? new Date(String(dateTimeOriginalRaw)) : null;

    if (exifLat === null || exifLon === null) {
      await updateUploadCloudMeta(localUploadId, { cloudinaryPublicId: public_id, uploadStatus: "FAILED" });
      return res.status(400).json({ status: "error", error: "EXIF GPS missing or unparsable — upload rejected" });
    }

    const distanceMeters = haversineDistanceMeters(deviceLat, deviceLon, exifLat, exifLon);
    const TOLERANCE_METERS = Number(process.env.VERIFICATION_TOLERANCE_METERS ?? "50");

    const verificationOutcome = distanceMeters <= TOLERANCE_METERS ? "VERIFIED" : "FLAGGED";

    // create image row using the raw fallback (returns any)
    const image = await createImageRecordRaw({
      userId: upload.userId ?? null,
      uploadId: upload.id,
      localUploadId,
      cloudinaryPublicId: String(public_id),
      storageUrl: String((resource as any).secure_url ?? (resource as any).url ?? ""),
      thumbnailUrl: String((resource as any).secure_url ?? "").concat("?w=400").slice(0, 1024),
      exif: exif ?? {},
      exifLat,
      exifLon,
      exifTimestamp: exifTs ?? null,
      captureLat: deviceLat,
      captureLon: deviceLon,
      captureTimestamp: deviceTs,
      uploadLat: null,
      uploadLon: null,
      uploadTimestamp: null,
    });

    // image from raw SQL is typed as `any`. extract id safely.
    const imageId = (image as any)?.id;
    if (!imageId) {
      // If created row doesn't have id, fail gracefully
      console.error("createImageRecordRaw returned unexpected result:", image);
      await updateUploadCloudMeta(localUploadId, { cloudinaryPublicId: public_id, uploadStatus: "FAILED" });
      return res.status(500).json({ status: "error", error: "Failed to create image record" });
    }

    // set geom using exif coords (lon, lat order inside helper)
    try {
      await setImageGeom(imageId, exifLat, exifLon);
    } catch (e) {
      console.error("setImageGeom failed", e);
      // continue even if geom fails
    }

    // update Upload row with Cloudinary meta + status
    await updateUploadCloudMeta(localUploadId, { cloudinaryPublicId: public_id, uploadStatus: "COMPLETED" });

    // update image verification fields — use raw SQL update to avoid relying on prisma.image.update delegate
    await prisma.$executeRaw`
      UPDATE images
      SET verification_status = ${verificationOutcome === "VERIFIED" ? "VERIFIED" : "FLAGGED"},
          verification_reason = ${verificationOutcome === "VERIFIED" ? "EXIF matches device-capture" : "EXIF/device-capture distance exceeds tolerance"},
          verification_distance_m = ${distanceMeters}
      WHERE id = ${imageId};
    `;

    return res.json({
      status: "ok",
      data: {
        verification: verificationOutcome,
        distanceMeters,
        exif: { lat: exifLat, lon: exifLon, ts: exifTs },
        imageId,
        cloudinary: { public_id, version },
      },
    });
  } catch (err) {
    return next(err);
  }
}