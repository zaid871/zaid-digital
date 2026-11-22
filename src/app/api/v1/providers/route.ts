import { success, redactSecrets } from "@/lib/envelope";
import { failure } from "@/lib/envelope";
import { PROVIDER_REGISTRY } from "@/lib/providers";
import { db } from "@/lib/db";

/**
 * GET /api/v1/providers — provider configuration status, backed by the
 * ProviderConfig table (seeded from the registry on first read).
 *
 * `configured` is false until credentials are validated via
 * POST /api/v1/providers/:provider/test. Credentials are never stored here —
 * they live in env / the n8n credential store.
 */
export async function GET() {
  try {
    const rows = await Promise.all(
      PROVIDER_REGISTRY.map((p) =>
        db.providerConfig.upsert({
          where: { providerKey: p.key },
          update: {
            displayName: p.name,
            capabilities: p.capabilities,
          },
          create: {
            providerKey: p.key,
            displayName: p.name,
            capabilities: p.capabilities,
            configured: false,
          },
        })
      )
    );
    const byKey = new Map(rows.map((r) => [r.providerKey, r]));

    return success({
      providers: PROVIDER_REGISTRY.map((p) => {
        const row = byKey.get(p.key);
        return {
          key: p.key,
          name: p.name,
          capabilities: p.capabilities,
          requiredEnv: p.requiredEnv,
          commercialUseNotes: p.commercialUseNotes,
          configured: row?.configured ?? false,
          lastHealthCheck: row?.lastHealthCheck?.toISOString() ?? null,
          lastHealthStatus: row?.lastHealthStatus ?? null,
        };
      }),
    });
  } catch (err) {
    console.error("[GET /api/v1/providers] unexpected error:", redactSecrets(err));
    return failure("internal_error", "Failed to read provider status.", 500);
  }
}
