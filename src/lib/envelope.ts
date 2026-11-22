import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

/**
 * Versioned JSON envelope for all v1 API responses.
 * Every response carries a requestId for tracing and never leaks secrets.
 */

export interface ApiSuccess<T> {
  ok: true;
  apiVersion: "v1";
  requestId: string;
  data: T;
}

export interface ApiErrorBody {
  ok: false;
  apiVersion: "v1";
  requestId: string;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function success<T>(data: T, status = 200): NextResponse<ApiSuccess<T>> {
  return NextResponse.json(
    { ok: true, apiVersion: "v1", requestId: randomUUID(), data },
    { status }
  );
}

export function failure(
  code: string,
  message: string,
  status = 400,
  details?: unknown
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    {
      ok: false,
      apiVersion: "v1",
      requestId: randomUUID(),
      error: { code, message, details },
    },
    { status }
  );
}

/** Redact anything secret-shaped before logging / echoing. */
export function redactSecrets(value: unknown): unknown {
  const SECRET_KEYS =
    /key|token|secret|password|auth|credential|private|bearer|session/i;
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? "[REDACTED]" : redactSecrets(v);
    }
    return out;
  }
  return value;
}
