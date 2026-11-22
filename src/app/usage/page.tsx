"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface UsageResponse {
  records: Array<{
    id: string;
    providerKey: string;
    capability: string;
    costUsd: number | null;
    recordedAt: string;
  }>;
  totals: { totalCostUsd: number; byProvider: Record<string, number> };
  page: number;
  pageSize: number;
  total: number;
}

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export default function UsagePage() {
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/v1/usage");
        const json = (await res.json()) as ApiEnvelope<UsageResponse>;
        if (json.ok && json.data) setUsage(json.data);
        else setError(json.error?.message ?? "Failed to load usage.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      }
    })();
  }, []);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!usage) return <p className="text-sm text-zinc-500">Loading usage…</p>;

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl">Usage &amp; estimated cost</CardTitle>
              <CardDescription>
                Per-provider usage and cost tracking. Budgets and spending limits
                are enforced in Phase 3+.
              </CardDescription>
            </div>
            <Badge tone="info">
              Total: ${usage.totals.totalCostUsd.toFixed(2)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {usage.records.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No usage recorded yet. Usage is tracked per job and provider once
              generation runs against configured providers.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-zinc-400">
                  <th className="py-2 pr-4">Provider</th>
                  <th className="py-2 pr-4">Capability</th>
                  <th className="py-2 pr-4">Cost (USD)</th>
                  <th className="py-2">Recorded</th>
                </tr>
              </thead>
              <tbody>
                {usage.records.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-900 text-zinc-300">
                    <td className="py-2 pr-4">{r.providerKey}</td>
                    <td className="py-2 pr-4">{r.capability}</td>
                    <td className="py-2 pr-4">
                      {r.costUsd != null ? `$${r.costUsd.toFixed(4)}` : "—"}
                    </td>
                    <td className="py-2">{new Date(r.recordedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
