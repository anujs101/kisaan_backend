// src/validators/weekly.schema.ts
import { z } from "zod";

export const startWeeklySessionSchema = z.object({
  // Optional: override farm's default grid resolution
  gridResolutionM: z.number().min(10).max(500).optional(),
});

export const submitWeeklySessionSchema = z.object({
  // Optional: User can self-report the growth stage during submission
  farmerGrowthStage: z.string().max(100).optional(),
  notes: z.string().optional(),
});