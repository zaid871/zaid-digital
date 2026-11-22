"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ProviderStatus {
  key: string;
  name: string;
  capabilities: string[];
  requiredEnv: string[];
  commercialUseNotes: string;
  configured: boolean;
  lastHealthCheck: string | null;
}

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export default function ProvidersPage() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  async function load() {
    try {
      const res = await fetch("/api/v1/providers");
      const json = (await res.json()) as ApiEnvelope<{ providers: ProviderStatus[] }>;
      if (json.ok && json.data) setProviders(json.data.providers);
      else setError(json.error?.message ?? "Failed to load providers.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function testProvider(key: string) {
    setTesting(key);
    try {
      const res = await fetch(`/api/v1/providers/${key}/test`, { method: "POST" });
      const json = (await res.json()) as ApiEnvelope<{ message: string; missingEnv: string[] }>;
      if (json.ok && json.data) {
        setTestResult((prev) => ({ ...prev, [key]: json.data!.message }));
      } else {
        setTestResult((prev) => ({ ...prev, [key]: json.error?.message ?? "Test failed." }));
      }
    } catch (err) {
      setTestResult((prev) => ({
        ...prev,
        [key]: err instanceof Error ? err.message : "Network error.",
      }));
    } finally {
      setTesting(null);
      load();
    }
  }

  if (error) return <p className="text-sm text-red-400">{error}</p>;

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Provider configuration</CardTitle>
          <CardDescription>
            No provider is treated as available until its credentials are set and
            validated. Credentials live in environment variables / the n8n
            credential store — never in the database or frontend code.
          </CardDescription>
        </CardHeader>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {providers.map((p) => (
          <Card key={p.key}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{p.name}</CardTitle>
                <Badge tone={p.configured ? "success" : "default"}>
                  {p.configured ? "configured" : "unconfigured"}
                </Badge>
              </div>
              <CardDescription>
                Capabilities: {p.capabilities.join(", ")}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <p className="text-xs text-zinc-500">
                Required env: <code className="text-zinc-400">{p.requiredEnv.join(", ")}</code>
              </p>
              <p className="text-xs text-zinc-500">{p.commercialUseNotes}</p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={testing === p.key}
                  onClick={() => testProvider(p.key)}
                >
                  {testing === p.key ? "Testing…" : "Test connection"}
                </Button>
              </div>
              {testResult[p.key] && (
                <p className="text-xs text-zinc-400">{testResult[p.key]}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
