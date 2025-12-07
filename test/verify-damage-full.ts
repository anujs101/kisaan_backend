import { prisma } from "../src/lib/prisma";
import axios from "axios";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";

dotenv.config();

// CONFIG (reuse same env creds as test-upload-flow)
const API_BASE = process.env.API_BASE ?? "http://localhost:4000";
const API_URL = `${API_BASE}/api`;
const PHONE = process.env.PHONE ?? "+919301783525";
const PASSWORD = process.env.PASSWORD ?? "MyStrongPassw0rd!";

function pretty(o:any) {
  try {
    return JSON.stringify(o, null, 2);
  } catch {
    return String(o);
  }
}

async function loginByPassword(phone:any, password:any) {
  const url = `${API_BASE}/api/auth/login-password`;
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

async function main() {
  try {
    console.log("🚀 Starting Full Damage Module Verification...");

    // -------------------------------------------------
    // Ensure test user exists and has the same password
    // -------------------------------------------------
    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    const user = await prisma.user.upsert({
      where: { phone: PHONE },
      update: {
        // ensure phoneVerified true for test flows
        phoneVerified: true,
        passwordHash,
      },
      create: {
        phone: PHONE,
        role: "user",
        phoneVerified: true,
        passwordHash,
      },
    });

    console.log(`✅ Upserted test user: ${user.phone} (id=${user.id})`);

    // -------------------------------------------------
    // Authenticate via real password endpoint (same as test-upload-flow)
    // -------------------------------------------------
    const login = await loginByPassword(PHONE, PASSWORD);
    const accessToken = login.accessToken;
    if (!accessToken) throw new Error("No accessToken returned from login");
    const authHeader = { Authorization: `Bearer ${accessToken}` };
    console.log("✅ Logged in via password auth; obtained access token");

    // -------------------------------------------------
    // 2. CREATE PREREQUISITE DATA (CROP)
    // -------------------------------------------------
    const crop = await prisma.crop.upsert({
      where: { code: "TEST_WHEAT" },
      update: {},
      create: {
        name: "Wheat",
        code: "TEST_WHEAT",
        seasons: ["Rabi"],
        active: true,
      },
    });
    console.log(`🌾 Using Crop: ${crop.name} (ID: ${crop.id})`);

    // -------------------------------------------------
    // 3. CREATE FARM (With Agro-compatible Coordinates)
    // -------------------------------------------------
    const farmPayload = {
      name: "Verification Farm (Calif)",
      cropId: crop.id,
      boundary: {
        type: "Polygon",
        coordinates: [
          [
            [-121.1958, 37.6683],
            [-121.1779, 37.6687],
            [-121.1773, 37.6792],
            [-121.1958, 37.6792],
            [-121.1958, 37.6683],
          ],
        ],
      },
    };

    console.log("🚜 Creating Farm...");
    const farmRes = await axios.post(`${API_URL}/farms`, farmPayload, {
      headers: authHeader,
      validateStatus: () => true,
    });
    console.log(`   [${farmRes.status}] ${API_URL}/farms -> ${pretty(farmRes.data)}`);
    if (!(farmRes.status === 200 || farmRes.status === 201)) {
      throw new Error("Create farm failed");
    }
    const farmId = farmRes.data.data.farm.id;
    console.log(`   -> Farm ID: ${farmId}`);

    // -------------------------------------------------
    // 4. SUBMIT DAMAGE REPORT
    // -------------------------------------------------
    console.log("📸 Submitting Damage Report...");
    const reportPayload = {
      farmId: farmId,
      damageType: "Drought",
      cropType: "Wheat",
      photos: ["https://placehold.co/600x400.jpg"],
    };

    const reportRes = await axios.post(`${API_URL}/damage-report`, reportPayload, {
      headers: authHeader,
      validateStatus: () => true,
    });

    console.log(
      `   [${reportRes.status}] ${API_URL}/damage-report -> ${pretty(reportRes.data)}`
    );
    if (!(reportRes.status >= 200 && reportRes.status < 300)) {
      throw new Error("Damage report submission failed");
    }

    const reportId = reportRes.data.data.reportId;
    console.log(`   -> Report Submitted! ID: ${reportId}`);

    // -------------------------------------------------
    // 5. POLL FOR RESULTS
    // -------------------------------------------------
    console.log("⏳ Waiting for Analysis Pipeline (Satellite + Weather + ML)...");

    let attempts = 0;
    const maxAttempts = 15;

    while (attempts < maxAttempts) {
      const checkRes = await axios.get(`${API_URL}/damage-report/${reportId}`, {
        headers: authHeader,
        validateStatus: () => true,
      });

      console.log(`   [${checkRes.status}] polling -> ${pretty(checkRes.data)}`);
      const data = checkRes.data?.data ?? checkRes.data;

      if (!data) {
        console.warn("   Empty or malformed response while polling");
      }

      if (data?.status === "completed") {
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
          (data.aiFindings || []).forEach((f:any) => console.log(`   - ${f}`));
        } else {
          console.log("   (No findings generated)");
        }
        console.log("================================================");
        return;
      }

      if (data?.status === "failed") {
        console.error("❌ Pipeline Failed. Check server logs for details.");
        console.error("Response:", pretty(data));
        return;
      }

      // Wait 2 seconds before checking again
      await new Promise((r) => setTimeout(r, 2000));
      process.stdout.write(".");
      attempts++;
    }

    console.log("\n⚠️ Timeout: Analysis took too long or stayed in 'processing'.");
  } catch (error) {
    const err = error as any;
    console.error("\n❌ Test Failed:", err.response?.data ?? err.message ?? error);
  } finally {
    await prisma.$disconnect();
  }
}

main();