// src/services/ml.service.ts
import axios from "axios";

// Ensure this is set in your .env file
const ML_BASE_URL = process.env.ML_API_URL || "http://localhost:5000";

/**
 * 1. Crop Identification
 * Endpoint: /crop-detection
 */
export async function verifyCrop(imageUrl: string, claimedName: string) {
  try {
    const { data } = await axios.post(`${ML_BASE_URL}/crop-detection`, {
      image: imageUrl,
      claimed_name: claimedName,
    });
    // Expected: { predicted_name: "Wheat", match: true, confidence: 0.98 }
    return data; 
  } catch (error) {
    console.error("ML verifyCrop failed:", error);
    return null;
  }
}

/**
 * 2. Growth Stage Verification
 * Endpoint: /growth-stage
 */
export async function verifyGrowthStage(imageUrl: string, cropName: string, claimedStage: string) {
  try {
    const { data } = await axios.post(`${ML_BASE_URL}/growth-stage`, {
      image: imageUrl,
      crop_name: cropName,
      claimed_growth_stage: claimedStage,
    });
    // Expected: { predicted_growth_stage: "Vegetative", match: true, confidence: 0.xx }
    return data;
  } catch (error) {
    console.error("ML verifyGrowthStage failed:", error);
    return null;
  }
}

/**
 * 3. Disease Detection
 * Endpoint: /disease
 */
export async function detectDisease(imageUrl: string, cropName: string) {
  try {
    const { data } = await axios.post(`${ML_BASE_URL}/disease`, {
      image: imageUrl,
      crop_name: cropName,
    });
    // Expected: { predicted_disease: "Leaf Rust", confidence: 0.95 }
    return data;
  } catch (error) {
    console.error("ML detectDisease failed:", error);
    return null;
  }
}

/**
 * 4. Damage Assessment (Visual)
 * Endpoint: /damage
 */
export async function assessVisualDamage(imageUrl: string, cropName: string) {
  try {
    const { data } = await axios.post(`${ML_BASE_URL}/damage`, {
      image: imageUrl,
      crop_name: cropName,
    });
    // Expected: { predicted_reason: "pest"..., match: boolean, confidence: number }
    return data;
  } catch (error) {
    console.error("ML assessVisualDamage failed:", error);
    return null;
  }
}

/**
 * 5. Damage Calculation (Satellite)
 * Endpoint: /calculate-damage
 */
export async function calculateSatelliteDamage(polyId: string, claimDateUnix: number) {
  try {
    const { data } = await axios.post(`${ML_BASE_URL}/calculate-damage`, {
      poly_id: polyId,
      claim_date: claimDateUnix,
    });
    return data;
  } catch (error) {
    console.error("ML calculateSatelliteDamage failed:", error);
    return null;
  }
}