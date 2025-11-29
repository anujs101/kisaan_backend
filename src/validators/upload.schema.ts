// src/validators/upload.schema.ts
import { z } from "zod";

/**
 * deviceMeta shape: core expected keys for verification.
 */
export const deviceMetaSchema = z.object({
  captureLat: z.number().min(-90).max(90),
  captureLon: z.number().min(-180).max(180),
  // ISO 8601 string for device-capture timestamp
  captureTimestamp: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "captureTimestamp must be a valid ISO datetime string",
  }),
  deviceModel: z.string().optional(),
  os: z.string().optional(),
}).passthrough();

export const signRequestSchema = z.object({
  localUploadId: z.string().uuid(),
  deviceMeta: deviceMetaSchema,
  folder: z.string().optional(),
  filename: z.string().optional(),
});

export const completeRequestSchema = z.object({
  localUploadId: z.string().uuid(),
  public_id: z.string(),
  version: z.number().int().positive(),
  uploadLat: z.number().min(-90).max(90).optional(),
  uploadLon: z.number().min(-180).max(180).optional(),
  uploadTimestamp: z.string().optional(),
});