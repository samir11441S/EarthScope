import { allow, clientKey } from "@/lib/rate-limit";

// Receives client error reports (lib/telemetry.ts) and writes them to the function logs as one
// structured JSON line each. Rate-limited and size-capped; nothing is stored.
export async function POST(request: Request) {
  if (!(await allow(`log:${clientKey(request)}`, 30, 60_000, 5000))) return new Response(null, { status: 429 });
  try {
    const text = (await request.text()).slice(0, 4000);
    const j = JSON.parse(text) as Record<string, unknown>;
    const pick = (k: string, max: number) => String(j[k] ?? "").slice(0, max);
    console.error(JSON.stringify({ type: "client-error", context: pick("context", 60), message: pick("message", 500), page: pick("page", 120), at: pick("at", 40), stack: pick("stack", 1500), ua: (request.headers.get("user-agent") || "").slice(0, 160) }));
  } catch { /* malformed report: ignore */ }
  return new Response(null, { status: 204 });
}
