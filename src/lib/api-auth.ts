/**
 * n8n shared-secret check for backend routes called by workflows.
 * Mirrors the stage-callback route: the secret is required when
 * N8N_WEBHOOK_SECRET is set, optional when unset (dev mode).
 * Returns an error message, or null when the call is authorized.
 */
import { timingSafeEqual } from "crypto";

export function checkN8nSecret(request: Request): string | null {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!secret) return null;
  const provided = request.headers.get("x-n8n-secret") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return "Invalid or missing x-n8n-secret.";
  }
  return null;
}
