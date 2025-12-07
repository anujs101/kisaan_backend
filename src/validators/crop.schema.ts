// src/validators/crop.schema.ts
import { z } from "zod";

/**
 * Request body for creating a crop.
 *
 * Requirements:
 * - name: required string
 * - code: required string (unique, caller-provided)
 * - seasons: optional string[]
 * - active: optional boolean
 */
export const createCropSchema = z.object({
  name: z.string().min(1, "name is required").max(200),
  code: z
    .string()
    .min(1, "code is required")
    .max(64)
    .regex(/^[A-Za-z0-9_\-]+$/, "code may contain letters, numbers, _ and -"),
  seasons: z.array(z.string()).optional(),
  active: z.boolean().optional(),
});

export type CreateCropInput = z.infer<typeof createCropSchema>;