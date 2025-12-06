import express from "express";
import { auth } from "@middleware/auth";
import { validate } from "@middleware/validate";
import { createDamageReportSchema } from "@validators/damage.schema";
import { createDamageReport, getDamageReport } from "@controllers/damage.controller";

const router = express.Router();

router.use(auth());

// Create new report
router.post("/", validate(createDamageReportSchema, "body"), createDamageReport);

// Get report (triggers analysis if pending)
router.get("/:id", getDamageReport);

export default router;