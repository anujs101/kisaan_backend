// src/validators/farm.schema.ts
import { z } from "zod";

/**
 * Very small GeoJSON Polygon validator:
 * Expect object: { type: "Polygon", coordinates: [ [ [lon, lat], ...closed ] ] }
 * We do a basic structural check (no external lib) — server will still rely on PostGIS for geometry validity.
 */
const geoJsonPosition = z
  .tuple([z.number(), z.number()])
  .refine(([lon, lat]) => lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180, "Invalid lon/lat");

const polygonCoordinates = z
  .array(z.array(geoJsonPosition)) // array of linear rings; we only require first ring
  .min(1, "Polygon must have at least one linear ring");

export const geoJsonPolygon = z.object({
  type: z.literal("Polygon"),
  coordinates: polygonCoordinates,
});

export const createFarmSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(200).optional().nullable(),
  boundary: geoJsonPolygon,
});

export const updateFarmSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  address: z.string().max(200).optional().nullable(),
  boundary: geoJsonPolygon.optional(),
});