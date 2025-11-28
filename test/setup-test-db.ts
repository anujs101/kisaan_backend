// test/setup-test-db.ts
/**
 * Test DB setup + teardown helpers for geospatial tests.
 *
 * Requirements:
 * - Ensure TEST_DATABASE_URL is set in your environment before running tests.
 *   If unset, it falls back to process.env.DATABASE_URL.
 *
 * This script:
 * - connects using your existing Prisma singleton (src/lib/prisma.ts)
 * - creates a polygon table (farm_polygons) if missing
 * - inserts a test polygon that contains the test point
 * - inserts a test image row with a geography(Point,4326) geom column
 * - provides cleanup utilities
 */

import { Prisma, PrismaClient } from "@prisma/client";
import { prisma as appPrisma } from "../src/lib/prisma.js"; // use the app singleton
import { randomUUID } from "crypto";

export type TestFixtures = {
  prisma: PrismaClient;
  imageId: string;
  polygonId: string;
  lat: number;
  lon: number;
  localUploadId: string;
};

const DEFAULT_LAT = 12.9715987; // example: Bangalore lat
const DEFAULT_LON = 77.594566;   // example: Bangalore lon

export async function setupTestDB(overrides?: Partial<{ lat: number; lon: number }>): Promise<TestFixtures> {
  const prisma = appPrisma;

  const lat = overrides?.lat ?? DEFAULT_LAT;
  const lon = overrides?.lon ?? DEFAULT_LON;

  // Use deterministic UUIDs for easy cleanup
  const imageId = "00000000-0000-0000-0000-000000000001";
  const polygonId = "00000000-0000-0000-0000-000000000011";
  const localUploadId = randomUUID();

  // Ensure polygon table exists (simple polygon table with geography column)
  await prisma.$executeRaw(Prisma.sql`
    CREATE TABLE IF NOT EXISTS farm_polygons (
      id UUID PRIMARY KEY,
      name TEXT,
      geom geography(Polygon, 4326),
      created_at timestamptz DEFAULT now()
    );
  `);

  // Insert a square polygon that contains the test point (a small square around lat/lon)
  // We'll compute points offset by ~0.001 deg (~111m) — sufficient for tests
  const offset = 0.0015;
  const polyW = lon - offset;
  const polyS = lat - offset;
  const polyE = lon + offset;
  const polyN = lat + offset;

  const polygonWkt = `POLYGON((${polyW} ${polyS}, ${polyE} ${polyS}, ${polyE} ${polyN}, ${polyW} ${polyN}, ${polyW} ${polyS}))`;

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO farm_polygons (id, name, geom)
    VALUES (${polygonId}, 'test-polygon', ST_GeomFromText(${polygonWkt}, 4326)::geography)
    ON CONFLICT (id) DO NOTHING;
  `);

  // Insert a test images row. Use raw SQL to set the geography point for geom.
  // Only insert minimal required columns: id, local_upload_id, cloudinary_public_id, storage_url, exif, image_hash, geom, created_at
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO images (id, local_upload_id, cloudinary_public_id, storage_url, exif, image_hash, geom, created_at)
    VALUES (
      ${imageId},
      ${localUploadId},
      'test-public-id',
      'https://example.local/test.jpg',
      ${Prisma.sql`'{}'::json`},
      'test-image-hash-1',
      ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography,
      now()
    )
    ON CONFLICT (id) DO NOTHING;
  `);

  return {
    prisma,
    imageId,
    polygonId,
    lat,
    lon,
    localUploadId,
  };
}

export async function teardownTestDB(fixtures: TestFixtures) {
  const prisma = fixtures.prisma;

  // Remove the test rows we inserted
  await prisma.$executeRaw(Prisma.sql`
    DELETE FROM images WHERE id = ${fixtures.imageId};
  `);

  await prisma.$executeRaw(Prisma.sql`
    DELETE FROM farm_polygons WHERE id = ${fixtures.polygonId};
  `);

  // Note: do not drop table (farm_polygons) so other tests/dev won't lose data;
  // if you want isolation, consider creating temporary schemas/tables per run.
}
