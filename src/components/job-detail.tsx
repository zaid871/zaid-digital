"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/badge";

interface StageState {
  stageKey: string;
  label: string;
  order: number;
  status: string;
  progressPct: number;
  message: string | null;
  warnings: string[];
  retryCount: number;
}

interface JobDetail {
  id: string;
  productUrl: string;
  status: string;
  durationSeconds: number;
  language: string;
  stages: StageState[];
  createdAt: string;
  updatedAt: string;
}

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function toneForStatus(status: string): "default" | "success" | "warning" | "danger" | "info" {
  switch (status) {
    case "COMPLETED":
    case "succeeded":
      return "success";
    case "FAILED":
    case "failed":
      return "danger";
    case "WAITING_FOR_REVIEW":
    case "waiting_review":
      return "warning";
    case "running":
    case "RETRYING":
      return "info";
    default:
      return "default";
  }
}

export function JobDetailClient({ id }: { id: string }) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(`/api/v1/jobs/${id}`);
      const json = (await res.json()) as ApiEnvelope<JobDetail>;
      if (json.ok && json.data) setJob(json.data);
      else setError(json.error?.message ?? "Failed to load job.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    // Subscription-style fetch: setState only fires in the async callback,
    // never synchronously in the effect body (react-hooks/set-state-in-effect).
    fetch(`/api/v1/jobs/${id}`)
      .then(async (res) => {
        const json = (await res.json()) as ApiEnvelope<JobDetail>;
        if (cancelled) return;
        if (json.ok && json.data) setJob(json.data);
        else setError(json.error?.message ?? "Failed to load job.");
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Network error.");
      });
    return () => {
      cancelled = true;
    };
    // Phase 3: replace manual refresh with polling/SSE against real job state.
  }, [id]);

  async function act(action: "cancel" | "retry") {
    setActionMsg(null);
    const res = await fetch(`/api/v1/jobs/${id}/${action}`, { method: "POST" });
    const json = (await res.json()) as ApiEnvelope<{ status: string; message: string }>;
    if (json.ok && json.data) {
      setActionMsg(json.data.message);
      load();
    } else {
      setActionMsg(json.error?.message ?? "Action failed.");
    }
  }

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!job) return <p className="text-sm text-zinc-500">Loading job…</p>;

  const done = job.stages.filter((s) => s.status === "succeeded").length;
  const overall = Math.round((done / Math.max(1, job.stages.length)) * 100);

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-xl">Job {job.id.slice(0, 8)}…</CardTitle>
              <CardDescription className="mt-1 break-all">{job.productUrl}</CardDescription>
            </div>
            <Badge tone={toneForStatus(job.status)}>{job.status}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-2 flex items-center justify-between text-sm text-zinc-400">
            <span>Overall progress</span>
            <span>{overall}%</span>
          </div>
          <Progress value={overall} />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => act("retry")}>
              Retry failed stages
            </Button>
            <Button variant="destructive" onClick={() => act("cancel")}>
              Cancel job
            </Button>
          </div>
          {actionMsg && <p className="mt-3 text-sm text-zinc-300">{actionMsg}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stage progress</CardTitle>
          <CardDescription>
            Live stage states from the backend. Phase 2 shows stub data; Phase 3
            persists these per stage with timestamps, warnings, and retries.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-2">
            {job.stages.map((stage) => (
              <li
                key={stage.stageKey}
                className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[11px] font-semibold text-zinc-300">
                  {stage.order}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-200">{stage.label}</p>
                  {stage.message && (
                    <p className="truncate text-xs text-zinc-500">{stage.message}</p>
                  )}
                </div>
                <div className="w-24 shrink-0">
                  <Progress value={stage.progressPct} />
                </div>
                <Badge tone={toneForStatus(stage.status)}>{stage.status}</Badge>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Result</CardTitle>
          <CardDescription>
            Video preview, downloads, script, storyboard, and reports appear here
            once the pipeline completes (Phases 5–7).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-zinc-500">
            No result yet — this job has not reached final delivery.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
