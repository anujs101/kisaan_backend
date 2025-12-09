import { z } from "zod";

// Legacy direct report schema (keep for compatibility if needed)
export const createDamageReportSchema = z.object({
  farmId: z.string().uuid(),
  // Photos array is used in the legacy/direct flow
  photos: z.array(z.string().url()).optional(), 
});

// New Session Schemas
export const startSessionSchema = z.object({
  gridResolutionM: z.number().min(10).max(500).optional(),
});

export const submitSessionSchema = z.object({
  notes: z.string().optional(),
});