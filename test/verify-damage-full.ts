import { prisma } from "../src/lib/prisma";
import jwt from "jsonwebtoken";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

// CONFIG
const API_URL = "http://localhost:4000/api";
const JWT_SECRET = process.env.JWT_ACCESS_SECRET;

if (!JWT_SECRET) {
  console.error("❌ Error: JWT_ACCESS_SECRET not found in .env");
  process.exit(1);
}

async function main() {
  try {
    console.log("🚀 Starting Full Damage Module Verification...");

    // =================================================================
    // 1. AUTHENTICATION (Bypass OTP)
    // =================================================================
    const user = await prisma.user.upsert({
      where: { phone: "+15550000000" },
      update: {},
      create: {
        phone: "+15550000000",
        role: "user",
        phoneVerified: true,
      },
    });

    // Generate valid JWT with 'sub' (Subject)
    const token = jwt.sign(
      { sub: user.id, role: user.role }, 
      JWT_SECRET!, 
      { expiresIn: "1h" }
    );
    const authHeader = { Authorization: `Bearer ${token}` };
    console.log("✅ Authenticated as Test User");

    // =================================================================
    // 2. CREATE PREREQUISITE DATA (CROP)
    // =================================================================
    const crop = await prisma.crop.upsert({
      where: { code: "TEST_WHEAT" },
      update: {},
      create: {
        name: "Wheat",
        code: "TEST_WHEAT",
        seasons: ["Rabi"]
      }
    });
    console.log(`🌾 Using Crop: ${crop.name} (ID: ${crop.id})`);

    // =================================================================
    // 3. CREATE FARM (With Agro-compatible Coordinates)
    // =================================================================
    // Using a real farm area in California to ensure Satellite data exists
    const farmPayload = {
      name: "Verification Farm (Calif)",
      cropId: crop.id, // <--- REQUIRED: Links farm to the crop we just made
      boundary: {
        type: "Polygon",
        coordinates: [[
          [-121.1958, 37.6683],
          [-121.1779, 37.6687],
          [-121.1773, 37.6792],
          [-121.1958, 37.6792],
          [-121.1958, 37.6683]
        ]]
      }
    };

    console.log("🚜 Creating Farm...");
    const farmRes = await axios.post(`${API_URL}/farms`, farmPayload, { headers: authHeader });
    const farmId = farmRes.data.data.farm.id;
    console.log(`   -> Farm ID: ${farmId}`);

    // =================================================================
    // 4. SUBMIT DAMAGE REPORT
    // =================================================================
    console.log("📸 Submitting Damage Report...");
    const reportPayload = {
      farmId: farmId,
      damageType: "Drought",
      cropType: "Wheat",
      photos: ["https://placehold.co/600x400.jpg"] // Dummy photo URL
    };

    const reportRes = await axios.post(`${API_URL}/damage-report`, reportPayload, { headers: authHeader });
    const reportId = reportRes.data.data.reportId;
    console.log(`   -> Report Submitted! ID: ${reportId}`);

    // =================================================================
    // 5. POLL FOR RESULTS
    // =================================================================
    console.log("⏳ Waiting for Analysis Pipeline (Satellite + Weather + ML)...");
    
    let attempts = 0;
    const maxAttempts = 15;

    while (attempts < maxAttempts) {
      const checkRes = await axios.get(`${API_URL}/damage-report/${reportId}`, { headers: authHeader });
      const data = checkRes.data;

      if (data.status === "completed") {
        console.log("\n✅ ANALYSIS COMPLETE!");
        console.log("================================================");
        console.log(`Severity Score: ${data.severity?.score} (${data.severity?.label})`);
        
        console.log(`\n🛰️  Satellite Data:`);
        console.log(`   - NDVI Before: ${data.satellite?.ndvi_before}`);
        console.log(`   - NDVI After:  ${data.satellite?.ndvi_after}`);
        console.log(`   - Drop:        ${data.satellite?.ndvi_drop_percent}%`);

        console.log(`\n🌦️  Weather Data:`);
        console.log(`   - Temp: ${data.weather?.temperature}°C`);
        console.log(`   - Rain: ${data.weather?.rainfall} mm`);
        console.log(`   - Wind: ${data.weather?.wind_speed} m/s`);

        console.log(`\n🤖 AI Findings:`);
        if (Array.isArray(data.aiFindings)) {
          data.aiFindings.forEach((f: string) => console.log(`   - ${f}`));
        } else {
          console.log("   (No findings generated)");
        }
        console.log("================================================");
        return;
      }

      if (data.status === "failed") {
        console.error("❌ Pipeline Failed. Check server logs for details.");
        console.error("Response:", JSON.stringify(data, null, 2));
        return;
      }

      // Wait 2 seconds before checking again
      await new Promise(r => setTimeout(r, 2000));
      process.stdout.write("."); 
      attempts++;
    }

    console.log("\n⚠️ Timeout: Analysis took too long or stayed in 'processing'.");

  } catch (error: any) {
    console.error("\n❌ Test Failed:", error.response?.data || error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();