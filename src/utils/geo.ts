// src/utils/geo.ts
import { PrismaClient } from "@prisma/client";

/**
 * Ensure each ring of a GeoJSON Polygon is closed.
 * Input: coords: Array of LinearRings (each ring is Array<[lon, lat]>)
 * Output: same shape, with each ring guaranteed to have first === last (if ring had >=1 point)
 */
export function ensureRingClosedCoords(coords: Array<Array<[number, number]>>): Array<Array<[number, number]>> {
  return coords.map((ring) => {
    // If ring is empty or has a single point, return as-is (nothing to close)
    if (!Array.isArray(ring) || ring.length === 0) return ring;

    const first = ring[0];
    const last = ring[ring.length - 1];

    // Defensive: if somehow first/last are undefined (shouldn't happen if length>0), return ring
    if (!first || !last) return ring;

    // Compare coordinate pairs (lon, lat)
    if (first[0] !== last[0] || first[1] !== last[1]) {
      return [...ring, first];
    }
    return ring;
  });
}

/**
 * Validate a GeoJSON Polygon with PostGIS ST_IsValid.
 * - prisma: your PrismaClient instance
 * - geojsonText: stringified GeoJSON (Polygon)
 *
 * Returns { valid: boolean, reason?: string }
 */
export async function validateGeoJsonPolygon(prisma: PrismaClient, geojsonText: string) {
  const sql = `
    WITH g AS (
      SELECT ST_SetSRID(ST_GeomFromGeoJSON($1::json), 4326) AS geom
    )
    SELECT
      (ST_IsValid(geom))::boolean AS valid,
      ST_IsValidReason(geom) AS reason
    FROM g;
  `;

  const raw: unknown = await prisma.$queryRawUnsafe(sql, geojsonText);
  const rows = Array.isArray(raw) ? (raw as Array<{ valid: boolean | null; reason: string | null }>) : [];

  const r = rows[0];
  if (!r) {
    // Defensive: if PostGIS didn't produce a row, treat as invalid but provide diagnostic
    return { valid: false, reason: "postgis returned no result" as string };
  }

  return { valid: Boolean(r.valid), reason: r.reason ?? undefined };
}

/**
 * Create geometry and return centroid (GeoJSON) and coordinates
 * Returns { centroidGeoJson: any, lat: number, lon: number }
 */
export async function computeCentroidFromGeoJson(prisma: PrismaClient, geojsonText: string) {
  const sql = `
    WITH g AS (
      SELECT ST_SetSRID(ST_GeomFromGeoJSON($1::json),4326) AS geom
    ), c AS (
      SELECT ST_Centroid(geom) AS centroid FROM g
    )
    SELECT ST_AsGeoJSON(c.centroid)::json AS centroid_geojson, ST_Y(c.centroid) AS lat, ST_X(c.centroid) AS lon FROM c;
  `;

  const raw: unknown = await prisma.$queryRawUnsafe(sql, geojsonText);
  const rows = Array.isArray(raw) ? (raw as Array<{ centroid_geojson: any; lat: number | null; lon: number | null }>) : [];

  const r = rows[0];
  if (!r) {
    throw new Error("Failed to compute centroid from geojson (postgis returned no rows)");
  }

  if (r.lat === null || r.lon === null) {
    throw new Error("Computed centroid has null coordinates");
  }

  return { centroidGeoJson: r.centroid_geojson, lat: r.lat, lon: r.lon };
}