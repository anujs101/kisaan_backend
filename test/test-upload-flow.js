// test-upload-flow.js
// Run: bun run test-upload-flow.js
import fs from "fs";
import path from "path";
import axios from "axios";
import FormData from "form-data";
import { v4 as uuidv4 } from "uuid";
import exifr from "exifr";
import dotenv from "dotenv";

dotenv.config();

const API_BASE = process.env.API_BASE || "http://localhost:4000";
const PHONE = process.env.PHONE;
const PASSWORD = process.env.PASSWORD;
const IMAGE_PATH = process.env.IMAGE_PATH;

const DEVICE_MODEL = process.env.DEVICE_MODEL ?? "Pixel-Emu";
const DEVICE_OS = process.env.DEVICE_OS ?? "Android-Unknown";

if (!PHONE || !PASSWORD || !IMAGE_PATH) {
  console.error("Missing required env vars. Make sure API_BASE, PHONE, PASSWORD, and IMAGE_PATH are set.");
  process.exit(1);
}

function pretty(o) {
  try {
    return JSON.stringify(o, null, 2);
  } catch (e) {
    return String(o);
  }
}

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

async function loginByPassword(phone, password) {
  console.log(`→ Logging in with phone: ${phone}`);
  const url = `${API_BASE}/api/auth/login-password`;
  try {
    const resp = await axios.post(url, { phone, password }, { validateStatus: () => true });
    console.log(`   [${resp.status}] ${url} -> ${pretty(resp.data)}`);

    if (resp.status >= 200 && resp.status < 300) {
      const data = resp.data.data ?? resp.data;
      return {
        accessToken:
          data?.tokens?.accessToken ??
          data?.tokens?.access_token ??
          data?.accessToken ??
          null,
        refreshToken:
          data?.tokens?.refreshToken ??
          data?.tokens?.refresh_token ??
          null,
        user: data?.user ?? null,
        raw: resp.data,
      };
    }

    throw resp.data ?? new Error("Login failed");
  } catch (err) {
    console.error("   [ERR] login failed:", err?.response?.data ?? err?.message ?? err);
    throw err;
  }
}

async function getFarms(accessToken) {
  const url = `${API_BASE}/api/farms?page=1&perPage=50`;
  try {
    const resp = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      validateStatus: () => true,
    });

    console.log(`→ GET ${url} => [${resp.status}] ${pretty(resp.data)}`);

    if (resp.status === 200) return resp.data?.data?.farms ?? [];
    throw resp.data ?? new Error("GET farms failed");
  } catch (err) {
    console.error("   [ERR] getFarms failed:", err?.response?.data ?? err?.message ?? err);
    throw err;
  }
}

async function createFarm(accessToken, name, address, boundaryGeoJson) {
  const url = `${API_BASE}/api/farms`;
  const body = { name, address, boundary: boundaryGeoJson };

  try {
    const resp = await axios.post(url, body, {
      headers: { Authorization: `Bearer ${accessToken}` },
      validateStatus: () => true,
    });

    console.log(`→ POST ${url} => [${resp.status}] ${pretty(resp.data)}`);

    if (resp.status === 200 || resp.status === 201)
      return resp.data?.data?.farm ?? null;

    throw resp.data ?? new Error("createFarm failed");
  } catch (err) {
    console.error("   [ERR] createFarm failed:", err?.response?.data ?? err?.message ?? err);
    throw err;
  }
}

async function requestSign(accessToken, localUploadId, deviceMeta, folder, filename) {
  const url = `${API_BASE}/api/uploads/cloudinary/sign`;
  const body = { localUploadId, deviceMeta, folder, filename };

  try {
    const resp = await axios.post(url, body, {
      headers: { Authorization: `Bearer ${accessToken}` },
      validateStatus: () => true,
    });

    console.log(`→ POST ${url} => [${resp.status}] ${pretty(resp.data)}`);

    if (resp.status >= 200 && resp.status < 300)
      return resp.data?.data ?? resp.data;

    throw resp.data ?? new Error("sign failed");
  } catch (err) {
    console.error("   [ERR] requestSign failed:", err?.response?.data ?? err?.message ?? err);
    throw err;
  }
}

