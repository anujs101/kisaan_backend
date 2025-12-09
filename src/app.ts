// src/app.ts
import "@lib/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import pino from "pino";
import pinoHttp from "pino-http";

import { rateLimiter } from "./middleware/rateLimiter.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import weeklyRoutes from "@routes/weekly.routes";
import authRoutes from "@routes/auth";
import uploadRoutes from "@routes/uploads.routes"; 
import farmRoutes from "@routes/farms";
import damageRoutes from "@routes/damage.routes";
import cropRoutes from "@routes/crops";
import imageRoutes from "@routes/images.routes";
import { prisma } from "@lib/prisma";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const httpLogger = pinoHttp({ logger, autoLogging: false });

export const app = express();

app.set("trust proxy", true);
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",") : true,
    credentials: true,
  })
);
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(httpLogger);
app.use(requestLogger());
app.use(rateLimiter({ windowMs: 60_000, max: 300 }));

// --- MOUNT ROUTES ---

app.use("/api/auth", rateLimiter({ windowMs: 60_000, max: 120 }), authRoutes);
app.use("/api/uploads", rateLimiter({ windowMs: 60_000, max: 60 }), uploadRoutes);

// Mount damageRoutes at /api so it captures /api/farms/:farmId/damage-sessions
// Must come BEFORE farmRoutes to avoid collision with generic /:id handlers
app.use("/api", rateLimiter({ windowMs: 60_000, max: 30 }), damageRoutes);
app.use("/api", rateLimiter({ windowMs: 60_000, max: 30 }), weeklyRoutes);
app.use("/api/farms", rateLimiter({ windowMs: 60_000, max: 60 }), farmRoutes);
app.use("/api/crops", cropRoutes);
app.use("/api/images", imageRoutes);

// Health check
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    status: "error",
    error: { message: "Not Found" },
  });
});

app.use(errorHandler);

async function shutdown(signal: string) {
  try {
    logger.info({ signal }, "shutdown: signal received, closing resources");
    try {
      await prisma.$disconnect();
      logger.info("prisma disconnected");
    } catch (prismaErr) {
      logger.error({ err: prismaErr }, "error disconnecting prisma");
    }
    logger.info("shutdown complete, exiting");
    setTimeout(() => process.exit(0), 200);
  } catch (err) {
    logger.error({ err }, "shutdown error");
    setTimeout(() => process.exit(1), 200);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

export default app;