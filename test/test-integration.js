// test-integration.js
// Run: bun run test-integration.js

import fs from "fs";
import path from "path";
import axios from "axios";
import FormData from "form-data";
import { v4 as uuidv4 } from "uuid";
import exifr from "exifr";
import dotenv from "dotenv";

dotenv.config();

// -----------------------------
// CONFIG / ENV
// -----------------------------
const API_BASE = process.env.API_BASE ?? "http://localhost:4000";
const API_ROOT = API_BASE.endsWith("/api") ? API_BASE : `${API_BASE}/api`;

const PHONE = process.env.PHONE ?? "+919301783525";
const PASSWORD = process.env.PASSWORD ?? "MyStrongPassw0rd!"; // using the same password as first file (hard-coded default)
const IMAGE_PATH =
  process.env.IMAGE_PATH ??
  "/Users/anujs101/Downloads/IMG_20251130_041155452_HDR.jpg";

const DEVICE_MODEL = process.env.DEVICE_MODEL ?? "Pixel-Emu";
const DEVICE_OS = process.env.DEVICE_OS ?? "Android-Unknown";

// Polling settings (for damage report)
const POLL_MAX_ATTEMPTS = 15;
const POLL_DELAY_MS = 2000;

// Helper pretty printer
function pretty(o) {
  try {
    return JSON.stringify(o, null, 2);
  } catch {
    return String(o);
  }
}

// -----------------------------
// EXIF
// -----------------------------
async function readExif(imagePath) {
  console.log(`→ Reading EXIF from image: ${imagePath}`);
  const buffer = fs.readFileSync(imagePath);

  const gps = await exifr.gps(buffer).catch((e) => {
    console.warn("   [WARN] exifr.gps failed:", e?.message ?? e);
    return null;
  });

  const all = await exifr.parse(buffer).catch((e) => {
    console.warn("   [WARN] exifr.parse failed:", e?.message ?? e);
    return null;
  });

  const lat = gps?.latitude ?? null;
  const lon = gps?.longitude ?? null;

  let ts = null;
  if (all?.DateTimeOriginal instanceof Date) ts = all.DateTimeOriginal.toISOString();
  else if (all?.CreateDate instanceof Date) ts = all.CreateDate.toISOString();
  else if (all?.ModifyDate instanceof Date) ts = all.ModifyDate.toISOString();

  console.log(`   exifLat: ${lat} exifLon: ${lon} exifTsIso: ${ts}`);
  return { lat, lon, ts, raw: all };
}

// -----------------------------
// AUTH (login by password)
// -----------------------------
async function loginByPassword(phone, password) {
  const url = `${API_ROOT}/auth/login-password`;
  console.log(`→ Logging in with phone: ${phone}`);

  const resp = await axios
    .post(url, { phone, password }, { validateStatus: () => true })
    .catch((err) => {
      console.error("   [ERR] login failed:", err?.response?.data ?? err);
      throw err;
    });

  console.log(`   [${resp.status}] ${url} -> ${pretty(resp.data)}`);

  if (resp.status >= 200 && resp.status < 300) {
    const data = resp.data.data ?? resp.data;
    return {
      accessToken:
        data?.tokens?.accessToken ??
        data?.tokens?.access_token ??
        data?.accessToken ??
        null,
      user: data?.user ?? null,
    };
  }

  throw new Error("Login failed");
}

// -----------------------------
// CROPS (via API)
// -----------------------------
async function getCrops(accessToken) {
  const url = `${API_ROOT}/crops?page=1&perPage=50`;

  const resp = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    validateStatus: () => true,
  });

  console.log(`→ GET ${url} => [${resp.status}] ${pretty(resp.data)}`);

  if (resp.status >= 200 && resp.status < 300) {
    const data = resp.data?.data ?? resp.data;
    return data?.crops ?? [];
  }

  return [];
}

async function createCrop(accessToken) {
  const url = `${API_ROOT}/crops`;

  const body = {
    name: "Wheat",
    code: "WHEAT",
    seasons: [],
    active: true,
  };

  console.log("→ Creating default crop:", pretty(body));

  const resp = await axios.post(url, body, {
    headers: { Authorization: `Bearer ${accessToken}` },
    validateStatus: () => true,
  });

  console.log(`→ POST ${url} => [${resp.status}] ${pretty(resp.data)}`);

  if (resp.status === 201 || resp.status === 200) {
    return resp.data?.data?.crop;
  }

  throw new Error("Failed to auto-create crop");
}

// -----------------------------
// FARMS (via API)
// -----------------------------
async function getFarms(accessToken) {
  const url = `${API_ROOT}/farms?page=1&perPage=50`;

  const resp = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    validateStatus: () => true,
  });

  console.log(`→ GET ${url} => [${resp.status}] ${pretty(resp.data)}`);

  if (resp.status === 200) return resp.data?.data?.farms ?? [];
  return [];
}

