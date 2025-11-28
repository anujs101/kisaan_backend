// scripts/debug-prisma-find.ts
import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("DATABASE_URL (truncated):", (process.env.DATABASE_URL ?? "").slice(0,60) + (process.env.DATABASE_URL? "..." : ""));
  prisma.$on("query", (e: any) => {
    console.log("PRISMA QUERY:", e.query);
    console.log("PRISMA PARAMS:", e.params);
  });
  try {
    const email = "test@example.com"; // adjust to an email in your DB or leave
    console.log("Running prisma.user.findUnique({ where: { email } }) ...");
    const user = await prisma.user.findUnique({ where: { email } });
    console.log("Result:", user);
  } catch (err) {
    console.error("Error during findUnique:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => { console.error(e); process.exit(1); });