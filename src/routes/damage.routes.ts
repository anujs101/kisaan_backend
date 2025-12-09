// src/routes/damage.routes.ts
import express from "express";
import { auth } from "@middleware/auth";
import { validate } from "@middleware/validate";
import { startSessionSchema } from "@validators/damage.schema"; // removed submit schema if empty
import { 
    startSessionHandler, 
    getSessionHandler, 
    submitSessionHandler 
} from "@controllers/damage.controller";

const router = express.Router();

router.use(auth());

// 1. Start Session
router.post(
  "/farms/:farmId/damage-sessions/start", 
  validate(startSessionSchema, "body"), 
  startSessionHandler
);

// 2. Get/Resume Session
router.get(
  "/farms/:farmId/damage-sessions/:sessionUuid", 
  getSessionHandler
);

// 3. Submit Session
router.post(
  "/farms/:farmId/damage-sessions/:sessionUuid/submit", 
  submitSessionHandler
);

export default router;