async function createFarm(accessToken, name, address, boundaryGeoJson, cropId) {
  const url = `${API_ROOT}/farms`;
  const body = { name, address, boundary: boundaryGeoJson, cropId };

  const resp = await axios.post(url, body, {
    headers: { Authorization: `Bearer ${accessToken}` },
    validateStatus: () => true,
  });

  console.log(`→ POST ${url} => [${resp.status}] ${pretty(resp.data)}`);

  if (resp.status === 201 || resp.status === 200) return resp.data?.data?.farm ?? null;

  throw new Error("createFarm failed");
}

// -----------------------------
// UPLOAD + VERIFY FLOW (Cloudinary signing via backend)
// -----------------------------
async function requestSign(accessToken, localUploadId, deviceMeta, folder, filename) {
  const url = `${API_ROOT}/uploads/cloudinary/sign`;
  const body = { localUploadId, deviceMeta, folder, filename };

  const resp = await axios.post(url, body, {
    headers: { Authorization: `Bearer ${accessToken}` },
    validateStatus: () => true,
  });

  console.log(`→ POST ${url} => [${resp.status}] ${pretty(resp.data)}`);

  if (resp.status >= 200 && resp.status < 300) return resp.data?.data;
  throw new Error("requestSign failed");
}

async function uploadToCloudinary(cloudName, apiKey, signature, timestamp, public_id, imagePath, extraParams = {}) {
  const url = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
  console.log(`→ Uploading to Cloudinary: ${url}`);

  const form = new FormData();
  form.append("file", fs.createReadStream(imagePath));
  form.append("public_id", public_id);
  form.append("timestamp", String(timestamp));
  form.append("api_key", apiKey);
  form.append("signature", signature);

  for (const [k, v] of Object.entries(extraParams)) {
    if (v !== undefined && v !== null) form.append(k, String(v));
  }

  const resp = await axios.post(url, form, {
    headers: form.getHeaders(),
    maxBodyLength: 50 * 1024 * 1024,
    validateStatus: () => true,
  });

  console.log(`   Cloudinary resp [${resp.status}]: ${pretty(resp.data)}`);

  if (resp.status >= 200 && resp.status < 300) return resp.data;
  throw new Error("Cloudinary upload failed");
}

async function notifyComplete(accessToken, localUploadId, public_id, version) {
  const url = `${API_ROOT}/uploads/cloudinary/complete`;
  const body = { localUploadId, public_id, version };

  const resp = await axios.post(url, body, {
    headers: { Authorization: `Bearer ${accessToken}` },
    validateStatus: () => true,
  });

  console.log(`→ POST ${url} => [${resp.status}] ${pretty(resp.data)}`);

  if (resp.status >= 200 && resp.status < 300) return resp.data?.data;
  throw new Error("notifyComplete failed");
}

