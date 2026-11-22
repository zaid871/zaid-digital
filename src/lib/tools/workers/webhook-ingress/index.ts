/**
 * Webhook ingress — Cloudflare Worker in front of the VM's Instagram /
 * Facebook webhooks (auto-DM, comment handling).
 *
 * Why a Worker: the free tier allows 100,000 requests/day with 10 ms
 * CPU — enough to verify every incoming webhook signature and forward
 * only the real events, so junk never touches the VM or n8n. The VM
 * keeps doing the heavy work; this is routing only.
 *
 * Flow:
 *   1. Meta's verification GET (hub.mode=subscribe) → answered here
 *      with the challenge when hub.verify_token matches.
 *   2. POST events → X-Hub-Signature-256 is HMAC-verified against
 *      META_APP_SECRET (timing-safe compare). Bad signature → 401.
 *   3. Only object=instagram / object=page events are forwarded.
 *   4. Forwarding happens in ctx.waitUntil so Meta gets its 200
 *      immediately; the VM webhook URL answers the actual event.
 *
 * Deployed 2026-11-22 (wrangler 4.86.0, node:20-slim container on the
 * VM) → https://toolbox-webhook-ingress.sahz7890.workers.dev; secrets
 * META_APP_SECRET + META_VERIFY_TOKEN set via the Cloudflare API;
 * Meta subscription ACTIVE (instagram, comments). Redeploy:
 *   cd src/lib/tools/workers/webhook-ingress
 *   wrangler secret put META_APP_SECRET
 *   wrangler secret put META_VERIFY_TOKEN
 *   wrangler deploy
 *
 * Set VM_WEBHOOK_URL in wrangler.toml to the n8n Instagram webhook URL
 * before deploying. No secret ever lives in this file.
 */

interface Env {
  VM_WEBHOOK_URL: string;
  META_APP_SECRET: string;
  META_VERIFY_TOKEN: string;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function verifySignature(secret: string, body: ArrayBuffer, signature: string): Promise<boolean> {
  const expected = signature.startsWith("sha256=") ? signature.slice("sha256=".length) : signature;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, body);
  const hex = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return timingSafeEqual(hex, expected.toLowerCase());
}

const webhookIngress = {
  async fetch(
    request: Request,
    env: Env,
    ctx: { waitUntil(p: Promise<unknown>): void }
  ): Promise<Response> {
    const url = new URL(request.url);

    // Meta's webhook verification handshake.
    if (request.method === "GET" && url.pathname === "/webhook") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode === "subscribe" && token && token === env.META_VERIFY_TOKEN && challenge) {
        return new Response(challenge, { status: 200 });
      }
      return new Response("Forbidden", { status: 403 });
    }

    if (request.method !== "POST" || url.pathname !== "/webhook") {
      return new Response("Not Found", { status: 404 });
    }
    if (!env.VM_WEBHOOK_URL) {
      return new Response("VM_WEBHOOK_URL is not configured.", { status: 500 });
    }
    const signature = request.headers.get("X-Hub-Signature-256") ?? "";
    const body = await request.arrayBuffer();
    if (!signature || !(await verifySignature(env.META_APP_SECRET, body, signature))) {
      return new Response("Bad signature.", { status: 401 });
    }
    let parsed: { object?: string };
    try {
      parsed = JSON.parse(new TextDecoder().decode(body)) as { object?: string };
    } catch {
      return new Response("Bad JSON.", { status: 400 });
    }
    if (parsed.object !== "instagram" && parsed.object !== "page") {
      return new Response("Ignored.", { status: 200 });
    }
    ctx.waitUntil(
      fetch(env.VM_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-By": "toolbox-webhook-ingress" },
        body,
      }).catch((err: unknown) => {
        console.error("forward failed:", err instanceof Error ? err.message : String(err));
      })
    );
    return new Response("OK", { status: 200 });
  },
};

export default webhookIngress;
