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
      const data = resp.data?.data ?? resp.data;
      const accessToken = data?.tokens?.accessToken ?? data?.tokens?.access_token ?? data?.accessToken ?? null;
      const refreshToken = data?.tokens?.refreshToken ?? data?.tokens?.refresh_token ?? null;
      const user = data?.user ?? null;
      return { accessToken, refreshToken, user, raw: resp.data };
    } else {
      throw resp.data ?? new Error(`Login failed: status ${resp.status}`);
    }
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
    if (resp.status === 200) {
      return resp.data?.data?.farms ?? resp.data?.farms ?? [];
    }
    throw resp.data ?? new Error(`GET farms failed status ${resp.status}`);
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
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      validateStatus: () => true,
    });
    console.log(`→ POST ${url} => [${resp.status}] ${pretty(resp.data)}`);
    if (resp.status === 201 || resp.status === 200) {
      return resp.data?.data?.farm ?? resp.data?.farm ?? resp.data;
    }
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
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      validateStatus: () => true,
    });
    console.log(`→ POST ${url} => [${resp.status}] ${pretty(resp.data)}`);
    if (resp.status >= 200 && resp.status < 300) return resp.data?.data ?? resp.data;
    throw resp.data ?? new Error("sign failed");
  } catch (err) {
    console.error("   [ERR] requestSign failed:", err?.response?.data ?? err?.message ?? err);
    throw err;
  }
}

