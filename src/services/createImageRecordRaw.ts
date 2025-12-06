// src/services/createImageRecordRaw.ts
import { prisma } from "@lib/prisma";
import type { Prisma } from "@prisma/client";

interface CreateImageRecordInput {
  userId: string | null;
  uploadId: string;
  localUploadId: string;
  cloudinaryPublicId: string;
  storageUrl: string;
  thumbnailUrl: string | null;
  exif: Prisma.InputJsonValue;
  exifLat: number;
  exifLon: number;
  exifTimestamp: Date;
  captureLat: number;
  captureLon: number;
  captureTimestamp: Date;
  uploadLat: number | null;
  uploadLon: number | null;
  uploadTimestamp: Date | null;
  farmId: string | null;
  providedCropId: string | null; // NEW
}

export async function createImageRecordRaw(data: CreateImageRecordInput) {
  const sql = `
    INSERT INTO images (
      "userId", "uploadId", "local_upload_id",
      cloudinary_public_id, storage_url, thumbnail_url,
      exif, exif_lat, exif_lon, exif_timestamp,
      capture_lat, capture_lon, capture_timestamp,
      upload_lat, upload_lon, upload_timestamp,
      "farmId", provided_crop_id
    )
    VALUES (
      $1::uuid, $2::uuid, $3::uuid,
      $4::text, $5::text, $6::text,
      $7::jsonb, $8::float, $9::float, $10::timestamptz,
      $11::float, $12::float, $13::timestamptz,
      $14::float, $15::float, $16::timestamptz,
      $17::uuid, $18::uuid
    )
    RETURNING id;
  `;

  const row = await prisma.$queryRawUnsafe(sql,
    data.userId,
    data.uploadId,
    data.localUploadId,
    data.cloudinaryPublicId,
    data.storageUrl,
    data.thumbnailUrl,
    data.exif,
    data.exifLat,
    data.exifLon,
    data.exifTimestamp,
    data.captureLat,
    data.captureLon,
    data.captureTimestamp,
    data.uploadLat,
    data.uploadLon,
    data.uploadTimestamp,
    data.farmId,
    data.providedCropId
  );

  return Array.isArray(row) ? row[0] : row;
}
