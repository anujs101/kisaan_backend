// src/validators/farm.schema.ts
import { z } from "zod";

/**
 * Very small GeoJSON Polygon validator:
 * Expect object: { type: "Polygon", coordinates: [ [ [lon, lat], ...closed ] ] }
 * We do a basic structural check (no external lib) — server will still rely on PostGIS for geometry validity.
 */



/**
 * Validate a GeoJSON position tuple [lon, lat]
 */
const geoJsonPosition = z
  .tuple([z.number(), z.number()])
  .refine(([lon, lat]) => lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180, {
    message: "Invalid lon/lat",
  });

/**
 * Polygon coordinates with safe narrowing for TS
 */
const polygonCoordinates = z
  .array(z.array(geoJsonPosition))
  .min(1, "Polygon must have at least one linear ring")
  .refine((rings) => {
    // Safe guard: rings[0] might be undefined in TS worldview
    if (!Array.isArray(rings) || rings.length === 0) return false;

    const outer = rings[0];
    if (!Array.isArray(outer) || outer.length < 4) return false;

    const first = outer[0];
    const last = outer[outer.length - 1];
    if (!first || !last) return false; // TS-safe narrowing

    return first[0] === last[0] && first[1] === last[1];
  }, "Outer linear ring must be closed (first == last) and contain at least 4 positions");

/**
 * GeoJSON Polygon schema
 */
export const geoJsonPolygon = z.object({
  type: z.literal("Polygon"),
  coordinates: polygonCoordinates,
});

/**
 * Create farm schema (cropId required)
 */
export const createFarmSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(200).optional().nullable(),
  boundary: geoJsonPolygon,
  cropId: z.string().uuid(),
});

/**
 * Update farm schema (cropId forbidden)
 */
export const updateFarmSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    address: z.string().max(200).optional().nullable(),
    boundary: geoJsonPolygon.optional(),
  })
  .superRefine((val, ctx) => {
    const raw = val as any;
    if (raw && Object.prototype.hasOwnProperty.call(raw, "cropId")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Updating cropId on a farm is not allowed",
      });
    }
  });

export type CreateFarmInput = z.infer<typeof createFarmSchema>;
export type UpdateFarmInput = z.infer<typeof updateFarmSchema>;
export type GeoJsonPolygon = z.infer<typeof geoJsonPolygon>;
