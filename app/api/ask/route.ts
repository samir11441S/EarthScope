import { aiConfigured, aiProviderLabel, streamAiAnswer, type AskEvent, type AskTurn } from "@/lib/ask-ai";
import { ruleBasedAnswer, type AskInput } from "@/lib/ask-rules";
import { RECORD_START, SCENARIO_END } from "@/lib/climate";
import { allow, clientKey } from "@/lib/rate-limit";

// Ask Earth. Streams newline-delimited JSON events (see AskEvent):
//   AI mode      — Claude (with ANTHROPIC_API_KEY) or a free keyless open model, grounded in EarthScope's data
//   offline mode — the deterministic rule-based guide (no key, rate limit reached, or API error)

const AI_PER_10_MIN = Number(process.env.ASK_EARTH_RATE_LIMIT) || 12;
const AI_DAILY_CAP = Number(process.env.ASK_EARTH_DAILY_LIMIT) || 500;

function validate(body: unknown): { input: AskInput; history: AskTurn[] } | null {
  const b = body as Partial<AskInput> & { history?: unknown };
  const { question, place, data, year, warming, rainChange } = b;
  const ok =
    typeof question === "string" && question.trim().length > 0 && question.length <= 1000 &&
    typeof place?.name === "string" && Number.isFinite(place.lat) && Number.isFinite(place.lon) &&
    Array.isArray(data?.annual) && data.annual.length >= 2 && data.annual.length <= 120 &&
    data.annual.every(a => Number.isFinite(a.temperature) && Number.isFinite(a.rainfall) && Number.isInteger(a.year)) &&
    Number.isInteger(year) && year! >= RECORD_START && year! <= SCENARIO_END &&
    Number.isFinite(warming) && warming! >= 0 && warming! <= 4 &&
    Number.isFinite(rainChange) && Math.abs(rainChange!) <= 40;
  if (!ok) return null;
  const history: AskTurn[] = (Array.isArray(b.history) ? b.history : [])
    .filter((t): t is AskTurn => !!t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string" && t.text.trim().length > 0)
    .slice(-8)
    .map(t => ({ role: t.role, text: t.text.slice(0, 3000) }));
  return { input: b as AskInput, history };
}

export async function POST(request: Request) {
  const bodyText = await request.text();
  if (bodyText.length > 80000) return Response.json({ error: "Request is too large." }, { status: 413 });
  let parsed: ReturnType<typeof validate>;
  try { parsed = validate(JSON.parse(bodyText)); } catch { parsed = null; }
  if (!parsed) return Response.json({ error: "Choose a location and valid climate context." }, { status: 400 });
  const { input, history } = parsed;

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: AskEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      const offline = async (note?: string) => {
        const a = await ruleBasedAnswer(input);
        emit({ type: "text", delta: a.answer });
        emit({ type: "done", followUps: a.followUps, citations: a.citations, mode: "offline", note });
      };
      try {
        if (!aiConfigured()) await offline();
        else if (!(await allow(`ai:${clientKey(request)}`, AI_PER_10_MIN, 10 * 60_000, AI_DAILY_CAP))) await offline("AI question limit reached for now — answered by the offline guide.");
        else {
          let started = false;
          try {
            await streamAiAnswer(input.question.trim(), history, {
              place: input.place, data: input.data, year: input.year, warming: input.warming, rainChange: input.rainChange,
              lang: (input as { lang?: unknown }).lang === "bn" ? "bn" : "en",
            }, e => { if (e.type === "text") started = true; emit(e); }, request.signal);
          } catch (err) {
            if (request.signal.aborted) return;
            console.error("Ask Earth AI error:", err instanceof Error ? err.message : err);
            if (started) emit({ type: "error", message: "The AI answer was interrupted. Please try again." });
            else await offline("The AI service is unavailable right now — answered by the offline guide.");
          }
        }
      } finally {
        try { controller.close(); } catch { /* client went away */ }
      }
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}

/** Lets the chat show whether AI mode is available, without exposing configuration details. */
export function GET() {
  return Response.json({ ai: aiConfigured(), provider: aiProviderLabel() }, { headers: { "Cache-Control": "no-store" } });
}