// -----------------------------
// DAMAGE REPORT
// -----------------------------
async function submitDamageReport(accessToken, payload) {
  const url = `${API_ROOT}/damage-report`;
  const resp = await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${accessToken}` },
    validateStatus: () => true,
  });
  console.log(`→ POST ${url} => [${resp.status}] ${pretty(resp.data)}`);

  if (resp.status >= 200 && resp.status < 300) return resp.data?.data;
  throw new Error("submitDamageReport failed");
}

async function getDamageReport(accessToken, reportId) {
  const url = `${API_ROOT}/damage-report/${reportId}`;
  const resp = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    validateStatus: () => true,
  });

  // Log full response for debugging when non-2xx:
  if (!(resp.status >= 200 && resp.status < 300)) {
    console.error(`→ GET ${url} => [${resp.status}] ${pretty(resp.data)}`);
    // Return the body instead of throwing so the caller can inspect it:
    return resp.data ?? { status: "error", httpStatus: resp.status };
  }

  return resp.data ?? null;
}

// -----------------------------
// POLYGON helper
// -----------------------------
function tinySquarePolygon(lon, lat, delta = 0.0012) {
  return {
    type: "Polygon",
    coordinates: [
      [
        [lon - delta, lat - delta],
        [lon + delta, lat - delta],
        [lon + delta, lat + delta],
        [lon - delta, lat + delta],
        [lon - delta, lat - delta],
      ],
    ],
  };
}

// -----------------------------
// MAIN
// -----------------------------
async function main() {
  console.log("=== START test-integration ===");

  // 1) Read EXIF
  const exif = await readExif(IMAGE_PATH);
  if (!exif?.lat || !exif.lon || !exif.ts) {
    console.error("Image missing EXIF GPS/timestamp");
    process.exit(1);
  }

  // 2) Login with password (hard-coded default as requested)
  const login = await loginByPassword(PHONE, PASSWORD);
  const accessToken = login.accessToken;
  if (!accessToken) {
    console.error("No access token returned - aborting");
    process.exit(1);
  }
  console.log("→ Logged in, token length:", accessToken.length);

  // 3) Ensure crop exists (keep API-based flow)
  let crops = await getCrops(accessToken);
  let cropId;
  if (crops.length === 0) {
    console.log("→ No crops found, creating Wheat...");
    const crop = await createCrop(accessToken);
    cropId = crop.id;
  } else {
    cropId = crops[0].id;
  }
  console.log("→ Using cropId:", cropId);

  // 4) Ensure farm exists
  let farms = await getFarms(accessToken);
  let farm = farms[0];

  if (!farm) {
    console.log("→ No farms found, creating one...");
    const poly = tinySquarePolygon(exif.lon, exif.lat);

    farm = await createFarm(
      accessToken,
      `Auto Farm (${new Date().toISOString()})`,
      "Created by test script",
      poly,
      cropId
    );
  }

  const farmId = farm.id;
  console.log("→ Using farmId:", farmId);

  // 5) Upload flow (Cloudinary -> notify backend)
  const localUploadId = uuidv4();
  const deviceMeta = {
    captureLat: exif.lat,
    captureLon: exif.lon,
    captureTimestamp: exif.ts,
    deviceModel: DEVICE_MODEL,
    os: DEVICE_OS,
    farmId,
  };

  const sign = await requestSign(
    accessToken,
    localUploadId,
    deviceMeta,
    "uploads",
    path.basename(IMAGE_PATH)
  );

  if (!sign) {
    console.error("Signing response invalid or empty");
    process.exit(1);
  }

  const cloudResp = await uploadToCloudinary(
    sign.cloudName,
    sign.apiKey,
    sign.signature,
    sign.timestamp,
    sign.public_id,
    IMAGE_PATH,
    { folder: sign.folder }
  );

  const complete = await notifyComplete(
    accessToken,
    localUploadId,
    cloudResp.public_id,
    cloudResp.version
  );

  console.log("=== UPLOAD FLOW RESULT ===");
  console.log(pretty(complete));

  // 6) Submit damage report using the uploaded image (use image URL returned by backend or placeholder)
  // Try to get stored image URL from notifyComplete response (`complete` variable)
  // Backend may return an image object or URLs in `complete`. We'll try a few candidates.
  let photoUrl = null;
  if (complete?.image?.storageUrl) photoUrl = complete.image.storageUrl;
  else if (complete?.image?.storage_url) photoUrl = complete.image.storage_url;
  else if (complete?.public_id) {
    // Cloudinary URL fallback (unsigned pattern won't always be valid). Try building a URL:
    // https://res.cloudinary.com/<cloudName>/image/upload/v<version>/<public_id>.jpg
    // But prefer backend-provided storage URL.
    const version = cloudResp.version ?? "v1";
    photoUrl = `https://res.cloudinary.com/${sign.cloudName}/image/upload/v${version}/${cloudResp.public_id}`;
  } else {
    // As a last fallback, use Cloudinary response `secure_url`
    photoUrl = cloudResp.secure_url ?? cloudResp.url ?? null;
  }

  if (!photoUrl) {
    console.warn("No photo URL determined from responses; using placeholder image URL");
    photoUrl = "https://placehold.co/600x400.jpg";
  }

  console.log("→ Using photo URL for damage report:", photoUrl);

  const reportPayload = {
    farmId: farmId,
    damageType: "Drought",
    cropType: "Wheat",
    photos: [photoUrl],
  };

  const submitRes = await submitDamageReport(accessToken, reportPayload);
  const reportId = submitRes?.reportId ?? submitRes?.id ?? null;

  if (!reportId) {
    console.error("Damage report submission did not return an ID. Response:", pretty(submitRes));
    process.exit(1);
  }

  console.log(`   -> Report Submitted! ID: ${reportId}`);

  // 7) Poll for results
  console.log("⏳ Waiting for Analysis Pipeline (Satellite + Weather + ML)...");

  let attempts = 0;
  while (attempts < POLL_MAX_ATTEMPTS) {
    const checkRes = await getDamageReport(accessToken, reportId);
    const status = checkRes?.status ?? checkRes?.data?.status ?? null;

    if (status === "completed" || status === "done") {
      console.log("\n✅ ANALYSIS COMPLETE!");
      // normalize payload
      const data = checkRes?.data ?? checkRes;
      console.log("================================================");
      console.log("Result payload:", pretty(data));
      console.log("================================================");
      process.exit(0);
    }

    if (status === "failed") {
      console.error("❌ Pipeline Failed. Response:", pretty(checkRes));
      process.exit(1);
    }

    // not done yet
    await new Promise((r) => setTimeout(r, POLL_DELAY_MS));
    process.stdout.write(".");
    attempts++;
  }

  console.log("\n⚠️ Timeout: Analysis took too long or stayed in 'processing'.");
  process.exit(1);
}

main().catch((err) => {
  console.error("Unhandled error:", err?.response?.data ?? err?.message ?? err);
  process.exit(1);
});