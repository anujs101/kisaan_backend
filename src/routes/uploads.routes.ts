// src/routes/uploads.routes.ts
import express from "express";
import { signHandler, completeHandler } from "@controllers/cloudinary.controller";
import { auth } from "@middleware/auth";

const router = express.Router();

/**
 * POST /api/uploads/cloudinary/sign
 * Body: { localUploadId, deviceMeta: { captureLat, captureLon, captureTimestamp, ... }, folder?, filename? }
 */
router.post("/cloudinary/sign", auth(), signHandler);

/**
 * POST /api/uploads/cloudinary/complete
 * Body: { localUploadId, public_id, version, uploadLat?, uploadLon?, uploadTimestamp? }
 */
router.post("/cloudinary/complete", auth(), completeHandler);

export default router;