/**
 * Tool Registry — load + query (file: storage/tool-registry.json).
 *
 * The file is the source of truth; entries are zod-validated on load
 * and a bad entry is skipped with a warning instead of killing the
 * whole registry. Registry entries never carry secret VALUES — only
 * env-var names (see ToolEntry.secretEnv) — so the public view is
 * safe to return from the read endpoint as-is.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  ToolEntrySchema,
  isStale,
  type ToolCapability,
  type ToolEntry,
  type ToolStatus,
} from "./types";

export function registryPath(): string {
  return (
    process.env.TOOLS_REGISTRY_PATH ||
    join(process.cwd(), "storage", "tool-registry.json")
  );
}

export interface RegistryLoad {
  tools: ToolEntry[];
  warnings: string[];
}

/** Load + validate the registry file. Never throws. */
export function loadRegistry(): RegistryLoad {
  const path = registryPath();
  if (!existsSync(path)) {
    return { tools: [], warnings: [`registry file missing: ${path}`] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
  } catch {
    return { tools: [], warnings: [`registry file is not valid JSON: ${path}`] };
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { tools?: unknown }).tools)
  ) {
    return { tools: [], warnings: [`registry file has no tools array: ${path}`] };
  }
  const tools: ToolEntry[] = [];
  const warnings: string[] = [];
  for (const raw of (parsed as { tools: unknown[] }).tools) {
    const entry = ToolEntrySchema.safeParse(raw);
    if (entry.success) {
      tools.push(entry.data);
    } else {
      const id =
        raw && typeof raw === "object" && "id" in raw
          ? String((raw as { id: unknown }).id)
          : "?";
      warnings.push(`skipped invalid registry entry id=${id}`);
    }
  }
  return { tools, warnings };
}

export function getTool(tools: ToolEntry[], id: string): ToolEntry | null {
  return tools.find((t) => t.id === id) ?? null;
}

/** Tools that can actually run a capability: wired + has an adapter + not stale. */
export function routableTools(
  tools: ToolEntry[],
  capability: ToolCapability
): ToolEntry[] {
  return tools.filter(
    (t) =>
      t.capabilities.includes(capability) &&
      t.status === "wired" &&
      t.adapter !== null &&
      !isStale(t.lastVerified)
  );
}

/** Public view of one entry: everything the dashboard needs, no secrets (there are none to leak — entries hold env names only). */
export function toPublicTool(entry: ToolEntry): Record<string, unknown> {
  return {
    id: entry.id,
    displayName: entry.displayName,
    capabilities: entry.capabilities,
    limits: entry.limits,
    quota: entry.quota,
    expiry: entry.expiry,
    fallback: entry.fallback,
    cost: entry.cost,
    status: entry.status,
    lastVerified: entry.lastVerified,
    stale: isStale(entry.lastVerified),
    adapter: entry.adapter,
  };
}

export function registrySummary(tools: ToolEntry[]): Record<ToolStatus, number> {
  const summary: Record<ToolStatus, number> = {
    candidate: 0,
    wired: 0,
    paused: 0,
    dead: 0,
  };
  for (const t of tools) summary[t.status] += 1;
  return summary;
}
