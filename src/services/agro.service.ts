import axios from "axios";
import { prisma } from "@lib/prisma";

const AGRO_API_KEY = process.env.AGRO_API_KEY;
const AGRO_BASE_URL = "http://api.agromonitoring.com/agro/1.0";
const WEATHER_BASE_URL = "https://api.openweathermap.org/data/2.5";

if (!AGRO_API_KEY) throw new Error("Missing AGRO_API_KEY env var");

/**
 * 1. Lazy Registration:
 * Ensures the farm exists on Agromonitoring.com.
 * If not, it creates it using the boundary stored in your DB.
 */
export async function ensureFarmRegistered(farmId: string): Promise<string> {
  // Check if we already have the ID
  const farm = await prisma.farm.findUnique({
    where: { id: farmId },
    select: { id: true, agromonitoringId: true, name: true }
  });

  if (!farm) throw new Error("Farm not found");
  if (farm.agromonitoringId) return farm.agromonitoringId;

  console.log(`[AgroService] Registering Farm ${farmId} on API...`);

  // Fetch GeoJSON boundary from PostGIS
  const [farmData] = await prisma.$queryRawUnsafe(
    `SELECT ST_AsGeoJSON(boundary)::json as geo_json FROM farms WHERE id = $1::uuid`,
    farmId
  );

  if (!farmData?.geo_json) throw new Error("Farm has no boundary data");

  // Create on Agromonitoring
  try {
    const res = await axios.post(`${AGRO_BASE_URL}/polygons?appid=${AGRO_API_KEY}`, {
      name: farm.name || `Farm-${farmId.slice(0,8)}`,
      geo_json: farmData.geo_json
    });

    const newId = res.data.id;

    // Save ID for future use
    await prisma.farm.update({
      where: { id: farmId },
      data: { agromonitoringId: newId }
    });

    return newId;
  } catch (err: any) {
    console.error("Agro Registration Error:", err.response?.data);
    throw new Error("Failed to register farm on Agromonitoring API");
  }
}

/**
 * 2. Fetch Satellite Data (NDVI)
 * Compares "Now" vs "30 Days Ago" to find the drop %.
 */
export async function getSatelliteAnalysis(polyId: string) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - (30 * 24 * 60 * 60); // 30 days ago

  try {
    const url = `${AGRO_BASE_URL}/ndvi/history?polyid=${polyId}&start=${start}&end=${end}&appid=${AGRO_API_KEY}`;
    const { data } = await axios.get(url);

    // Default values if no satellite passes found (e.g., cloudy month)
    if (!Array.isArray(data) || data.length === 0) {
      return { ndvi_before: 0, ndvi_after: 0, ndvi_drop_percent: 0, ndwi: 0 };
    }

    // Sort descending by date
    data.sort((a: any, b: any) => b.dt - a.dt);

    const current = data[0]; // Newest
    const baseline = data[data.length - 1]; // Oldest in range

    const ndvi_before = baseline.data.mean;
    const ndvi_after = current.data.mean;
    
    // Logic: (Old - New) / Old * 100
    // If NDVI increased, drop is 0.
    let drop = ((ndvi_before - ndvi_after) / ndvi_before) * 100;
    if (drop < 0) drop = 0; 

    return {
      ndvi_before: Number(ndvi_before.toFixed(2)),
      ndvi_after: Number(ndvi_after.toFixed(2)),
      ndvi_drop_percent: Number(drop.toFixed(1)),
      ndwi: 0 // NDWI requires a separate call, skipping for MVP speed
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
    const url = `${WEATHER_BASE_URL}/weather?lat=${lat}&lon=${lon}&appid=${AGRO_API_KEY}&units=metric`;
    const { data } = await axios.get(url);

    // Map OpenWeather response to our schema
    return {
      temperature: data.main.temp,     // Celsius
      humidity: data.main.humidity,    // %
      wind_speed: data.wind.speed,     // m/s
      rainfall: data.rain ? (data.rain["1h"] || 0) : 0, // mm in last hour
      rainfall_anomaly: 0, // Hard to calculate without 10yr history API, ignoring for MVP
      hail_alert: false    // Would require weather alerts API
    };
  } catch (err) {
    console.error("Weather Fetch Error:", err);
    // Fallback defaults
    return { temperature: 25, humidity: 50, wind_speed: 5, rainfall: 0, rainfall_anomaly: 0, hail_alert: false };
  }
}