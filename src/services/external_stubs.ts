import axios from "axios";

/**
 * A) Flask ML Damage Classifier Stub/Integration
 */
export async function classifyDamage(
  imageUrl: string, 
  damageType: string, 
  cropType: string
): Promise<{ damage_detected: number; confidence: number }> {
  const ML_API_URL = process.env.FLASK_ML_API_URL;

  // Real Integration
  if (ML_API_URL) {
    try {
      const res = await axios.post(`${ML_API_URL}/classify-damage`, {
        image: imageUrl,
        damage_type: damageType,
        crop_type: cropType
      });
      return {
        damage_detected: res.data.damage_detected ?? 0,
        confidence: res.data.confidence ?? 0.0
      };
    } catch (e) {
      console.error("ML API Error, falling back to stub", e);
    }
  }

  // Stub
  return {
    damage_detected: Math.random() > 0.3 ? 1 : 0,
    confidence: Number((Math.random() * (0.99 - 0.70) + 0.70).toFixed(2))
  };
}

/**
 * B) Satellite Data Stub (Sentinel Hub)
 */
export async function fetchSatelliteData(lat: number, lon: number) {
  // Mocking delay
  await new Promise(r => setTimeout(r, 500));
  
  return {
    ndvi_before: 0.68,
    ndvi_after: 0.49,
    ndvi_drop_percent: 27,
    ndwi: 0.11
  };
}

/**
 * C) IMD Weather Data Stub
 */
export async function fetchWeatherData(lat: number, lon: number) {
  await new Promise(r => setTimeout(r, 500));

  return {
    rainfall: 12, // mm
    rainfall_anomaly: -32, // % deviation
    temperature: 28, // C
    humidity: 71, // %
    wind_speed: 15, // km/h
    hail_alert: false
  };
}

/**
 * E) LLM Summary Generation
 */
export async function generateAISummary(contextData: any): Promise<string[]> {
  const LLM_API_URL = process.env.LLM_API_URL; // e.g. OpenAI or custom
  
  // Construct the prompt
  const prompt = `
You are an agricultural crop damage assessment expert.
Summarize the following data in 3–5 bullet points.
DATA:
Damage detected: ${contextData.photo_damage}
Damage type: ${contextData.damageType}
ML confidence: ${contextData.photo_confidence}
Satellite NDVI before: ${contextData.ndvi_before}
Satellite NDVI after: ${contextData.ndvi_after}
NDVI drop percent: ${contextData.ndvi_drop}
NDWI: ${contextData.ndwi}
Weather:
Rainfall: ${contextData.rainfall}
Rainfall anomaly: ${contextData.rainfall_anomaly}
Temperature: ${contextData.temperature}
Humidity: ${contextData.humidity}
Wind speed: ${contextData.wind_speed}
Hail alert: ${contextData.hail_alert}

Write short, factual bullet points only. No assumptions.
`;

  // Real Integration (Example structure)
  if (LLM_API_URL && process.env.LLM_API_KEY) {
    try {
      // Logic to call OpenAI/Gemini would go here. 
      // For now, falling back to robust stub to ensure code runs immediately.
    } catch (e) {
      console.error("LLM API Error", e);
    }
  }

  // Robust Stub Response
  return [
    `Detected ${contextData.damageType} with ${contextData.photo_confidence * 100}% confidence based on field imagery.`,
    `Satellite analysis indicates a ${contextData.ndvi_drop}% drop in vegetation health (NDVI).`,
    `Weather conditions show a rainfall deficit of ${contextData.rainfall_anomaly}%, exacerbating stress.`,
    `Current humidity (${contextData.humidity}%) and temperature (${contextData.temperature}°C) favor pest propagation.`
  ];
}