async function uploadToCloudinary(cloudName, apiKey, signature, timestamp, public_id, imagePath, extraParams = {}) {
  const url = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
  console.log(`→ Uploading to Cloudinary: ${url} (public_id: ${public_id})`);

  const form = new FormData();
  form.append("file", fs.createReadStream(imagePath));
  form.append("public_id", public_id);
  form.append("timestamp", String(timestamp));
  form.append("api_key", apiKey);
  form.append("signature", signature);

  for (const [k, v] of Object.entries(extraParams)) {
    if (v !== undefined && v !== null) {
      form.append(k, String(v));
      console.log(`   -> adding signed param: ${k}=${v}`);
    }
  }

  try {
    const resp = await axios.post(url, form, {
      headers: form.getHeaders(),
      maxBodyLength: 50 * 1024 * 1024,
      validateStatus: () => true,
    });

    console.log(`   Cloudinary response [${resp.status}]: ${pretty(resp.data)}`);

    if (resp.status >= 200 && resp.status < 300) return resp.data;
    throw resp.data ?? new Error("Cloudinary upload failed");
  } catch (err) {
    console.error("   [ERR] Cloudinary upload failed:", err?.response?.data ?? err?.message ?? err);
    throw err;
  }
}

async function notifyComplete(accessToken, localUploadId, public_id, version) {
  const url = `${API_BASE}/api/uploads/cloudinary/complete`;
  const body = { localUploadId, public_id, version };

  try {
    const resp = await axios.post(url, body, {
      headers: { Authorization: `Bearer ${accessToken}` },
      validateStatus: () => true,
    });

    console.log(`→ POST ${url} => [${resp.status}] ${pretty(resp.data)}`);

    if (resp.status >= 200 && resp.status < 300) return resp.data?.data ?? resp.data;
    throw resp.data ?? new Error("complete failed");
  } catch (err) {
    console.error("   [ERR] notifyComplete failed:", err?.response?.data ?? err?.message ?? err);
    throw err;
  }
}

function tinySquarePolygon(lon, lat, delta = 0.001) {
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

async function main() {
  console.log("=== START test-upload-flow ===");

  const exif = await readExif(IMAGE_PATH);
  if (!exif?.lat || !exif.lon || !exif.ts) {
    console.error("EXIF missing GPS or timestamp:", pretty(exif));
    process.exit(1);
  }

  // Login
  const loginRes = await loginByPassword(PHONE, PASSWORD);
  const accessToken = loginRes.accessToken;

  console.log("→ Access token OK, length:", accessToken.length);

  // Get farms
  let farms = await getFarms(accessToken);
  let farm = farms[0];

  if (!farm) {
    console.log("→ No farms found — creating one automatically");
    const poly = tinySquarePolygon(exif.lon, exif.lat, 0.0012);

    farm = await createFarm(
      accessToken,
      `Auto Farm (${new Date().toISOString()})`,
      "Auto-created by test script",
      poly
    );
  }

  const farmId = farm?.id;
  if (!farmId) {
    console.error("FarmId missing — cannot continue.");
    process.exit(1);
  }

  // Request sign
  const localUploadId = uuidv4();
  const deviceMeta = {
    captureLat: exif.lat,
    captureLon: exif.lon,
    captureTimestamp: exif.ts,
    deviceModel: DEVICE_MODEL,
    os: DEVICE_OS,
    farmId,
  };

  const folderName = "uploads";

  const signData = await requestSign(
    accessToken,
    localUploadId,
    deviceMeta,
    folderName,
    path.basename(IMAGE_PATH)
  );

  const signature = signData.signature;
  const timestamp = signData.timestamp;
  const apiKey = signData.apiKey;
  const cloudName = signData.cloudName;
  const public_id = signData.public_id;
  const signedFolder = signData.folder ?? folderName;

  // Upload to Cloudinary
  const cloudResp = await uploadToCloudinary(
    cloudName,
    apiKey,
    signature,
    timestamp,
    public_id,
    IMAGE_PATH,
    { folder: signedFolder }
  );

  const returnedPublicId = cloudResp.public_id ?? public_id;
  const returnedVersion = cloudResp.version ?? 1;

  // Notify complete
  const completeData = await notifyComplete(
    accessToken,
    localUploadId,
    returnedPublicId,
    returnedVersion
  );

  console.log("=== UPLOAD FLOW RESULT ===");
  console.log("Backend response:", pretty(completeData));

  console.log("→ verification:", completeData?.verification);
  console.log("→ providedCropId:", completeData?.providedCropId ?? "(server should include this)");
  console.log("→ detectedCropId:", completeData?.detectedCropId ?? "(ML may fill later)");

  console.log("=== DONE ===");
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
