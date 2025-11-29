// src/services/cloudinary.service.ts
import { v2 as cloudinary } from "cloudinary";
import { prisma } from "@lib/prisma";
import { Prisma } from "@prisma/client";

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
  throw new Error("Missing Cloudinary env vars: CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET");
}

cloudinary.config({
  cloud_name: CLOUD_NAME,
  api_key: API_KEY,
  api_secret: API_SECRET,
});

/** Sign Cloudinary upload params server-side for signed upload */
export function signUploadParams(paramsToSign: Record<string, unknown>): { signature: string; timestamp: number } {
  const timestamp = Math.floor(Date.now() / 1000);

  // Convert params to plain strings/numbers (Cloudinary expects primitives)
  const toSign: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(paramsToSign)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      toSign[k] = v as string | number;
    } else {
      // fallback to JSON string
      toSign[k] = JSON.stringify(v);
    }
  }
  toSign.timestamp = timestamp;

  // @ts-ignore cloudinary types accept a plain object here
  const signature = cloudinary.utils.api_sign_request(toSign, API_SECRET);
  return { signature, timestamp };
}

/** Fetch resource metadata from Cloudinary (admin) */
export async function fetchResourceMetadata(publicId: string) {
  if (!publicId) throw new Error("publicId is required");
  const res = await cloudinary.api.resource(publicId, { exif: true });
  return res;
}

/** Parse GPS value from common EXIF string formats. */
export function parseExifGps(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s.length === 0) return null;

  // simple decimal
  const n = Number(s);
  if (!Number.isNaN(n)) return n;

  // DMS rationals "12/1,34/1,56/1"
  if (s.includes(",")) {
    const parts = s.split(",").map((p) => p.trim());
    if (parts.length === 3) {
      const toNum = (part: string) => {
        const [numStr, denStr] = part.split("/").map((t) => t.trim());
        const num = Number(numStr);
        const den = denStr ? Number(denStr) : NaN;
        if (!Number.isFinite(num)) return NaN;
        if (Number.isFinite(den) && den !== 0) return num / den;
        return num;
      };
      const deg = toNum(parts[0] ?? "");
      const min = toNum(parts[1] ?? "");
      const sec = toNum(parts[2] ?? "");
      if ([deg, min, sec].every(Number.isFinite)) {
        return deg + min / 60 + sec / 3600;
      }
    }
  }

  // fallback: patterns like "12° 34' 56\""
  const dmsMatch = s.match(/(\d+)[^\d]+(\d+)[^\d]+([\d.]+)/);
  if (dmsMatch) {
    const deg = Number(dmsMatch[1]);
    const min = Number(dmsMatch[2]);
    const sec = Number(dmsMatch[3]);
    if ([deg, min, sec].every(Number.isFinite)) {
      return deg + min / 60 + sec / 3600;
    }
  }

  return null;
}

/** Haversine distance in meters */
export function haversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Update Upload row after upload completed (store Cloudinary meta + status + signedParams if needed)
 *
 * Note: signedParams is an input JSON type (what we write), so accept Prisma.InputJsonValue or the nullable variant.
 */
export async function updateUploadCloudMeta(localUploadId: string, data: {
  cloudinaryPublicId?: string;
  signedParams?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | null;
  uploadStatus?: "PENDING" | "COMPLETED" | "FAILED" | "PROCESSING";
}) {
  const update = await prisma.upload.update({
    where: { localUploadId },
    data: {
      cloudinaryPublicId: data.cloudinaryPublicId ?? undefined,
      // pass undefined when absent so Prisma doesn't attempt to set to null unexpectedly
      signedParams: data.signedParams ?? undefined,
      uploadStatus: data.uploadStatus ?? undefined,
    },
  });
  return update;
}

/** Set PostGIS geom for an image (lon, lat order) */
export async function setImageGeom(imageId: string, lat: number, lon: number) {
  await prisma.$executeRaw`
    UPDATE images
    SET geom = ST_SetSRID(ST_MakePoint(${lon}::double precision, ${lat}::double precision), 4326)::geography
    WHERE id = ${imageId};
  `;
}