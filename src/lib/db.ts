import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Prisma client singleton — safe to import from API routes and workers.
 * Prisma 7 requires a driver adapter; the connection string comes from
 * DATABASE_URL at runtime. The schema is defined in prisma/schema.prisma
 * and the migrate connection URL in prisma.config.ts.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Defer the failure to first query time so `next build` and typecheck
    // work without a database configured. Callers surface structured errors.
    return new PrismaClient({
      adapter: new PrismaPg({ connectionString: "postgresql://localhost:5432/unconfigured" }),
      log: ["error"],
    });
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
