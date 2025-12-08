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

    // Ensure required device-capture metadata exists
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

    // Optional farm/crop checks (keeps your current flow)
    let providedCropId: string | null = null;
    const farmIdDeclared = deviceMeta?.farmId ?? deviceMeta?.farm_id ?? null;
    if (farmIdDeclared) {
      const farm = await prisma.farm.findUnique({
        where: { id: farmIdDeclared },
        select: { id: true, userId: true, currentCropId: true },
      });

      if (!farm)
        return sendJson(res, 404, {
          status: "error",
          error: { message: "Farm not found", code: "FARM_NOT_FOUND" },
        });

      if (farm.userId !== userId)
        return sendJson(res, 403, {
          status: "error",
          error: {
            message: "You do not own the specified farm",
            code: "FORBIDDEN",
          },
        });

      providedCropId = farm.currentCropId;
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

    const distanceMeters = haversineDistanceMeters(
      deviceLat,
      deviceLon,
      exifLat,
      exifLon
    );

    const tolerance = Number(process.env.VERIFICATION_TOLERANCE_METERS ?? "50");

    const verificationOutcome =
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
          error: {
            message: "uploadTimestamp invalid",
            code: "BAD_REQUEST",
          },
        });
      }
    }

    // Create Image Record (unchanged)
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
    if (!imageId) {
      await updateUploadCloudMeta(localUploadId, {
        cloudinaryPublicId: public_id,
        uploadStatus: "FAILED",
      });
      return sendJson(res, 500, {
        status: "error",
        error: { message: "Failed to create image record", code: "INTERNAL" },
      });
    }

    // set image geom (best-effort)
    try {
      await setImageGeom(imageId, exifLat, exifLon);
    } catch (e) {
      console.error("setImageGeom failed", e);
    }

    await updateUploadCloudMeta(localUploadId, {
      cloudinaryPublicId: public_id,
      uploadStatus: "COMPLETED",
    });

    // update verification columns on images table (best-effort)
    try {
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
    } catch (e) {
      console.error("Failed to write verification fields to images", e);
    }

    // === New: atomic linking using transaction + safe spatial selection ===
    const blockStatus = verificationOutcome === "VERIFIED" ? "COMPLETED" : "FLAGGED"; // or "PENDING_REVIEW"

    let linkedSessionBlockId: string | null = null;
    let responseCode: string = "not_linked";

    // safe extractor for first row
    function firstRow<T>(rows: unknown): T | null {
      return Array.isArray(rows) && rows.length > 0 ? (rows[0] as T) : null;
    }

    // transaction
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1) Try explicit sessionBlockId (if provided)
      const explicitBlockId = (deviceMeta && (deviceMeta.sessionBlockId ?? deviceMeta.session_block_id)) as
        | string
        | undefined
        | null;

      if (explicitBlockId) {
        try {
          const explicitUpdate = await tx.$queryRaw<
            { id: string; attempts: number }[]
          >`
            UPDATE sampling_session_blocks ssb
            SET image_id = ${imageId},
                attempts = ssb.attempts + 1,
                status = ${blockStatus},
                completed_at = now(),
                capture_lat = ${deviceLat},
                capture_lon = ${deviceLon},
                capture_timestamp = ${deviceTs}
            WHERE ssb.id = ${explicitBlockId}
              AND ssb.image_id IS NULL
            RETURNING ssb.id, ssb.attempts;
          `;

          const first = firstRow<{ id: string; attempts: number }>(explicitUpdate);

          if (first) {
            linkedSessionBlockId = first.id;
            responseCode = verificationOutcome === "VERIFIED" ? "linked_and_verified" : "linked_but_flagged";

            if (Number(first.attempts ?? 0) >= 4) {
              await tx.$executeRaw`UPDATE sampling_session_blocks SET status = 'FAILED' WHERE id = ${explicitBlockId};`;
            }

            try {
              await tx.auditLog.create({
                data: {
                  eventType: "session_block_link",
                  userId: upload.userId ?? null,
                  relatedId: linkedSessionBlockId,
                  payload: {
                    imageId,
                    method: "explicit",
                    verificationOutcome,
                    distanceMeters,
                  },
                } as any,
              });
            } catch (e) {
              console.warn("audit log insert failed", e);
            }

            return; // done
          } else {
            responseCode = "explicit_block_already_taken";
          }
        } catch (err) {
          console.warn("explicit linking failed", err);
          responseCode = "explicit_link_error";
        }
      }

      // 2) Spatial fallback — safe two-step selection + atomic update
      try {
        // Select candidate block id with row locking (SKIP LOCKED to avoid contention)
        const selectSql = Prisma.sql`
          SELECT ssb.id
          FROM sampling_session_blocks ssb
          JOIN sampling_sessions ss ON ssb.session_id = ss.id
          JOIN grid_blocks gb ON ssb.grid_block_id = gb.id
          WHERE ss.status = 'ACTIVE'
            AND ssb.image_id IS NULL
            AND ST_Contains(gb.geom, ST_SetSRID(ST_Point(${deviceLon}, ${deviceLat}), 4326))
            ${upload.userId ? Prisma.sql`AND ss.user_id = ${upload.userId}` : Prisma.sql``}
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `;

        const selectRows = await tx.$queryRawUnsafe(selectSql.text, ...selectSql.values) as { id: string }[];
        // Note: using $queryRawUnsafe to interpolate the prepared Prisma.sql — safe because values were parameterized above.
        const selected = firstRow<{ id: string }>(selectRows);

        if (selected) {
          const candidateId = selected.id;

          // Now perform atomic update on that candidateId (only if still unlinked)
          const updateSql = await tx.$queryRaw<
            { id: string; attempts: number }[]
          >`
            UPDATE sampling_session_blocks ssb
            SET image_id = ${imageId},
                attempts = ssb.attempts + 1,
                status = ${blockStatus},
                completed_at = now(),
                capture_lat = ${deviceLat},
                capture_lon = ${deviceLon},
                capture_timestamp = ${deviceTs}
            WHERE ssb.id = ${candidateId}
              AND ssb.image_id IS NULL
            RETURNING ssb.id, ssb.attempts;
          `;

          const updated = firstRow<{ id: string; attempts: number }>(updateSql);
          if (updated) {
            linkedSessionBlockId = updated.id;
            responseCode = verificationOutcome === "VERIFIED" ? "linked_and_verified" : "linked_but_flagged";

            if (Number(updated.attempts ?? 0) >= 4) {
              await tx.$executeRaw`UPDATE sampling_session_blocks SET status = 'FAILED' WHERE id = ${linkedSessionBlockId};`;
            }

            try {
              await tx.auditLog.create({
                data: {
                  eventType: "session_block_link",
                  userId: upload.userId ?? null,
                  relatedId: linkedSessionBlockId,
                  payload: {
                    imageId,
                    method: "spatial",
                    verificationOutcome,
                    distanceMeters,
                  },
                } as any,
              });
            } catch (e) {
              console.warn("audit log insert failed", e);
            }

            return; // done
          } else {
            // candidate was taken between select and update (rare); treat as conflict
            responseCode = "spatial_conflict";
          }
        } else {
          responseCode = "spatial_no_match";
        }
      } catch (err) {
        console.warn("spatial linking failed", err);
        responseCode = "spatial_link_error";
      }
    }); // end transaction

    return sendJson(res, 200, {
      status: "ok",
      data: {
        imageId,
        providedCropId,
        verification: verificationOutcome.toLowerCase(),
        distanceMeters,
        exif: { lat: exifLat, lon: exifLon, ts: exifTs },
        cloudinary: { public_id, version },
        linkedSessionBlockId,
        code: responseCode,
      },
    });
  } catch (err) {
    return next(err);
  }
}
