// Ask Earth — grounded AI assistant (Claude via the official Anthropic SDK). Server-only.
//
// Claude never answers from memory alone: every request carries a context pack computed by EarthScope
// (break-tested NASA POWER trends, GISTEMP/NSIDC/NOAA global record, IPCC AR6 reference values),
// and four tools reuse EarthScope's own verified features for anything else.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  calculateTrend, observation, parsePower, periodDelta, periodLabels, RECORD_END, RECORD_START, SCENARIO_END,
  trendSummary, trendVerdict, type ClimateData, type NasaPowerRaw, type Place,
} from "./climate";
import { distanceKm } from "./geo";
import { assessSafety, HAZARD_META, inForecastPath, insideNow, isInsideAnyZone, SAFE_PLACE_META, SEVERITY_META } from "./hazards";
import { getHazardFeed } from "./hazard-feed";
import { AR6_SSP245, getNasaGlobalData, GLOBAL_LAST, globalWarmingRate, observedRate, PROJECTION_NOTE, SEA_ICE_REFERENCE } from "./nasa-global-data";
import { findSafePlaces, SAFE_PLACES_SOURCE } from "./safe-places";
import { BMD_LABEL, fetchHeatOutlook, HEAT_META, HEAT_SOURCE } from "./heat";

export type AskEvent =
  | { type: "status"; text: string }
  | { type: "text"; delta: string }
  | { type: "done"; followUps: string[]; citations: string[]; mode: "ai" | "offline"; note?: string; provider?: string }
  | { type: "error"; message: string };

export interface AskTurn { role: "user" | "assistant"; text: string }
export interface AskContext { place: Place; data: ClimateData; year: number; warming: number; rainChange: number; lang?: "en" | "bn" }

const MODEL = process.env.ASK_EARTH_MODEL || "claude-opus-5-5";
// Conversational Q&A over pre-computed data does well at low effort; raise via env if needed.
const EFFORT = (["low", "medium", "high", "xhigh", "max"] as const).find(e => e === process.env.ASK_EARTH_EFFORT) ?? "low";
const MAX_TOOL_ROUNDS = 4;

const claudeConfigured = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const freeAiEnabled = () => process.env.ASK_EARTH_FREE_AI !== "off";
/** Claude when a key is set, otherwise the free provider (unless disabled), otherwise offline only. */
export const aiConfigured = () => claudeConfigured() || freeAiEnabled();
export const aiProviderLabel = () => (claudeConfigured() ? "Claude AI" : freeAiEnabled() ? FREE_LABEL : null);

// ---------------------------------------------------------------------------
// Frozen system prompt (no dates or per-request values, so it caches).
const SYSTEM = `You are **Ask Earth**, the climate and natural-hazard guide inside EarthScope — Climate Time Machine, a NASA Space Apps Challenge app. EarthScope's focus region is Bangladesh (Dhaka, Khulna and the coast), but users may ask about anywhere.

How to answer
- Ground every number in the <terra_context> block or in tool results. Never invent measurements, station records, forecasts, URLs or sources. If the data needed is not available, say so plainly and suggest what would answer it.
- Local climate comes from NASA POWER (MERRA-2 reanalysis, about 50 km grid cells), not a weather station. EarthScope screens every series for abrupt non-climatic steps and only uses the consistent years; when the context reports a data break, mention it briefly if the question touches on trends.
- Use statistics honestly: call something "warming", "cooling", "wetter" or "drier" only when the context marks the trend significant (p < 0.05); otherwise say there is no statistically clear trend yet. Quote 95% confidence intervals when you give a rate.
- Years after ${GLOBAL_LAST} on the global record are a labelled trend extrapolation, not a forecast. For future climate, refer to the IPCC AR6 values in the context. The user's "scenario" settings are a what-if sensitivity test, not a projection.
- For questions about current disasters, safety, evacuation or shelters, call the tools. EarthScope is not an official warning service: always tell people to follow their national disaster authority (Bangladesh: Department of Disaster Management and Bangladesh Meteorological Department), and give the emergency number (Bangladesh 999; India and the EU 112; USA 911) when someone may be in danger. If a person seems to be in immediate danger, lead with the protective action and the emergency number.
- Stay on climate, weather, Earth science, natural hazards, adaptation and EarthScope's data. Politely decline unrelated requests.
- Reply in the language the user writes in (for example বাংলা if they write in Bangla). When the language is unclear (a place name, numbers), use interface_language from the context ("bn" = Bangla, with Bangla digits).

Format (the chat renders only this subset)
- Usually 60–220 words. Lead with the direct answer.
- Allowed: an optional first line starting "### ", lines starting "* " for bullets, "1. " for steps, **bold**, and one line starting "> " for a caveat. No tables, no LaTeX, no code, no markdown links.
- Name the data source in passing (for example "NASA POWER", "GDACS", "NASA GISTEMP").
- End with exactly one final line in this form, written in the user's language but with the English prefix:
Follow-ups: <short question> | <short question> | <short question>`;

