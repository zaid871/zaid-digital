"use client";

import { JOB_STAGES } from "@/lib/job-stages";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Read-only display of the 15 canonical pipeline stages. */
export function StageList({ compact = false }: { compact?: boolean }) {
  return (
    <ol className={compact ? "grid gap-1.5 sm:grid-cols-2" : "grid gap-2 sm:grid-cols-2 lg:grid-cols-3"}>
      {JOB_STAGES.map((stage) => (
        <li
          key={stage.key}
          className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[11px] font-semibold text-zinc-300">
            {stage.order}
          </span>
          <span className="text-sm text-zinc-200">{stage.label}</span>
          {!compact && <Badge tone="default" className="ml-auto">pending</Badge>}
        </li>
      ))}
    </ol>
  );
}

export function PipelineOverview() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Generation pipeline</CardTitle>
        <CardDescription>
          Every job moves through these 15 stages. Progress is read from
          persisted job-stage records — never from a fake animation.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <StageList />
      </CardContent>
    </Card>
  );
}