async function uploadToCloudinary(cloudName, apiKey, signature, timestamp, public_id, imagePath, extraParams = {}) {
  // Cloudinary upload endpoint
  const url = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
  console.log(`→ Uploading to Cloudinary: ${url} (public_id: ${public_id})`);
  const form = new FormData();
  form.append("file", fs.createReadStream(imagePath));
  form.append("public_id", public_id);
  form.append("timestamp", String(timestamp));
  form.append("api_key", apiKey);
  form.append("signature", signature);

  // IMPORTANT: include any extra params that were part of the server-side signature
  // e.g. folder, eager, etc. The server signs the string that includes these keys.
  if (extraParams && typeof extraParams === "object") {
    for (const [k, v] of Object.entries(extraParams)) {
      if (v !== undefined && v !== null) {
        form.append(String(k), String(v));
        console.log(`   -> adding signed param to form: ${k}=${v}`);
      }
    }
  }

  try {
    const resp = await axios.post(url, form, {
      headers: {
        ...form.getHeaders(),
      },
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

async function notifyComplete(accessToken, localUploadId, public_id, version, uploadLat, uploadLon, uploadTimestamp) {
  const url = `${API_BASE}/api/uploads/cloudinary/complete`;
  const body = { localUploadId, public_id, version, uploadLat, uploadLon, uploadTimestamp };
  try {
    const resp = await axios.post(url, body, {
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
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

/**
 * small helper: build a tiny bounding box polygon around lat/lon
 */
function tinySquarePolygon(lon, lat, delta = 0.001) {
  return {
    type: "Polygon",
    coordinates: [
      [
        [Number(lon) - delta, Number(lat) - delta],
        [Number(lon) + delta, Number(lat) - delta],
        [Number(lon) + delta, Number(lat) + delta],
        [Number(lon) - delta, Number(lat) + delta],
        [Number(lon) - delta, Number(lat) - delta],
      ],
    ],
  };
}

async function main() {
  console.log("=== START test-upload-flow ===");

  // 1) read EXIF
  const exif = await readExif(IMAGE_PATH);
  if (!exif || exif.lat == null || exif.lon == null || !exif.ts) {
    console.error("Fatal error: EXIF must contain GPS coords and timestamp. Found:", pretty(exif));
    process.exit(1);
  }

  // 2) login
  let loginRes;
  try {
    loginRes = await loginByPassword(PHONE, PASSWORD);
  } catch (err) {
    console.error("Fatal error during login. Aborting.");
    process.exit(1);
  }
  const accessToken = loginRes.accessToken;
  if (!accessToken) {
    console.error("Login returned no access token. Full login response:", pretty(loginRes.raw));
    process.exit(1);
  }
  console.log("→ Access token length:", accessToken.length);

  // 3) get farms
  let farms = [];
  try {
    farms = await getFarms(accessToken);
  } catch (err) {
    console.error("Failed to fetch farms:", err);
    process.exit(1);
  }

  // 4) if none -> create a farm using small polygon around exif coords
  let farm = null;
  if (!farms || farms.length === 0) {
    console.log("→ No farms found for user — creating one.");
    const poly = tinySquarePolygon(exif.lon, exif.lat, 0.0012);
    const name = `Auto Farm (${new Date().toISOString()})`;
    const address = "Auto-created by test script";
    try {
      farm = await createFarm(accessToken, name, address, poly);
      console.log("   Created farm:", pretty(farm));
    } catch (err) {
      console.error("Failed to create farm:", err);
      process.exit(1);
    }
  } else {
    farm = farms[0];
    console.log("→ Using existing farm:", pretty(farm));
  }

  const farmId = farm?.id;
  if (!farmId) {
    console.error("No farmId available after create/fetch — cannot continue (farmId is required).");
    process.exit(1);
  }

  // 5) request presign
  const localUploadId = uuidv4();
  const deviceMeta = {
    captureLat: Number(exif.lat),
    captureLon: Number(exif.lon),
    captureTimestamp: exif.ts,
    deviceModel: DEVICE_MODEL,
    os: DEVICE_OS,
    farmId,
  };

  // choose folder name the server will sign; keep same when uploading
  const folderName = "uploads";

  let signData;
  try {
    signData = await requestSign(accessToken, localUploadId, deviceMeta, folderName, path.basename(IMAGE_PATH));
  } catch (err) {
    console.error("Presign failed. Aborting.");
    process.exit(1);
  }

  // signData should include signature, timestamp, apiKey, cloudName, public_id (and maybe folder)
  const signature = signData?.signature;
  const timestamp = signData?.timestamp;
  const apiKey = signData?.apiKey;
  const cloudName = signData?.cloudName;
  const public_id = signData?.public_id;
  // the backend might return the folder it used — if so prefer that
  const signedFolder = signData?.folder ?? folderName;

  if (!signature || !timestamp || !apiKey || !cloudName || !public_id) {
    console.error("Presign response missing fields:", pretty(signData));
    process.exit(1);
  }

  // 6) upload to Cloudinary — include the folder param because server signed it
  let cloudResp;
  try {
    // pass extraParams so form contains folder (and any other signed params)
    cloudResp = await uploadToCloudinary(cloudName, apiKey, signature, timestamp, public_id, IMAGE_PATH, { folder: signedFolder });
  } catch (err) {
    console.error("Cloud upload failed. Aborting.");
    process.exit(1);
  }

  const returnedPublicId = cloudResp.public_id ?? cloudResp.publicId ?? public_id;
  const returnedVersion = cloudResp.version ?? cloudResp.version_id ?? cloudResp.version_id;

  if (!returnedVersion) {
    console.warn("Cloudinary did not return version field. Using '1' as fallback.");
  }

  // 7) notify complete
  let completeData;
  try {
    completeData = await notifyComplete(
      accessToken,
      localUploadId,
      returnedPublicId,
      returnedVersion ?? 1,
      null,
      null,
      null
    );
  } catch (err) {
    console.error("Complete endpoint failed. Aborting.");
    process.exit(1);
  }

  // 8) final result
  console.log("=== UPLOAD FLOW RESULT ===");
  console.log("Verification response from backend:", pretty(completeData));
  const verification = completeData?.verification ?? completeData?.status ?? null;
  const farmValidation = completeData?.farmValidation ?? null;
  console.log("verification:", verification);
  console.log("farmValidation:", pretty(farmValidation));
  console.log("=== DONE ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("Unhandled error in main:", err);
  process.exit(1);
});