// ---------------------------------------------------------------------------
// Context pack

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Compact, model-readable summary of a place's NASA POWER record with EarthScope's statistics. */
export function summarizeRecord(place: Pick<Place, "name" | "country" | "lat" | "lon">, data: ClimateData) {
  const t = calculateTrend(data.annual), p = periodLabels(data), d = periodDelta(data), last = data.annual.at(-1)!;
  return {
    place: `${place.name}, ${place.country} (${place.lat.toFixed(3)}, ${place.lon.toFixed(3)})`,
    source: data.source === "NASA POWER" ? "NASA POWER monthly, MERRA-2 reanalysis, ~50 km grid cell" : "illustrative demo values (NASA data not loaded) — do not present as measurements",
    record_years: `${data.annual[0].year}–${last.year}`,
    data_quality: p.breakNote || "No abrupt non-climatic steps detected.",
    latest_year: { year: last.year, mean_temperature_c: r1(last.temperature), rainfall_mm: Math.round(last.rainfall) },
    temperature_trend: { period: `${t.years[0]}–${t.years[1]}`, verdict: trendVerdict(t), detail: trendSummary(t, "temp"), effective_n: Math.round(t.nEff) },
    rainfall_trend: { period: `${t.rainYears[0]}–${t.rainYears[1]}`, verdict: t.rainDirection, detail: trendSummary(t, "rain") },
    decade_change: {
      temperature: d.temperature === null ? "not enough consistent years" : `${p.recent} vs ${p.base}: ${d.temperature >= 0 ? "+" : ""}${d.temperature.toFixed(2)} °C`,
      rainfall: d.rainfall === null ? "not enough consistent years" : `${p.rainRecent} vs ${p.rainBase}: ${d.rainfall >= 0 ? "+" : ""}${d.rainfall.toFixed(1)} %`,
    },
    annual_series: data.annual.map(a => `${a.year}:${a.temperature.toFixed(2)}°C/${Math.round(a.rainfall)}mm`).join(" "),
  };
}

function globalSummary(year: number) {
  const g = getNasaGlobalData(year), rate = globalWarmingRate(), arctic = observedRate("arcticTempAnomaly"), ice = observedRate("seaIceExtent");
  return {
    year: g.year,
    status: g.projected ? `PROJECTED (trend extrapolation, not measured). ${PROJECTION_NOTE}` : "observed",
    global_temperature_anomaly_c_vs_1951_1980: g.globalTempAnomaly,
    arctic_temperature_anomaly_c: g.arcticTempAnomaly,
    arctic_september_sea_ice_million_km2: g.seaIceExtent,
    sea_ice_change_vs_first_year: `${(((g.seaIceExtent - SEA_ICE_REFERENCE.extent) / SEA_ICE_REFERENCE.extent) * 100).toFixed(0)}% vs ${SEA_ICE_REFERENCE.year}`,
    co2_ppm: g.co2Ppm,
    observed_rates_per_decade: {
      global_temperature: `${rate.perDecade.toFixed(2)} °C (95% CI ${rate.ci95[0].toFixed(2)}–${rate.ci95[1].toFixed(2)}), ${rate.from}–${rate.to}`,
      arctic_temperature: `${arctic.perDecade.toFixed(2)} °C (${(arctic.perDecade / rate.perDecade).toFixed(1)}× global)`,
      arctic_sea_ice: `${ice.perDecade.toFixed(2)} million km²`,
    },
    ipcc_ar6_ssp2_4_5_vs_1850_1900: `${AR6_SSP245.near.period}: ${AR6_SSP245.near.best.toFixed(1)} °C (${AR6_SSP245.near.range.join("–")}); ${AR6_SSP245.mid.period}: ${AR6_SSP245.mid.best.toFixed(1)} °C (${AR6_SSP245.mid.range.join("–")}); ${AR6_SSP245.long.period}: ${AR6_SSP245.long.best.toFixed(1)} °C (${AR6_SSP245.long.range.join("–")}). Source: ${AR6_SSP245.source}`,
    sources: "NASA GISTEMP v4, NSIDC Sea Ice Index v4, NOAA GML Mauna Loa CO2",
  };
}

