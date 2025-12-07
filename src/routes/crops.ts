// src/routes/crops.ts
import express from "express";
import { createCropHandler, listCropsHandler } from "@controllers/crop.controller";
import { createCropSchema } from "@validators/crop.schema";
import { auth } from "@middleware/auth";
import { validate } from "@middleware/validate";

const router = express.Router();

// All routes require authentication
router.use(auth());

// Create crop (caller must provide `code`)
router.post("/", validate(createCropSchema, "body"), createCropHandler);

// List crops (used to populate dropdowns)
router.get("/", listCropsHandler);

export default router;