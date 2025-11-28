// src/server.ts
import "@lib/config";
import http from "http";
import { app } from "./app.js";
import pino from "pino";
import { prisma } from "@lib/prisma";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

// Create HTTP server explicitly to allow graceful shutdown
const server = http.createServer(app);

server.listen(PORT, () => {
  logger.info(` Server running at http://localhost:${PORT}`);
});

/**
 * Graceful shutdown
 */
async function shutdown(signal: string) {
  try {
    logger.info({ signal }, "shutdown: signal received");

    // Stop accepting new connections
    await new Promise<void>((resolve) => {
      server.close(() => {
        logger.info("HTTP server closed");
        resolve();
      });
    });

    // Disconnect Prisma
    try {
      await prisma.$disconnect();
      logger.info("Prisma disconnected");
    } catch (err) {
      logger.error({ err }, "Error disconnecting Prisma");
    }

    logger.info("Shutdown complete. Exiting now.");
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "Shutdown failed");
    process.exit(1);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
