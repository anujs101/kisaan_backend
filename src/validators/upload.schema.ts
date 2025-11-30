// src/validators/upload.schema.ts
import { z } from "zod";

/**
 * deviceMeta shape: core expected keys for verification.
 *
 * NOTE: farmId is REQUIRED at schema-level now.
 * Server will also enforce:
 *  - farm must exist
 *  - requester must be authenticated and must own the farm
 */
export const deviceMetaSchema = z.object({
  // EXIF / device capture coordinates
  captureLat: z.number().min(-90).max(90),
  captureLon: z.number().min(-180).max(180),

  // ISO 8601 device-capture timestamp
  captureTimestamp: z.string().refine(
    (s) => !Number.isNaN(Date.parse(s)),
    { message: "captureTimestamp must be a valid ISO datetime string" }
  ),

  // Optional device metadata
  deviceModel: z.string().optional(),
  os: z.string().optional(),

  /**
   * Farm ID — REQUIRED.
   * Must be a UUID. Server performs existence & ownership checks and will reject
   * requests if the farm doesn't exist or doesn't belong to the authenticated user.
   */
  farmId: z.string().uuid(),
}).passthrough(); // allow extra metadata if future devices include more fields

/**
 * First step:
 * Device sends localUploadId + metadata so server can create Upload row,
 * generate Cloudinary signed params, and return signature/public_id.
 */
export const signRequestSchema = z.object({
  localUploadId: z.string().uuid(),
  deviceMeta: deviceMetaSchema,
  folder: z.string().optional(),
  filename: z.string().optional(),
});

/**
 * After Cloudinary finishes the upload, client calls this.
 * NOTE:
 * - EXIF + deviceMeta determine coordinates; backend ignores uploadLat/uploadLon.
 * - These fields remain optional for backward compatibility.
 */
export const completeRequestSchema = z.object({
  localUploadId: z.string().uuid(),
  public_id: z.string(),
  version: z.number().int().positive(),

  // Deprecated / optional — server no longer relies on these
  uploadLat: z.number().min(-90).max(90).nullable().optional(),
  uploadLon: z.number().min(-180).max(180).nullable().optional(),
  uploadTimestamp: z.string().nullable().optional(),

});
