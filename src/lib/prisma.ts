// src/lib/prisma.ts
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not defined");
}

const adapter = new PrismaNeon({ connectionString });

// ---- FIX: global prisma for hot-reload environments ----
// @ts-ignore
const globalForPrisma = globalThis as any;

export const prisma =
  globalForPrisma._prisma ??
  new PrismaClient({
    adapter,
    log: ["query", "info", "warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma._prisma = prisma;
}

export default prisma;