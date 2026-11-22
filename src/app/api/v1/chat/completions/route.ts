import { handleChatCompletion, listChatModels } from "@/lib/hub/chat-compat";

/**
 * POST /api/v1/chat/completions — OpenAI-compatible chat completions
 * over the hub (see src/lib/hub/chat-compat.ts for the honest limits:
 * text only, stream:true arrives as one SSE chunk, usage is estimated).
 *
 * Any OpenAI-compatible client can point here:
 *   base_url: https://<vm>/api/v1/chat
 *   api_key:  $CHAT_API_KEY (or $N8N_WEBHOOK_SECRET)
 *   model:    "hub" (ensemble, default) or "hub-fast" (single fast leg)
 *
 * Auth is a Bearer key, NOT the v1 envelope — OpenAI clients would not
 * understand the envelope. Errors are OpenAI-shaped too.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { message: "Request body must be valid JSON.", type: "invalid_request_error", code: "invalid_json" } },
      { status: 400 }
    );
  }
  const result = await handleChatCompletion(body, request.headers.get("authorization"));
  if (result.isSse) {
    return new Response(result.sse, {
      status: result.status,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }
  return Response.json(result.json, { status: result.status });
}

/** GET /api/v1/chat/completions — model list (same shape as OpenAI /v1/models). */
export async function GET() {
  return Response.json(listChatModels());
}
