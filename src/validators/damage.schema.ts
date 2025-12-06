import { z } from "zod";

export const createDamageReportSchema = z.object({
  farmId: z.string().uuid(),
  damageType: z.string().min(1),
  cropType: z.string().min(1), // Passed to ML/Report
  photos: z.array(z.string().url()).min(1, "At least one photo URL is required"),
});