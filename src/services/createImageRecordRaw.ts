// src/services/createImageRecordRaw.ts
import { prisma } from "@lib/prisma";
import { normalizeExifTimestamp } from "@utils/normalizeExifTimestamp";
import { Prisma } from "@prisma/client";

/**
 * Robust image creation using raw SQL to bypass Prisma's Unsupported field issues
 */
export async function createImageRecordRaw(payload: {
  userId?: string | null;
  uploadId?: string | null;
  localUploadId: string;
  cloudinaryPublicId: string;
  storageUrl: string;
  thumbnailUrl?: string | null;

  exif: Record<string, unknown> | null;
  exifLat?: number | null;
  exifLon?: number | null;
  exifTimestamp?: Date | string | null;

  captureLat?: number | null;
  captureLon?: number | null;
  captureTimestamp?: Date | string | null;

  uploadLat?: number | null;
  uploadLon?: number | null;
  uploadTimestamp?: Date | string | null;

  /** Optional farm association */
  farmId?: string | null;
}) {
  console.log("[createImageRecordRaw] Starting image creation");

  // Normalize timestamps
  let normalizedExifTs: Date | null = null;
  try {
    if (payload.exifTimestamp != null) {
      normalizedExifTs = normalizeExifTimestamp(payload.exifTimestamp);
    }
  } catch (err) {
    console.error(
      "[createImageRecordRaw] exifTimestamp normalization failed:",
      { raw: payload.exifTimestamp, err: err instanceof Error ? err.message : String(err) }
    );
    throw err;
  }

  let normalizedCaptureTs: Date | null = null;
  try {
    if (payload.captureTimestamp != null) {
      normalizedCaptureTs = normalizeExifTimestamp(payload.captureTimestamp);
    }
  } catch (err) {
    console.error(
      "[createImageRecordRaw] captureTimestamp normalization failed:",
      { raw: payload.captureTimestamp, err: err instanceof Error ? err.message : String(err) }
    );
    throw err;
  }

  let normalizedUploadTs: Date | null = null;
  try {
    if (payload.uploadTimestamp != null) {
      normalizedUploadTs = normalizeExifTimestamp(payload.uploadTimestamp);
    }
  } catch (err) {
    console.error(
      "[createImageRecordRaw] uploadTimestamp normalization failed:",
      { raw: payload.uploadTimestamp, err: err instanceof Error ? err.message : String(err) }
    );
    throw err;
  }

  // Determine best coordinates for geom
  // Priority: captureLat/Lon > exifLat/Lon > uploadLat/Lon
  const lat = payload.captureLat ?? payload.exifLat ?? payload.uploadLat ?? null;
  const lon = payload.captureLon ?? payload.exifLon ?? payload.uploadLon ?? null;

  // Prepare data for logging
  const logData = {
    userId: payload.userId ?? null,
    uploadId: payload.uploadId ?? null,
    localUploadId: payload.localUploadId,
    cloudinaryPublicId: payload.cloudinaryPublicId,
    storageUrl: payload.storageUrl,
    thumbnailUrl: payload.thumbnailUrl ?? null,
    exifLat: payload.exifLat ?? null,
    exifLon: payload.exifLon ?? null,
    exifTimestamp: normalizedExifTs?.toISOString() ?? null,
    captureLat: payload.captureLat ?? null,
    captureLon: payload.captureLon ?? null,
    captureTimestamp: normalizedCaptureTs?.toISOString() ?? null,
    uploadLat: payload.uploadLat ?? null,
    uploadLon: payload.uploadLon ?? null,
    uploadTimestamp: normalizedUploadTs?.toISOString() ?? null,
    farmId: payload.farmId ?? null,
    geomCoords: lat !== null && lon !== null ? { lat, lon } : null,
  };

  console.log("[createImageRecordRaw] Creating image with data:", logData);

  try {
    // Use raw SQL to insert the image with geom field
    // IMPORTANT: Must quote mixed-case identifiers in PostgreSQL to preserve case
    // Without quotes, PostgreSQL converts to lowercase: farmId -> farmid
    // With quotes, it preserves case: "farmId" -> farmId
    const result = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO images (
        "userId",
        "uploadId",
        local_upload_id,
        cloudinary_public_id,
        storage_url,
        thumbnail_url,
        exif,
        exif_lat,
        exif_lon,
        exif_timestamp,
        capture_lat,
        capture_lon,
        capture_timestamp,
        upload_lat,
        upload_lon,
        upload_timestamp,
        "farmId",
        geom,
        verification_status,
        created_at
      ) VALUES (
        ${payload.userId ?? null}::uuid,
        ${payload.uploadId ?? null}::uuid,
        ${payload.localUploadId}::uuid,
        ${payload.cloudinaryPublicId},
        ${payload.storageUrl},
        ${payload.thumbnailUrl ?? null},
        ${JSON.stringify(payload.exif ?? {})}::jsonb,
        ${payload.exifLat ?? null}::double precision,
        ${payload.exifLon ?? null}::double precision,
        ${normalizedExifTs ?? null}::timestamp,
        ${payload.captureLat ?? null}::double precision,
        ${payload.captureLon ?? null}::double precision,
        ${normalizedCaptureTs ?? null}::timestamp,
        ${payload.uploadLat ?? null}::double precision,
        ${payload.uploadLon ?? null}::double precision,
        ${normalizedUploadTs ?? null}::timestamp,
        ${payload.farmId ?? null}::uuid,
        ${
          lat !== null && lon !== null
            ? Prisma.sql`ST_SetSRID(ST_MakePoint(${lon}::double precision, ${lat}::double precision), 4326)::geography`
            : Prisma.sql`NULL`
        },
        'PENDING'::"VerificationStatus",
        NOW()
      )
      RETURNING id
    `;

    if (!result || result.length === 0) {
      throw new Error("Image insert returned no ID");
    }

    const imageId = result[0].id;
    console.log(`[createImageRecordRaw] Image created successfully: ${imageId}`);

    // Fetch the complete image record to return
    const image = await prisma.image.findUnique({
      where: { id: imageId },
    });

    if (!image) {
      throw new Error("Image was created but could not be retrieved");
    }

    return image;
  } catch (createErr) {
    console.error("[createImageRecordRaw] Image creation failed", {
      message: createErr instanceof Error ? createErr.message : String(createErr),
      logData,
    });

    const e = new Error(
      `[createImageRecordRaw] Image creation failed: ${
        createErr instanceof Error ? createErr.message : String(createErr)
      }`
    );
    // @ts-ignore attach extra info for debugging
    e.details = { logData };
    throw e;
  }
}