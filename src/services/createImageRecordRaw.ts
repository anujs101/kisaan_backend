import { prisma } from "@lib/prisma";
import type { Prisma } from "@prisma/client";
import { APIError } from "@utils/errors";

/**
 * Insert an image row using raw SQL (PostGIS geom + explicit casts).
 * Columns chosen to match your Prisma schema exactly (mix of snake_case and camelCase).
 *
 * Schema-referenced columns used here (matches your schema):
 * - local_upload_id, cloudinary_public_id, storage_url, thumbnail_url,
 * - exif, exif_lat, exif_lon, exif_timestamp,
 * - capture_lat, capture_lon, capture_timestamp,
 * - grid_block_id, geom, image_hash, upload_id,
 * - damage_report_id, weekly_report_id, final_report_id,
 * - userId, farmId, created_at
 *
 * Returns the inserted row (fields aliased to camelCase where helpful).
 */
type Input = {
  userId?: string | null;
  uploadId?: string | null;
  localUploadId: string;
  cloudinaryPublicId: string;
  storageUrl?: string | null;
  thumbnailUrl?: string | null;

  exif?: Prisma.InputJsonValue | null;
  exifLat?: number | null;
  exifLon?: number | null;
  exifTimestamp?: Date | string | null;

  captureLat?: number | null;
  captureLon?: number | null;
  captureTimestamp?: Date | string | null;

  gridBlockId?: string | null;

  farmId?: string | null;

  imageHash?: string | null;

  damageReportId?: string | null;
  weeklyReportId?: string | null;
  finalReportId?: string | null;
};

export async function createImageRecordRaw(input: Input): Promise<Record<string, unknown>> {
  // Validation: must have coordinates (either capture or exif) to create geom per your verification rules
  if (
    (input.captureLat == null || input.captureLon == null) &&
    (input.exifLat == null || input.exifLon == null)
  ) {
    throw new APIError("Either capture coords or EXIF coords are required to set geom", 400, "MISSING_COORDS");
  }

  // prefer device-capture coords if available (enforced by your verification rules)
  const useCapture = input.captureLat != null && input.captureLon != null;
  const geomLat = useCapture ? input.captureLat! : input.exifLat!;
  const geomLon = useCapture ? input.captureLon! : input.exifLon!;

  // Build SQL using exact DB column names from your schema.
  // Note: "userId" and "farmId" are camelCase in your schema and must be quoted.
  const sql = `
    INSERT INTO public.images (
      local_upload_id,
      cloudinary_public_id,
      storage_url,
      thumbnail_url,

      exif,
      exif_lat,
      exif_lon,
      exif_timestamp,

      capture_lat,
      capture_lon,
      capture_timestamp,

      grid_block_id,

      -- userId and farmId are camelCase in the schema (no @map), so quote them
      "userId",
      "farmId",

      image_hash,
      upload_id,

      damage_report_id,
      weekly_report_id,
      final_report_id,

      geom,
      created_at
    )
    VALUES (
      $1::uuid,    -- local_upload_id
      $2::text,    -- cloudinary_public_id
      $3::text,    -- storage_url
      $4::text,    -- thumbnail_url

      $5::json,    -- exif
      $6::double precision, -- exif_lat
      $7::double precision, -- exif_lon
      $8::timestamptz,      -- exif_timestamp

      $9::double precision,  -- capture_lat
      $10::double precision, -- capture_lon
      $11::timestamptz,      -- capture_timestamp

      $12::uuid,   -- grid_block_id

      $13::uuid,   -- "userId"
      $14::uuid,   -- "farmId"

      $15::text,   -- image_hash
      $16::uuid,   -- upload_id

      $17::uuid,   -- damage_report_id
      $18::uuid,   -- weekly_report_id
      $19::uuid,   -- final_report_id

      ST_SetSRID(ST_MakePoint($20::double precision, $21::double precision), 4326)::geography, -- geom (lon, lat)
      NOW()
    )
    RETURNING
      id,
      local_upload_id    AS "localUploadId",
      cloudinary_public_id AS "cloudinaryPublicId",
      storage_url        AS "storageUrl",
      thumbnail_url      AS "thumbnailUrl",

      exif,
      exif_lat           AS "exifLat",
      exif_lon           AS "exifLon",
      exif_timestamp     AS "exifTimestamp",

      capture_lat        AS "captureLat",
      capture_lon        AS "captureLon",
      capture_timestamp  AS "captureTimestamp",

      grid_block_id      AS "gridBlockId",

      "userId"           AS "userId",
      "farmId"           AS "farmId",

      image_hash         AS "imageHash",
      upload_id          AS "uploadId",

      damage_report_id   AS "damageReportId",
      weekly_report_id   AS "weeklyReportId",
      final_report_id    AS "finalReportId",

      -- return geom as GeoJSON JSON so Prisma can deserialize it
      ST_AsGeoJSON(geom)::json AS geom,

      created_at         AS "createdAt";
  `;

  // Prepare parameters in the exact same order used above
  const params = [
    input.localUploadId, // $1
    input.cloudinaryPublicId, // $2
    input.storageUrl ?? null, // $3
    input.thumbnailUrl ?? null, // $4

    input.exif ? JSON.stringify(input.exif) : null, // $5
    input.exifLat ?? null, // $6
    input.exifLon ?? null, // $7
    input.exifTimestamp ? new Date(input.exifTimestamp) : null, // $8

    input.captureLat ?? null, // $9
    input.captureLon ?? null, // $10
    input.captureTimestamp ? new Date(input.captureTimestamp) : null, // $11

    input.gridBlockId ?? null, // $12

    input.userId ?? null, // $13
    input.farmId ?? null, // $14

    input.imageHash ?? null, // $15
    input.uploadId ?? null, // $16

    input.damageReportId ?? null, // $17
    input.weeklyReportId ?? null, // $18
    input.finalReportId ?? null, // $19

    geomLon, // $20
    geomLat, // $21
  ];

  try {
    // We interpolate a fixed SQL string (no dynamic identifiers) and pass params separately to avoid injection
    const raw = (await prisma.$queryRawUnsafe(sql, ...params)) as any[];

    if (!Array.isArray(raw) || raw.length === 0) {
      throw new APIError("Failed to insert image record (no rows returned)", 500, "CREATE_IMAGE_FAILED");
    }

    const created = raw[0];

    // ensure geom is parsed object if returned as string
    if (created && typeof created.geom === "string") {
      try {
        created.geom = JSON.parse(created.geom);
      } catch {
        // leave as-is if parsing fails
      }
    }

    return created;
  } catch (err: unknown) {
    const e = err as any;
    // Very likely reasons: column mismatch / missing column in DB / permission / constraint violation
    throw new APIError(
      `createImageRecordRaw failed: ${e?.message ?? String(e)}`,
      500,
      "CREATE_IMAGE_RAW_FAILED",
      { original: e }
    );
  }
}