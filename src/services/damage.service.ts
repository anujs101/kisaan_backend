// src/services/damage.service.ts
import { prisma } from "@lib/prisma";
// IMPORT THE NEW SERVICE
import { ensureFarmRegistered, getSatelliteAnalysis, getRealWeather } from "./agro.service";
import { classifyDamage, generateAISummary } from "./external_stubs"; // Keep these stubs for now

export class DamageService {
  
  async processDamageReport(reportId: string) {
    const report = await prisma.damageCase.findUnique({
      where: { id: reportId },
      include: { farm: true }
    });

    if (!report || !report.farm) throw new Error("Report or associated Farm not found");

    // 1. Get Coordinates & Farm ID
    const lat = report.farm.centerLat ?? 0;
    const lon = report.farm.centerLon ?? 0;
    const farmDbId = report.farm.id;

    // 2. [REAL] Register Farm & Get Polygon ID
    const agroPolyId = await ensureFarmRegistered(farmDbId);

    // 3. [REAL] Fetch Satellite Data
    const satData = await getSatelliteAnalysis(agroPolyId);

    // 4. [REAL] Fetch Weather Data
    const weatherData = await getRealWeather(lat, lon);

    // 5. [STUB] ML Damage (Still faked until you connect Flask)
    // ... (rest of the logic remains the same) ...
    const currentDetails = (report.reportDetails as any) || {};
    const photoUrls = currentDetails.photos?.map((p: any) => p.url) || [];
    const mlResult = await classifyDamage(photoUrls[0] || "", report.damageType || "unknown", "crop");

    // DSI Calculation
    const NDVI_s = satData.ndvi_drop_percent; 
    const Photo_s = mlResult.damage_detected ? (mlResult.confidence * 100) : 0;
    
    // Simplified Weather Score based on real data
    // High wind (>15m/s) or High Rain (>20mm) increases score
    let Weather_s = 0;
    if (weatherData.wind_speed > 15) Weather_s += 40;
    if (weatherData.rainfall > 20) Weather_s += 60;
    Weather_s = Math.min(100, Weather_s);

    const DSI = (0.5 * NDVI_s) + (0.3 * Photo_s) + (0.2 * Weather_s);

    let severityLabel = "Mild";
    if (DSI > 70) severityLabel = "Total Loss";
    else if (DSI > 40) severityLabel = "Severe";
    else if (DSI > 20) severityLabel = "Moderate";

    // AI Summary
    const context = { ...satData, ...weatherData, ...mlResult, damageType: report.damageType };
    const aiFindings = await generateAISummary(context);

    const finalResult = {
      reportId: report.id,
      status: "completed",
      satellite: satData,
      weather: weatherData,
      damageResult: mlResult,
      severity: { score: DSI.toFixed(1), label: severityLabel },
      aiFindings
    };

    await prisma.damageCase.update({
      where: { id: reportId },
      data: { status: "completed", severity: severityLabel, reportDetails: finalResult as any }
    });

    return finalResult;
  }
}

export const damageService = new DamageService();