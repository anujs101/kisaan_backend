// src/services/createImageRecordRaw.ts
import { prisma } from "@lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Insert an image row using raw SQL (required for PostGIS geom).
 * Uses the exact column names (mix of camelCase and snake_case) that match your Prisma schema.
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

  uploadLat?: number | null;
  uploadLon?: number | null;
  uploadTimestamp?: Date | null;

  farmId?: string | null;
  providedCropId?: string | null;
  detectedCropId?: string | null;

  qualityScore?: number | null;
  imageHash?: string | null;
}) {
  // ensure we have coordinates for geom
  if (input.exifLat == null || input.exifLon == null) {
    throw new Error("exifLat and exifLon are required to set geom");
  }

  const sql = `
    INSERT INTO images (
      "userId",
      "uploadId",
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

      upload_lat,
      upload_lon,
      upload_timestamp,

      "farmId",
      provided_crop_id,
      detected_crop_id,

      quality_score,
      image_hash,

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

      $14::double precision,
      $15::double precision,
      $16::timestamptz,

      $17::uuid,
      $18::uuid,
      $19::uuid,

      $20::double precision,
      $21::text,

      ST_SetSRID(ST_MakePoint($9::double precision, $8::double precision), 4326)::geography,
      NOW()
    )
    RETURNING
      id,
      "userId" AS "userId",
      "uploadId" AS "uploadId",
      local_upload_id AS "localUploadId",
      cloudinary_public_id AS "cloudinaryPublicId",
      storage_url AS "storageUrl",
      thumbnail_url AS "thumbnailUrl",

      exif,
      exif_lat AS "exifLat",
      exif_lon AS "exifLon",
      exif_timestamp AS "exifTimestamp",

      capture_lat AS "captureLat",
      capture_lon AS "captureLon",
      capture_timestamp AS "captureTimestamp",

      upload_lat AS "uploadLat",
      upload_lon AS "uploadLon",
      upload_timestamp AS "uploadTimestamp",

      "farmId" AS "farmId",
      provided_crop_id AS "providedCropId",
      detected_crop_id AS "detectedCropId",

      quality_score AS "qualityScore",
      image_hash AS "imageHash",

      ST_AsGeoJSON(geom)::json AS geom,
      verification_status AS "verificationStatus",
      verification_reason AS "verificationReason",
      verification_distance_m AS "verificationDistanceM",
      created_at AS "createdAt";
  `;

  const params = [
    input.userId, // $1
    input.uploadId, // $2
    input.localUploadId, // $3
    input.cloudinaryPublicId, // $4
    input.storageUrl, // $5
    input.thumbnailUrl ?? null, // $6

    input.exif ?? null, // $7
    input.exifLat, // $8
    input.exifLon, // $9
    input.exifTimestamp, // $10

    input.captureLat ?? null, // $11
    input.captureLon ?? null, // $12
    input.captureTimestamp ?? null, // $13

    input.uploadLat ?? null, // $14
    input.uploadLon ?? null, // $15
    input.uploadTimestamp ?? null, // $16

    input.farmId ?? null, // $17
    input.providedCropId ?? null, // $18
    input.detectedCropId ?? null, // $19

    input.qualityScore ?? null, // $20
    input.imageHash ?? null, // $21
  ];

  const raw = await prisma.$queryRawUnsafe(sql, ...params);
  const rows = Array.isArray(raw) ? (raw as any[]) : [];
  const created = rows[0] ?? null;
  if (!created) throw new Error("Failed to insert image record");
  return created;
}