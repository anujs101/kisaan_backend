// scripts/check-db.mjs
// Use Neon serverless driver + PrismaNeon adapter
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import dotenv from 'dotenv';

dotenv.config();

// If you need WebSocket support (edge or environments that require it)
neonConfig.webSocketConstructor = ws;

// Create a Neon Pool using your DATABASE_URL
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const pool = new Pool({ connectionString });

// Create Prisma adapter using the pool
const adapter = new PrismaNeon(pool);

// Instantiate Prisma client with adapter
const prisma = new PrismaClient({ adapter });

(async () => {
  try {
    await prisma.$connect();
    console.log('✅ DB OK — connected using PrismaNeon adapter');
  } catch (err) {
    console.error('❌ DB connection failed', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    // close neon pool cleanly (optional)
    try {
      await pool.end();
    } catch {}
  }
})();
