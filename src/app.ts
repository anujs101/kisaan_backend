// src/app.ts
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";

import { errorHandler } from "./middleware/errorHandler.js";
import uploadRoutes from "./routes/upload/index.js";
import farmRoutes from "./routes/farm/index.js";
import cropRoutes from "./routes/crops/index.js";
import authRoutes from "./routes/auth/index.js";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

export const app = express();

// JSON parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use(
  pinoHttp({
    logger,
    autoLogging: true
  })
);

// Register routes
app.use("/api/auth", authRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/farm", farmRoutes);
app.use("/api/crops", cropRoutes);

// Health check
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Central error handler
app.use(errorHandler);
