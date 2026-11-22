import * as React from "react";

function cn(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(" ");
}

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "default" | "success" | "warning" | "danger" | "info";
};

export function Badge({ tone = "default", className, ...props }: BadgeProps) {
  const tones: Record<string, string> = {
    default: "bg-zinc-800 text-zinc-300 border-zinc-700",
    success: "bg-emerald-950 text-emerald-300 border-emerald-800",
    warning: "bg-amber-950 text-amber-300 border-amber-800",
    danger: "bg-red-950 text-red-300 border-red-800",
    info: "bg-indigo-950 text-indigo-300 border-indigo-800",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        tones[tone],
        className
      )}
      {...props}
    />
  );
}

type ProgressProps = React.HTMLAttributes<HTMLDivElement> & {
  value: number; // 0..100
};

export function Progress({ value, className, ...props }: ProgressProps) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-zinc-800", className)}
      {...props}
    >
      <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${clamped}%` }} />
    </div>
  );
}
