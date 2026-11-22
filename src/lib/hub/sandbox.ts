/**
 * Hub sandbox — Docker-isolated code execution (spec §5 + §6).
 *
 * Code is NEVER returned as "done" unless the sandbox ran it. The
 * sandbox runs the code in a throwaway container: no network, 256 MB
 * RAM, 0.5 CPU, stdin carries the program, stdout/stderr come back.
 *
 * Honest states:
 * - "passed" — the code ran and exited 0.
 * - "failed" — it ran and exited non-zero (stderr is the traceback the
 *   builder retries with), or it timed out.
 * - "unavailable" — Docker is not reachable (no socket here, or
 *   HUB_SANDBOX=off). This is NEVER a pass: the run fails honestly
 *   instead of pretending the code was verified.
 *
 * Deploy prerequisite: Docker socket available to the app container and
 * the images node:20-alpine + python:3.12-alpine pulled once on the VM.
 */
import { execFile } from "child_process";
import type { SandboxStatus } from "./types";

/**
 * execFile with stdin input (the promisified overloads in this
 * @types/node version do not accept `input`, so wrap the callback form).
 */
function execFileP(
  file: string,
  args: string[],
  opts: { timeout: number; input?: string; maxBuffer?: number }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { timeout: opts.timeout, maxBuffer: opts.maxBuffer ?? 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const wrapped = err as Error & { stdout?: string; stderr?: string; code?: unknown; killed?: boolean };
          wrapped.stdout = String(stdout ?? "");
          wrapped.stderr = String(stderr ?? "");
          reject(wrapped);
        } else {
          resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
        }
      }
    );
    if (opts.input !== undefined && child.stdin) {
      child.stdin.write(opts.input);
      child.stdin.end();
    }
  });
}

export interface SandboxResult {
  status: SandboxStatus;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  detail: string;
}

let dockerCheck: { at: number; ok: boolean } | null = null;

async function dockerAvailable(): Promise<boolean> {
  if (process.env.HUB_SANDBOX === "off") return false;
  const now = Date.now();
  if (dockerCheck && now - dockerCheck.at < 60_000) return dockerCheck.ok;
  try {
    await execFileP("docker", ["info"], { timeout: 3000 });
    dockerCheck = { at: now, ok: true };
    return true;
  } catch {
    dockerCheck = { at: now, ok: false };
    return false;
  }
}

export interface SandboxInput {
  language: "javascript" | "python";
  code: string;
  timeoutMs?: number;
}

export async function runInSandbox(input: SandboxInput): Promise<SandboxResult> {
  const started = Date.now();
  const timeoutMs = input.timeoutMs ?? 30_000;
  if (!(await dockerAvailable())) {
    return {
      status: "unavailable",
      stdout: "",
      stderr: "",
      exitCode: null,
      durationMs: Date.now() - started,
      detail:
        "Docker is not reachable from this backend (or HUB_SANDBOX=off). " +
        "Code cannot be verified here — deploy needs a Docker socket for the app container.",
    };
  }
  const image = input.language === "javascript" ? "node:20-alpine" : "python:3.12-alpine";
  const cmd = input.language === "javascript" ? ["node", "-"] : ["python3", "-"];
  const args = ["run", "--rm", "-i", "--network", "none", "--memory", "256m", "--cpus", "0.5", image, ...cmd];
  try {
    const { stdout, stderr } = await execFileP("docker", args, {
      timeout: timeoutMs,
      input: input.code,
      maxBuffer: 1024 * 1024,
    });
    return {
      status: "passed",
      stdout: stdout.slice(0, 4000),
      stderr: stderr.slice(0, 4000),
      exitCode: 0,
      durationMs: Date.now() - started,
      detail: "Code ran in Docker and exited 0.",
    };
  } catch (err) {
    const e = err as { code?: unknown; stdout?: string; stderr?: string; message?: string; killed?: boolean };
    const timedOut = e.killed === true || String(e.message ?? "").includes("ETIMEDOUT");
    return {
      status: "failed",
      stdout: String(e.stdout ?? "").slice(0, 4000),
      stderr: String(e.stderr ?? e.message ?? "").slice(0, 4000),
      exitCode: typeof e.code === "number" ? e.code : null,
      durationMs: Date.now() - started,
      detail: timedOut ? "Sandbox timed out." : "Code exited non-zero in Docker.",
    };
  }
}
