// src/services/createImageRecordRaw.ts
import { prisma } from "@lib/prisma";

/**
 * Create image record using raw SQL (parameterized) as a robust fallback.
 * Returns the created image row (any).
 *
 * Make sure column names here match your Prisma @map values / DB table columns.
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
  exifTimestamp?: Date | null;
  captureLat?: number | null;
  captureLon?: number | null;
  captureTimestamp?: Date | null;
  uploadLat?: number | null;
  uploadLon?: number | null;
  uploadTimestamp?: Date | null;
}) {
  const result = await prisma.$queryRaw`
    INSERT INTO images
      (user_id, upload_id, local_upload_id, cloudinary_public_id, storage_url, thumbnail_url,
       exif, exif_lat, exif_lon, exif_timestamp,
       capture_lat, capture_lon, capture_timestamp,
       upload_lat, upload_lon, upload_timestamp,
       created_at)
    VALUES
      (${payload.userId}, ${payload.uploadId}, ${payload.localUploadId}, ${payload.cloudinaryPublicId}, ${payload.storageUrl}, ${payload.thumbnailUrl},
       ${payload.exif ? JSON.stringify(payload.exif) : "{}"}, ${payload.exifLat}, ${payload.exifLon}, ${payload.exifTimestamp},
       ${payload.captureLat}, ${payload.captureLon}, ${payload.captureTimestamp},
       ${payload.uploadLat}, ${payload.uploadLon}, ${payload.uploadTimestamp},
       now())
    RETURNING *;
  `;
  // Some drivers return an array, some return a single object — normalize:
  if (Array.isArray(result)) return result[0];
  return result;
}