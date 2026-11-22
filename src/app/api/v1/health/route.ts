import { success, redactSecrets } from "@/lib/envelope";
import { db } from "@/lib/db";

async function checkDatabase(): Promise<string> {
  if (!process.env.DATABASE_URL) return "not_configured";
  try {
    await db.$queryRaw`SELECT 1`;
    return "ok";
  } catch (err) {
    console.error("[health] database check failed:", redactSecrets(err));
    return "unreachable";
  }
}

async function checkRedis(): Promise<string> {
  const url = process.env.REDIS_URL;
  if (!url) return "not_configured";
  try {
    const { default: Redis } = await import("ioredis");
    const redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
    });
    await redis.connect();
    const pong = await redis.ping();
    await redis.quit();
    return pong === "PONG" ? "ok" : "unreachable";
  } catch (err) {
    console.error("[health] redis check failed:", redactSecrets(err));
    return "unreachable";
  }
}

/**
 * GET /api/v1/health — application health check with real dependency probes.
 * Individual dependency failures are reported, never thrown.
 */
export async function GET() {
  const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);
  return success({
    status: "ok",
    service: "product-video-platform",
    apiVersion: "v1",
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    dependencies: {
      database,
      redis,
      n8n: process.env.N8N_WEBHOOK_URL ? "configured" : "not_configured",
    },
  });
}
