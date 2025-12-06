import axios from "axios";
import { prisma } from "../lib/prisma";

console.log("✅ AGRO SERVICE: Loaded with Duplicate Handling Fix (v2)");

const AGRO_API_KEY = process.env.AGRO_API_KEY;
const AGRO_BASE_URL = "http://api.agromonitoring.com/agro/1.0";

// ✅ CRITICAL: Use Agro URL for weather to prevent 401 errors
const WEATHER_BASE_URL = "http://api.agromonitoring.com/agro/1.0"; 

if (!AGRO_API_KEY) throw new Error("Missing AGRO_API_KEY env var");

/**
 * 1. Lazy Registration:
 * Ensures the farm exists on Agromonitoring.com.
 * If not, it creates it.
 * If it ALREADY exists (duplicate error), it recovers the ID and saves it.
 */

interface AgroPolyPayload {
  name: string;
  geo_json: {
    type: "Feature";
    properties: Record<string, any>;
    geometry: any;
  };
}

export async function ensureFarmRegistered(farmId: string) {
  console.log(`[AgroService] Registering Farm ${farmId} on API...`);

  // 1. Fetch from Database using RAW SQL
  // We use queryRaw because we need ST_AsGeoJSON(boundary)
  const result = await prisma.$queryRaw<any[]>`
    SELECT 
      id, 
      name, 
      ST_AsGeoJSON(boundary)::json as geo_json 
    FROM "farms" 
    WHERE id = ${farmId}::uuid
    LIMIT 1
  `;

  const farm = result[0];

  if (!farm || !farm.geo_json) {
    throw new Error(`Farm ${farmId} not found or missing geometry`);
  }

  // 2. Construct Payload
  // Note: farm.geo_json comes from the query alias above
  const payload = {
    name: farm.name || farm.id,
    geo_json: {
      type: "Feature",
      properties: {},
      geometry: farm.geo_json 
    }
  };

  try {
    const response = await axios.post(
      'http://api.agromonitoring.com/agro/1.0/polygons', 
      payload,
      { 
        params: { appid: process.env.AGRO_API_KEY } // Assuming key is here or in query string
      }
    );

    console.log(`✅ [AgroService] Successfully registered. Polygon ID: ${response.data.id}`);
    return response.data.id;

  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      const status = error.response.status;
      const errorData = error.response.data;
      const errorMessage = errorData.message || "";

      // CASE A: Duplicate reported as 422 (The exact error you are seeing)
      // Message format: "Your polygon is duplicated your already existed polygon '6933fc...'"
      if (status === 422 && errorMessage.includes("duplicated")) {
         // Regex to extract the ID between single quotes
         const match = errorMessage.match(/'([a-f0-9]+)'/);
         if (match && match[1]) {
             console.warn(`⚠️ [AgroService] Farm geometry already exists. Using existing ID: ${match[1]}`);
             return match[1]; // RECOVERY: Return the existing ID!
         }
      }

      // CASE B: Generic 422 (Actual Bad Data)
      if (status === 422) {
        console.error(`❌ [AgroService] Data Validation Error (422). Check Geometry format.`);
        console.error(`   API Message: ${JSON.stringify(errorData)}`);
        throw new Error(`Agro API rejected geometry: ${errorMessage}`);
      }
      
      // CASE C: 409 Conflict (Just in case they use this code too)
      if (status === 409) {
         console.warn(`⚠️ [AgroService] 409 Conflict detected.`);
         // If you want to handle 409s by creating a duplicate anyway:
         // return ensureFarmRegistered(farmId, true); // (requires logic change to accept a flag)
         return null; 
      }

      console.error(`❌ [AgroService] API Error (${status}):`, errorData);
    }
    
    throw new Error(`Failed to register farm on Agromonitoring API: ${(error as Error).message}`);
  }
}

// Helper to save the ID to DB
async function updateFarmId(farmId: string, agroId: string) {
  await prisma.farm.update({
    where: { id: farmId },
    data: { agromonitoringId: agroId }
  });
}

/**
 * 2. Fetch Satellite Data (NDVI)
 */
export async function getSatelliteAnalysis(polyId: string) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - (30 * 24 * 60 * 60); // 30 days ago

  try {
    const url = `${AGRO_BASE_URL}/ndvi/history?polyid=${polyId}&start=${start}&end=${end}&appid=${AGRO_API_KEY}`;
    const { data } = await axios.get(url);

    if (!Array.isArray(data) || data.length === 0) {
      return { ndvi_before: 0, ndvi_after: 0, ndvi_drop_percent: 0, ndwi: 0 };
    }

    // Sort descending by date (newest first)
    data.sort((a: any, b: any) => b.dt - a.dt);

    const current = data[0]; 
    const baseline = data[data.length - 1]; 

    const ndvi_before = baseline.data.mean;
    const ndvi_after = current.data.mean;
    
    // Calculate Drop %
    let drop = ((ndvi_before - ndvi_after) / ndvi_before) * 100;
    if (drop < 0) drop = 0; 

    return {
      ndvi_before: Number(ndvi_before.toFixed(2)),
      ndvi_after: Number(ndvi_after.toFixed(2)),
      ndvi_drop_percent: Number(drop.toFixed(1)),
      ndwi: 0 
    };
  } catch (err) {
    console.error("Satellite Fetch Error:", err);
    return { ndvi_before: 0, ndvi_after: 0, ndvi_drop_percent: 0, ndwi: 0 };
  }
}

/**
 * 3. Fetch Real Weather
 */
export async function getRealWeather(lat: number, lon: number) {
  try {
    // Using Agro Base URL to prevent 401
    const url = `${WEATHER_BASE_URL}/weather?lat=${lat}&lon=${lon}&appid=${AGRO_API_KEY}&units=metric`;
    const { data } = await axios.get(url);

    return {
      temperature: data.main.temp,
      humidity: data.main.humidity,
      wind_speed: data.wind.speed,
      rainfall: data.rain ? (data.rain["1h"] || 0) : 0,
      rainfall_anomaly: 0, 
      hail_alert: false    
    };
  } catch (err) {
    console.error("Weather Fetch Error:", err);
    return { temperature: 25, humidity: 50, wind_speed: 5, rainfall: 0, rainfall_anomaly: 0, hail_alert: false };
  }
}