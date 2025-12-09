// src/routes/weekly.routes.ts
import express from "express";
import { auth } from "@middleware/auth";
import { validate } from "@middleware/validate";
import { startWeeklySessionSchema, submitWeeklySessionSchema } from "@validators/weekly.schema";
import { 
    startSessionHandler, 
    getSessionHandler, 
    submitSessionHandler 
} from "@controllers/weekly.controller";

const router = express.Router();

router.use(auth());

// 1. Start Weekly Session
router.post(
  "/farms/:farmId/weekly-sessions/start", 
  validate(startWeeklySessionSchema, "body"), 
  startSessionHandler
);

// 2. Get/Resume Session
router.get(
  "/farms/:farmId/weekly-sessions/:sessionUuid", 
  getSessionHandler
);

// 3. Submit Weekly Session
router.post(
  "/farms/:farmId/weekly-sessions/:sessionUuid/submit", 
  validate(submitWeeklySessionSchema, "body"),
  submitSessionHandler
);

export default router;