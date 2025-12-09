// src/services/createImageRecordRaw.ts
import { prisma } from "@lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Insert an image row using raw SQL (required for PostGIS geom).
 * Use snake_case DB column names explicitly and map to camelCase on return.
 */
export async function createImageRecordRaw(input: {
  userId: string | null;
  uploadId: string | null;
  localUploadId: string;
  cloudinaryPublicId: string;
  storageUrl: string | null;
  thumbnailUrl?: string | null;

  exif?: Prisma.InputJsonValue | null;
  exifLat: number;
  exifLon: number;
  exifTimestamp: Date;

  captureLat: number | null;
  captureLon: number | null;
  captureTimestamp: Date | null;

  // These fields are present in the controller but likely removed from DB schema
  uploadLat?: number | null;
  uploadLon?: number | null;
  uploadTimestamp?: Date | null;
  providedCropId?: string | null;
  detectedCropId?: string | null;
  qualityScore?: number | null;

  farmId?: string | null;
  imageHash?: string | null;
}) {
  // ensure we have coordinates for geom
  if (input.exifLat == null || input.exifLon == null) {
    throw new Error("exifLat and exifLon are required to set geom");
  }

  // NOTE: providedCropId, detectedCropId, and qualityScore are OMITTED 
  // because they are missing from the current schema.prisma Image model.
  const sqlClean = `
    INSERT INTO images (
      "userId",              -- Quoted camelCase (unmapped in schema)
      upload_id,             -- snake_case (@map in schema)
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
      
      "farmId",              -- Quoted camelCase (unmapped in schema)
      image_hash,            -- snake_case (@map in schema)

      geom,
      created_at
    )
    VALUES (
      $1::uuid,
      $2::uuid,
      $3::uuid,
      $4::text,
      $5::text,
      $6::text,

      $7::json,
      $8::double precision,
      $9::double precision,
      $10::timestamptz,

      $11::double precision,
      $12::double precision,
      $13::timestamptz,

      $14::uuid,             -- farmId
      $15::text,             -- imageHash

      ST_SetSRID(ST_MakePoint($9::double precision, $8::double precision), 4326)::geography,
      NOW()
    )
    RETURNING
      id,
      local_upload_id        AS "localUploadId",
      cloudinary_public_id   AS "cloudinaryPublicId",
      storage_url            AS "storageUrl",
      thumbnail_url          AS "thumbnailUrl",

      exif,
      exif_lat               AS "exifLat",
      exif_lon               AS "exifLon",
      exif_timestamp         AS "exifTimestamp",

      capture_lat            AS "captureLat",
      capture_lon            AS "captureLon",
      capture_timestamp      AS "captureTimestamp",

      "farmId"               AS "farmId",
      image_hash             AS "imageHash",

      ST_AsGeoJSON(geom)::json AS geom,
      created_at             AS "createdAt";
  `;

  const paramsClean = [
    input.userId ?? null,       // $1
    input.uploadId ?? null,     // $2
    input.localUploadId,        // $3
    input.cloudinaryPublicId,   // $4
    input.storageUrl ?? null,   // $5
    input.thumbnailUrl ?? null, // $6

    input.exif ?? null,         // $7
    input.exifLat,              // $8
    input.exifLon,              // $9
    input.exifTimestamp,        // $10

    input.captureLat ?? null,       // $11
    input.captureLon ?? null,       // $12
    input.captureTimestamp ?? null, // $13

    input.farmId ?? null,           // $14
    input.imageHash ?? null,        // $15
  ];

  const raw = await prisma.$queryRawUnsafe(sqlClean, ...paramsClean);
  const rows = Array.isArray(raw) ? (raw as any[]) : [];
  const created = rows[0] ?? null;
  if (!created) throw new Error("Failed to insert image record");
  
  return created;
}