function contextBlock(ctx: AskContext) {
  const scenario = observation(ctx.data, SCENARIO_END, ctx.warming, ctx.rainChange);
  const pack = {
    today_utc: new Date().toISOString().slice(0, 10),
    interface_language: ctx.lang ?? "en",
    selected_place: summarizeRecord(ctx.place, ctx.data),
    selected_year: ctx.year,
    user_scenario: `What-if test chosen by the user: ${ctx.warming >= 0 ? "+" : ""}${ctx.warming.toFixed(1)} °C and ${ctx.rainChange >= 0 ? "+" : ""}${ctx.rainChange}% rainfall by ${SCENARIO_END}, applied linearly to the ${RECORD_END} value → ${SCENARIO_END}: ${scenario.temperature.toFixed(1)} °C, ${Math.round(scenario.rainfall)} mm. Not a projection.`,
    global_context: globalSummary(Math.min(Math.max(ctx.year, RECORD_START), SCENARIO_END)),
  };
  return `<terra_context>\n${JSON.stringify(pack, null, 1)}\n</terra_context>`;
}

// ---------------------------------------------------------------------------
// Tools — each reuses an existing EarthScope feature. Inputs are validated with zod before use.

const ClimateInput = z.object({ place: z.string().trim().min(2).max(120) });
const PointInput = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });
const HazardInput = PointInput.extend({ radius_km: z.number().min(10).max(5000) });
const GlobalInput = z.object({ year: z.number().int().min(RECORD_START).max(SCENARIO_END) });
const HeatInput = PointInput;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "get_climate_record",
    description: `NASA POWER annual temperature and rainfall (${RECORD_START}–${RECORD_END}) for any named city or region, with EarthScope's break-tested, significance-tested trends and decade comparison. Use to compare places or answer about a place other than the selected one.`,
    input_schema: { type: "object", properties: { place: { type: "string", description: "City or region name, optionally with country, e.g. 'Khulna, Bangladesh'" } }, required: ["place"], additionalProperties: false },
    eager_input_streaming: true,
  },
  {
    name: "get_live_hazards",
    description: "Natural hazards happening now (reported in the last 24 h or still active) near a point, merged from NASA EONET, GDACS and USGS: type, current alert level, distance, whether the point is inside the measured footprint, and cyclone forecast arrival times. Also returns a safety assessment for the point.",
    input_schema: { type: "object", properties: { latitude: { type: "number" }, longitude: { type: "number" }, radius_km: { type: "number", description: "Search radius in km (10–5000). Use ~1000 for a city, 5000 for a region." } }, required: ["latitude", "longitude", "radius_km"], additionalProperties: false },
    eager_input_streaming: true,
  },
  {
    name: "find_safe_places",
    description: "Emergency shelters, cyclone shelters, assembly points, hospitals and fire stations within ~12 km of a point (OpenStreetMap), excluding any inside a current hazard footprint, nearest first.",
    input_schema: { type: "object", properties: { latitude: { type: "number" }, longitude: { type: "number" } }, required: ["latitude", "longitude"], additionalProperties: false },
    eager_input_streaming: true,
  },
  {
    name: "get_heat_outlook",
    description: "7-day heat forecast for a point: daily maximum temperature, NWS heat index (feels-like with humidity) and its danger category, and the Bangladesh Meteorological Department heatwave class.",
    input_schema: { type: "object", properties: { latitude: { type: "number" }, longitude: { type: "number" } }, required: ["latitude", "longitude"], additionalProperties: false },
    eager_input_streaming: true,
  },
  {
    name: "get_global_climate",
    description: `Global climate indicators for a year (${RECORD_START}–${SCENARIO_END}): NASA GISTEMP global and Arctic temperature anomaly, Arctic September sea ice, Mauna Loa CO2, observed rates, and IPCC AR6 reference warming. Years after ${GLOBAL_LAST} are labelled trend extrapolations.`,
    input_schema: { type: "object", properties: { year: { type: "integer" } }, required: ["year"], additionalProperties: false },
    eager_input_streaming: true,
  },
];

