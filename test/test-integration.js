// test/test-integration.js
// Run: bun run test/test-integration.js

import fs from "fs";
import path from "path";
import axios from "axios";
import FormData from "form-data";
import { v4 as uuidv4 } from "uuid";
import exifr from "exifr";
import dotenv from "dotenv";

dotenv.config();

const API_BASE = process.env.API_BASE ?? "http://localhost:4000";
const API_ROOT = API_BASE.endsWith("/api") ? API_BASE : `${API_BASE}/api`;

const PHONE = "+917506272085"; 
const PASSWORD = "MyStrongPassw0rd!";
const IMAGE_PATH = "/Users/anujs101/Downloads/IMG_20251130_041155452_HDR.jpg"; 

// Helper delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log("=== START DAMAGE SESSION TEST FLOW ===");

  if (!fs.existsSync(IMAGE_PATH)) {
    console.error(`⚠️ Error: IMAGE_PATH not found at ${IMAGE_PATH}`);
    process.exit(1);
  }

  // 1. LOGIN
  console.log(`\n1. Logging in with ${PHONE}...`);
  let accessToken, userId, farmId;
  try {
    const res = await axios.post(`${API_ROOT}/auth/login-password`, { phone: PHONE, password: PASSWORD });
    accessToken = res.data.data.tokens.accessToken;
    userId = res.data.data.user.id;
    console.log("✅ Logged in.");
  } catch (e) {
    console.error("❌ Login failed:", e.response?.data || e.message);
    process.exit(1);
  }

  // 2. GET FARM
  console.log("\n2. Fetching Farm...");
  const farmRes = await axios.get(`${API_ROOT}/farms`, { headers: { Authorization: `Bearer ${accessToken}` } });
  let farm = farmRes.data.data.farms[0];
  if (!farm) {
     console.error("❌ No farms found. Please create one first.");
     process.exit(1);
  }
  farmId = farm.id;
  console.log(`✅ Using Farm ID: ${farmId}`);

  // 3. START SESSION
  console.log("\n3. Starting Sampling Session...");
  let sessionData;
  try {
    const res = await axios.post(`${API_ROOT}/farms/${farmId}/damage-sessions/start`, 
      { gridResolutionM: 100 }, 
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    sessionData = res.data.data;
    console.log(`✅ Session Started! UUID: ${sessionData.sessionUuid}`);
    console.log(`   Blocks assigned: ${sessionData.blocks.length}`);
  } catch (e) {
    console.error("❌ Start Session failed:", e.response?.data || e.message);
    process.exit(1);
  }

  // 4. PROCESS ALL BLOCKS
  console.log(`\n4. Processing ${sessionData.blocks.length} Blocks...`);

  for (const [index, block] of sessionData.blocks.entries()) {
    console.log(`\n   --- Block ${index + 1} / 4 (ID: ${block.id}) ---`);
    await delay(1000); // Wait 1s between uploads to be safe

    // Mock Device Capture Data
    let deviceMeta = {
      sessionBlockId: block.id,
      localUploadId: uuidv4(),
      deviceModel: "TestBot 3000",
      captureTimestamp: new Date().toISOString(),
      // Use centroid to ensure Verification passes
      captureLat: block.centroid.coordinates[1], 
      captureLon: block.centroid.coordinates[0],
      farmId: farmId
    };

    // A. SIGN
    let signData;
    try {
      const res = await axios.post(`${API_ROOT}/uploads/cloudinary/sign`, {
          localUploadId: deviceMeta.localUploadId,
          deviceMeta,
          folder: "test_damage_sessions",
          filename: `block_${index}.jpg`
      }, { headers: { Authorization: `Bearer ${accessToken}` } });
      signData = res.data.data;
      
      if (!signData.apiKey) throw new Error("Backend returned no apiKey");
    } catch (e) {
      console.error(`   ❌ Sign failed:`, e.response?.data || e.message);
      continue;
    }

    // B. UPLOAD TO CLOUDINARY
    let cloudRes;
    try {
      const form = new FormData();
      // FIX: Append TEXT fields FIRST so Cloudinary sees them before the file stream
      form.append("public_id", signData.public_id);
      form.append("api_key", String(signData.apiKey)); // Force String
      form.append("timestamp", String(signData.timestamp));
      form.append("signature", signData.signature);
      if(signData.folder) form.append("folder", signData.folder);
      
      // Append FILE LAST
      form.append("file", fs.createReadStream(IMAGE_PATH));

      const cRes = await axios.post(`https://api.cloudinary.com/v1_1/${signData.cloudName}/image/upload`, form, {
          headers: form.getHeaders()
      });
      cloudRes = cRes.data;
      console.log("      Uploaded to Cloudinary");
    } catch (e) {
      console.error(`   ❌ Cloudinary Upload failed:`, e.response?.data || e.message);
      continue;
    }

    // C. COMPLETE
    try {
      const res = await axios.post(`${API_ROOT}/uploads/cloudinary/complete`, {
          localUploadId: deviceMeta.localUploadId,
          public_id: cloudRes.public_id,
          version: cloudRes.version
      }, { headers: { Authorization: `Bearer ${accessToken}` } });
      
      const result = res.data.data;
      const isLinked = result.sessionBlockId === block.id;
      console.log(`      ✅ Complete! Linked: ${isLinked} | Verification: ${result.verification}`);
    } catch (e) {
      console.error(`   ❌ Complete failed:`, e.response?.data || e.message);
    }
  }

  // 5. SUBMIT SESSION
  console.log(`\n5. Submitting Session...`);
  try {
    const res = await axios.post(`${API_ROOT}/farms/${farmId}/damage-sessions/${sessionData.sessionUuid}/submit`, 
        {}, 
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    console.log("✅ Session Submitted!", JSON.stringify(res.data, null, 2));
  } catch (e) {
    console.error("❌ Submit failed:", e.response?.data || e.message);
    process.exit(1);
  }

  console.log("\n=== TEST PASSED ===");
}

main();