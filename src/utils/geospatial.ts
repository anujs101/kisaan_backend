// src/utils/geospatial.ts
// Geospatial helpers (PostGIS) using prisma.$queryRaw
//
// Compatible with Prisma v7.x (prisma: "^7.0.1")
//
// Usage:
//   import { prisma } from "@lib/prisma";
//   import { distanceToImageMeters, isPointInPolygon } from "@utils/geospatial";
//
// Security:
// - Table identifiers are validated against a whitelist and escaped.
// - All dynamic values (ids, lat/lon, thresholds) are parameterized.

import { Prisma } from "@prisma/client";
import { prisma } from "@lib/prisma";

type MaybeNumber = number | null;

const ALLOWED_POLYGON_TABLES = new Set([
  "farms",
  "farm_polygons",
  "fields",
  "polygons",
  // add additional polygon table names here
]);

/**
 * Escape double quotes inside an identifier and wrap with quotes.
 * Example: farm_name  -> "farm_name"
 *          weird"name -> "weird""name"
 */
function quoteIdentifier(name: string): string {
  const escaped = name.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Distance between two lat/lon points using ST_DistanceSphere (meters).
 */
export async function distanceBetweenPointsMeters(
  latA: number,
  lonA: number,
  latB: number,
  lonB: number
): Promise<MaybeNumber> {
  const result = await prisma.$queryRaw<
    { dist: number | null }[]
  >(
    Prisma.sql`SELECT ST_DistanceSphere(
      ST_SetSRID(ST_MakePoint(${lonA}, ${latA}), 4326),
      ST_SetSRID(ST_MakePoint(${lonB}, ${latB}), 4326)
    ) AS dist;`
  );

  return result?.[0]?.dist ?? null;
}

/**
 * Distance from a given lat/lon to the geometry of an image record (meters).
 * Returns null if image not found or geom is null.
 */
export async function distanceToImageMeters(
  imageId: string,
  lat: number,
  lon: number
): Promise<MaybeNumber> {
  const result = await prisma.$queryRaw<
    { dist: number | null }[]
  >(
    Prisma.sql`SELECT ST_DistanceSphere(
      img.geom,
      ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)
    ) AS dist
    FROM images img
    WHERE img.id = ${imageId}
    LIMIT 1;`
  );

  return result?.[0]?.dist ?? null;
}

/**
 * Boolean: is a lat/lon point within `thresholdMeters` of the image geom?
 */
export async function isWithinDistanceOfImage(
  imageId: string,
  lat: number,
  lon: number,
  thresholdMeters: number
): Promise<boolean> {
  const result = await prisma.$queryRaw<
    { within: boolean | null }[]
  >(
    Prisma.sql`SELECT ST_DWithin(
      img.geom,
      ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography,
      ${thresholdMeters}
    ) AS within
    FROM images img
    WHERE img.id = ${imageId}
    LIMIT 1;`
  );

  return !!result?.[0]?.within;
}

/**
 * Point-in-polygon check.
 *
 * Checks whether the provided lat/lon point is inside the polygon (by polygonId)
 * stored in `polygonTable`'s `geom` column. (Assumes polygon table has `id` & `geom`.)
 *
 * IMPORTANT: table name cannot be parameterized directly by Prisma, so we validate it
 * against a whitelist and safely interpolate the quoted identifier using Prisma.raw().
 */
export async function isPointInPolygon(
  polygonTable: string,
  polygonId: string,
  lat: number,
  lon: number
): Promise<boolean> {
  if (!ALLOWED_POLYGON_TABLES.has(polygonTable)) {
    throw new Error(
      `Rejected polygon table "${polygonTable}". Allowed tables: ${Array.from(
        ALLOWED_POLYGON_TABLES
      ).join(", ")}`
    );
  }

  // Construct a safe quoted identifier and inject with Prisma.raw
  const tableIdent = quoteIdentifier(polygonTable); // e.g. "farm_polygons"
  const result = await prisma.$queryRaw<{ contains: boolean | null }[]>(
    // We use Prisma.raw to inject the validated identifier into the SQL fragment
    // while keeping values parameterized.
    Prisma.sql`${Prisma.raw(
      `SELECT ST_Contains(p.geom, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)) AS contains
       FROM ${tableIdent} p
       WHERE p.id = ${polygonId}
       LIMIT 1;`
    )}`
  );

  return !!result?.[0]?.contains;
}

/**
 * Helper used by verification:
 * - Returns numeric distance and boolean withinThreshold.
 */
export async function verifyDistanceToImage(
  imageId: string,
  captureLat: number,
  captureLon: number,
  thresholdMeters = 50
): Promise<{ distanceMeters: number | null; withinThreshold: boolean }> {
  const dist = await distanceToImageMeters(imageId, captureLat, captureLon);
  return {
    distanceMeters: dist,
    withinThreshold: typeof dist === "number" ? dist <= thresholdMeters : false,
  };
}