const STATUS: Record<string, (i: Record<string, unknown>) => string> = {
  get_climate_record: i => `Reading NASA POWER records for ${String(i.place ?? "a place")}…`,
  get_live_hazards: () => "Checking live hazards (NASA EONET · GDACS · USGS)…",
  find_safe_places: () => "Searching nearby shelters and hospitals…",
  get_global_climate: i => `Looking up the global record for ${String(i.year ?? "")}…`,
  get_heat_outlook: () => "Checking the 7-day heat forecast…",
};

async function geocode(name: string) {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name.split(",")[0].trim())}&count=5&language=en&format=json`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("Place search is unavailable.");
  const j = (await r.json()) as { results?: { name: string; country?: string; latitude: number; longitude: number; admin1?: string }[] };
  const country = name.includes(",") ? name.split(",").slice(1).join(",").trim().toLowerCase() : "";
  const hit = j.results?.find(x => !country || (x.country ?? "").toLowerCase().includes(country)) ?? j.results?.[0];
  if (!hit) throw new Error(`No place called "${name}" was found.`);
  return { name: hit.name, country: hit.country ?? "", lat: hit.latitude, lon: hit.longitude };
}

export async function runTool(name: string, input: unknown): Promise<unknown> {
  switch (name) {
    case "get_climate_record": {
      const { place } = ClimateInput.parse(input);
      const g = await geocode(place);
      const url = `https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=T2M,PRECTOTCORR&community=RE&longitude=${g.lon.toFixed(4)}&latitude=${g.lat.toFixed(4)}&start=${RECORD_START}&end=${RECORD_END}&format=JSON`;
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error("NASA POWER is temporarily unavailable.");
      return summarizeRecord(g, parsePower((await r.json()) as NasaPowerRaw));
    }
    case "get_live_hazards": {
      const { latitude, longitude, radius_km } = HazardInput.parse(input);
      const feed = await getHazardFeed();
      const hazards = feed.hazards.filter(h => h.type !== "ice");
      const nearby = hazards
        .map(h => ({ h, d: distanceKm(latitude, longitude, h.lat, h.lon), eta: inForecastPath(h, latitude, longitude) }))
        .filter(x => x.d <= radius_km || x.eta)
        .sort((a, b) => a.d - b.d)
        .slice(0, 15)
        .map(({ h, d, eta }) => ({
          title: h.title, type: HAZARD_META[h.type].label, alert: SEVERITY_META[h.severity].label, phase: h.phase === "new" ? "new in last 24 h" : "ongoing",
          distance_km: Math.round(d), updated_utc: h.date, point_inside_current_footprint: insideNow(h, latitude, longitude),
          forecast_passes_point_at_utc: eta?.eta ?? null, detail: h.detail ?? null, sources: h.sources.map(s => s.name).join(", "),
        }));
      const safety = assessSafety(latitude, longitude, hazards);
      return {
        feed_updated_utc: feed.updated, feeds: feed.feeds.map(f => `${f.name}: ${f.ok ? "ok" : "unreachable"}`).join("; "),
        point_status: safety.level === "danger" ? "inside a current hazard footprint" : safety.level === "caution" ? "near an active hazard or in a forecast path" : "no current or forecast hazard at this point",
        events_within_radius: nearby, total_active_events_worldwide: hazards.length,
        note: "Footprints are agency-measured where available (GDACS cyclone wind zones, flood areas), otherwise approximate radii. Not an official warning.",
      };
    }
    case "find_safe_places": {
      const { latitude, longitude } = PointInput.parse(input);
      const [places, feed] = await Promise.all([findSafePlaces(latitude, longitude, 12), getHazardFeed().catch(() => null)]);
      const hazards = feed?.hazards ?? [];
      const nearest = places
        .filter(p => !isInsideAnyZone(p.lat, p.lon, hazards))
        .map(p => ({ name: p.name, kind: SAFE_PLACE_META[p.kind].label, distance_km: Math.round(distanceKm(latitude, longitude, p.lat, p.lon) * 10) / 10 }))
        .sort((a, b) => a.distance_km - b.distance_km);
      // Variety matters for safety advice: the nearest two of each kind (shelter, hospital, …), then by distance.
      const perKind = new Map<string, number>();
      const ranked = nearest.filter(p => { const n = perKind.get(p.kind) ?? 0; perKind.set(p.kind, n + 1); return n < 2; }).slice(0, 10);
      return { safe_places_outside_hazard_zones: ranked, searched_radius_km: 12, source: SAFE_PLACES_SOURCE, note: "Community-mapped data; facilities may be missing or closed. Follow official evacuation orders." };
    }
    case "get_heat_outlook": {
      const { latitude, longitude } = HeatInput.parse(input);
      const [o] = await fetchHeatOutlook([{ lat: latitude, lon: longitude }]);
      return {
        days: o.days.map(d => ({ date: d.date, max_temperature_c: d.tmax, heat_index_max_c: d.heatIndexMax, category: HEAT_META[d.level].label, bmd_heatwave: BMD_LABEL[d.bmd] })),
        thresholds: "NWS heat index: 27 caution, 32 extreme caution, 41 danger, 54 extreme danger (°C). BMD heatwave by max temperature: 36 mild, 38 moderate, 40 severe, 42 very severe.",
        source: HEAT_SOURCE,
      };
    }
    case "get_global_climate": {
      const { year } = GlobalInput.parse(input);
      return globalSummary(year);
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Streaming conversation with the tool loop. Hides the trailing "Follow-ups:" line from the text stream.

export function followUpFilter(emit: (e: AskEvent) => void) {
  let pending = "", lineIsText = false, followUps: string[] = [];
  // Models vary the marker: Unicode hyphens (‑ –), "Follow ups", "Follow-up", or **bold**. Normalise first.
  const norm = (s: string) => s.replace(/[‐-―−﹣－]/g, "-").replace(/\*/g, "").trimStart().toLowerCase();
  const MARKERS = ["follow-ups:", "follow ups:", "follow-up:", "follow up:", "followups:"];
  const FOLLOW_RE = /^follow[ -]?ups?\s*:\s*(.+)$/;
  const isFollowPrefix = (s: string) => { const t = norm(s); return FOLLOW_RE.test(t) || MARKERS.some(m => m.startsWith(t) || t.startsWith(m)); };
  const finishLine = (line: string) => {
    const m = norm(line).match(FOLLOW_RE) ? line.replace(/[‐-―−﹣－]/g, "-").replace(/\*/g, "").match(/follow[ -]?ups?\s*:\s*(.+)$/i) : null;
    if (m) {
      let parts = m[1].split("|").map(s => s.trim()).filter(Boolean);
      // Some models separate the questions with just "?" — split those too.
      if (parts.length === 1) parts = parts[0].split(/(?<=[?？।])\s+/).map(s => s.trim()).filter(Boolean);
      followUps = parts.slice(0, 4);
    }
    else emit({ type: "text", delta: line + "\n" });
  };
  return {
    push(delta: string) {
      for (const ch of delta.split(/(\n)/)) {
        if (ch === "\n") {
          if (lineIsText) emit({ type: "text", delta: "\n" }); else finishLine(pending);
          pending = ""; lineIsText = false;
        } else if (ch) {
          if (lineIsText) { emit({ type: "text", delta: ch }); continue; }
          pending += ch;
          if (!isFollowPrefix(pending)) { emit({ type: "text", delta: pending }); pending = ""; lineIsText = true; }
        }
      }
    },
    end() { if (pending && !lineIsText) finishLine(pending); return followUps; },
  };
}

export async function streamAiAnswer(question: string, history: AskTurn[], ctx: AskContext, emit: (e: AskEvent) => void, signal?: AbortSignal) {
  if (!claudeConfigured()) return streamFreeAnswer(question, history, ctx, emit, signal);
  const client = new Anthropic({ maxRetries: 1, timeout: 55_000 });
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const t of history) {
    if (!messages.length && t.role !== "user") continue; // conversation must start with the user
    messages.push({ role: t.role, content: t.text });
  }
  messages.push({ role: "user", content: [{ type: "text", text: contextBlock(ctx) }, { type: "text", text: question }] });

  const filter = followUpFilter(emit);
  const used = new Set<string>();
  let jsonRetries = 0;
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // a safety decline is retried server-side on a suitable model
      output_config: { effort: EFFORT },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      // Last round: the tools stay defined (history contains tool calls) but Claude must answer.
      tool_choice: round < MAX_TOOL_ROUNDS ? { type: "auto" } : { type: "none" },
      messages,
    }, { signal });
    stream.on("text", delta => filter.push(delta));

    // With eager input streaming, finalMessage() rejects if a tool input is not parseable JSON.
    // Only that case is re-issued (once); API errors propagate to the caller's fallback.
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      if (err instanceof Anthropic.APIError || signal?.aborted || jsonRetries++ >= 1) throw err;
      round--;
      continue;
    }

    if (message.stop_reason === "refusal") {
      filter.push("\nI can't help with that request, but I'm happy to answer questions about climate, weather or natural hazards.");
      break;
    }
    const calls = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    // end_turn, max_tokens (never run a possibly truncated tool input) or no calls: the answer is complete.
    if (message.stop_reason !== "tool_use" || !calls.length) break;

    messages.push({ role: "assistant", content: message.content });
    const results = await Promise.all(calls.map(async (call): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
      const input = (call.input ?? {}) as Record<string, unknown>;
      emit({ type: "status", text: (STATUS[call.name] ?? (() => "Working…"))(input) });
      used.add(call.name);
      try {
        return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(await runTool(call.name, input)) };
      } catch (e) {
        const msg = e instanceof z.ZodError ? `Invalid input: ${e.issues.map(i => `${i.path.join(".")} ${i.message}`).join("; ")}` : e instanceof Error ? e.message : "Tool failed";
        return { type: "tool_result", tool_use_id: call.id, content: msg, is_error: true };
      }
    }));
    messages.push({ role: "user", content: results });
  }

  const citations = ["NASA POWER / MERRA-2 (power.larc.nasa.gov)", "NASA GISTEMP v4 · NSIDC Sea Ice Index v4 · NOAA GML", AR6_SSP245.source];
  if (used.has("get_live_hazards") || used.has("find_safe_places")) citations.push("NASA EONET · GDACS · USGS live feeds");
  if (used.has("find_safe_places")) citations.push(SAFE_PLACES_SOURCE);
  if (used.has("get_heat_outlook")) citations.push(HEAT_SOURCE);
  emit({ type: "done", followUps: filter.end(), citations, mode: "ai", provider: "Claude AI" });
}

// ---------------------------------------------------------------------------
// Free provider: any OpenAI-compatible chat endpoint. Default is Pollinations' keyless anonymous tier
// (open model GPT-OSS 20B), so Ask Earth has AI answers with no account or key. Set
// ASK_EARTH_OPENAI_URL / ASK_EARTH_OPENAI_KEY / ASK_EARTH_OPENAI_MODEL to use another free service
// (e.g. Groq or Google Gemini's OpenAI-compatible endpoint). Smaller open models do not get tools:
// EarthScope fetches the live data the question needs and the model only writes the answer from it.

const FREE_URL = process.env.ASK_EARTH_OPENAI_URL || "https://text.pollinations.ai/openai";
const FREE_KEY = process.env.ASK_EARTH_OPENAI_KEY || "";
const FREE_MODEL = process.env.ASK_EARTH_OPENAI_MODEL || "openai";
export const FREE_LABEL = process.env.ASK_EARTH_OPENAI_LABEL || (process.env.ASK_EARTH_OPENAI_URL ? "Free AI model" : "Free open model (GPT-OSS via Pollinations)");

const FREE_NOTE = `

