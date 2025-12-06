// src/validators/upload.schema.ts
import { z } from "zod";

/**
 * deviceMeta shape: REQUIRED for verification.
 *
 * NOTE:
 * - farmId is REQUIRED (UUID)
 * - captureLat/Lon + captureTimestamp must be provided
 * - server handles crop logic internally (providedCropId is NOT client-supplied)
 */
export const deviceMetaSchema = z.object({
  // Required capture coordinates from device at moment of capture
  captureLat: z.number().min(-90).max(90),
  captureLon: z.number().min(-180).max(180),

  // ISO 8601 device-capture timestamp
  captureTimestamp: z.string().refine(
    (s) => !Number.isNaN(Date.parse(s)),
    { message: "captureTimestamp must be a valid ISO datetime string" }
  ),

  // Device metadata (optional)
  deviceModel: z.string().optional(),
  os: z.string().optional(),

  /**
   * REQUIRED farm ID.
   * Server will:
   *  - Validate UUID format (here)
   *  - Validate existence (controller)
   *  - Validate ownership (controller)
   */
  farmId: z.string().uuid(),
}).passthrough(); // allow additional metadata fields if needed


/**
 * STEP 1: Client requests Cloudinary signature.
 *
 * MUST include:
 * - localUploadId (UUID)
 * - deviceMeta (MUST include farmId + capture info)
 */
export const signRequestSchema = z.object({
  localUploadId: z.string().uuid(),
  deviceMeta: deviceMetaSchema,

  // optional Cloudinary details
  folder: z.string().optional(),
  filename: z.string().optional(),
});


/**
 * STEP 2: Client completes upload after Cloudinary finishes.
 *
 * Server:
 * - fetches EXIF from Cloudinary
 * - compares EXIF vs deviceMeta
 * - assigns providedCropId from farm.currentCropId
 * - creates Image row
 */
export const completeRequestSchema = z.object({
  localUploadId: z.string().uuid(),
  public_id: z.string().min(1),
  version: z.number().int().positive(),

  /**
   * Deprecated — server ignores for verification.
   * Still accepted for backward compatibility.
   */
  uploadLat: z.number().min(-90).max(90).nullable().optional(),
  uploadLon: z.number().min(-180).max(180).nullable().optional(),
  uploadTimestamp: z.string().nullable().optional(),
});
