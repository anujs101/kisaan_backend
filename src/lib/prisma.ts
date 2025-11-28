// src/lib/prisma.ts
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

/**
 * Use the PrismaNeon adapter with a connectionString config object.
 * This avoids passing a Pool instance (which causes typing mismatches).
 *
 * See: Neon + Prisma docs / community examples.
 */

// Enable WebSocket constructor for Neon when needed
neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not defined");
}

// Create adapter with connectionString (per Neon+Prisma examples)
const adapter = new PrismaNeon({ connectionString });

// Create Prisma client with the adapter.
// Pass an empty options object if you ever hit a runtime '__internal' check (defensive).
const prisma = new PrismaClient({ adapter });

export { prisma };
export default prisma;