In this deployment you cannot call tools. Before your turn, EarthScope has already fetched any live data relevant to the question into a <live_data> block (live hazards, safe places, heat forecast, another place's record). Use only that data and <terra_context>. If the data needed is not there, say so and point the user to Terra's "Live disasters" page or the official source — never guess numbers.`;

/** Live data a question needs, fetched by EarthScope itself (the same verified tools Claude would call). */
async function gatherLiveData(question: string, ctx: AskContext, emit: (e: AskEvent) => void) {
  const q = question.toLowerCase(), at = { latitude: ctx.place.lat, longitude: ctx.place.lon };
  const jobs: [string, unknown][] = [];
  if (/disaster|hazard|cyclone|storm|earthquake|flood|danger|alert|warning|right now|currently|active|wildfire|volcano|safe|দুর্যোগ|ঘূর্ণিঝড়|বন্যা|নিরাপদ/.test(q)) jobs.push(["get_live_hazards", { ...at, radius_km: 1500 }]);
  if (/shelter|safe place|hospital|evacuat|where (can|should) i go|assembly|আশ্রয়|হাসপাতাল/.test(q)) jobs.push(["find_safe_places", at]);
  if (/heat|hot|feels like|heatwave|this week|tomorrow|forecast|তাপ|গরম/.test(q)) jobs.push(["get_heat_outlook", at]);
  const cmp = question.match(/compare\s+.+?\s+(?:with|to|and|vs\.?)\s+(.+?)[?.!]*$/i) || question.match(/\b(?:than|versus|vs\.?)\s+([^?.!]{2,60})[?.!]*$/i);
  if (cmp) jobs.push(["get_climate_record", { place: cmp[1].trim() }]);
  const out: Record<string, unknown> = {};
  await Promise.all(jobs.slice(0, 4).map(async ([name, input]) => {
    emit({ type: "status", text: (STATUS[name] ?? (() => "Working…"))(input as Record<string, unknown>) });
    try { out[name] = await runTool(name, input); } catch (e) { out[name] = { error: e instanceof Error ? e.message : "unavailable" }; }
  }));
  return out;
}

async function streamFreeAnswer(question: string, history: AskTurn[], ctx: AskContext, emit: (e: AskEvent) => void, signal?: AbortSignal) {
  const live = await gatherLiveData(question, ctx, emit);
  const liveBlock = Object.keys(live).length ? `\n<live_data>\n${JSON.stringify(live, null, 1)}\n</live_data>` : "";
  const messages = [
    { role: "system", content: SYSTEM + FREE_NOTE },
    ...history.filter((t, i) => i > 0 || t.role === "user").map(t => ({ role: t.role, content: t.text })),
    { role: "user", content: `${contextBlock(ctx)}${liveBlock}\n\nQuestion: ${question}` },
  ];
  emit({ type: "status", text: "Thinking it through…" });
  const timeout = AbortSignal.timeout(55_000);
  const res = await fetch(FREE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...(FREE_KEY ? { Authorization: `Bearer ${FREE_KEY}` } : {}) },
    body: JSON.stringify({ model: FREE_MODEL, messages, stream: true, temperature: 0.3 }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!res.ok || !res.body) throw new Error(`Free AI provider returned ${res.status}`);

  const filter = followUpFilter(emit);
  const reader = res.body.getReader(), decoder = new TextDecoder();
  let buf = "", got = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const delta = (JSON.parse(data) as { choices?: { delta?: { content?: string | null } }[] }).choices?.[0]?.delta?.content;
        if (delta) { got = true; filter.push(delta); } // reasoning tokens arrive in other fields and are ignored
      } catch { /* keep-alive or partial line */ }
    }
  }
  if (!got) throw new Error("Free AI provider returned no answer");

  const citations = ["NASA POWER / MERRA-2 (power.larc.nasa.gov)", "NASA GISTEMP v4 · NSIDC Sea Ice Index v4 · NOAA GML", AR6_SSP245.source];
  if (live.get_live_hazards) citations.push("NASA EONET · GDACS · USGS live feeds");
  if (live.find_safe_places) citations.push(SAFE_PLACES_SOURCE);
  if (live.get_heat_outlook) citations.push(HEAT_SOURCE);
  citations.push(`Answer written by ${FREE_LABEL}`);
  emit({ type: "done", followUps: filter.end(), citations, mode: "ai", provider: FREE_LABEL });
}
