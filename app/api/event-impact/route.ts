import { geometryBBox, polygonsOf, type Geometry } from "@/lib/geo";
import { getHazardFeed } from "@/lib/hazard-feed";
import type { Hazard } from "@/lib/hazards";

// People exposed and (for cyclones) storm surge for one live event, computed on demand.
//   • Cyclones: GDACS population inside the 39 mph (tropical-storm) and 74 mph (hurricane) wind
//     buffers, and peak storm surge from the GDACS surge models (ECMWF / HWRF / GFS).
//   • Everything else: WorldPop 2020 (100 m) population inside the agency footprint, or inside the
//     approximate impact radius when no footprint is published.

const UA = { "User-Agent": "earthscope-climate-time-machine/1.0 (NASA Space Apps Challenge)", Accept: "application/json" };
const MAX_RADIUS_KM = 150; // WorldPop's synchronous statistics stop answering for much larger areas

export interface EventImpact {
  people: { value: number; label: string; method: string; source: string }[];
  surge?: { models: { model: string; maxHeightM: number; maxRainMm?: number }[]; rangeM: [number, number]; level: string; mapUrl?: string; source: string };
  note?: string;
}

const memo = new Map<string, { until: number; value: Promise<EventImpact> }>();
const get = async <T,>(url: string, ms = 20000) => { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) }); if (!r.ok) throw new Error(String(r.status)); return (await r.json()) as T; };

function circle(lat: number, lon: number, km: number, n = 48): Geometry {
  const ring: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = (2 * Math.PI * i) / n;
    ring.push([+(lon + (km / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.cos(a)).toFixed(4), +(lat + (km / 110.57) * Math.sin(a)).toFixed(4)]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

const approxAreaKm2 = (g: Geometry) => { const [x0, y0, x1, y1] = geometryBBox(g); return (x1 - x0) * 111.32 * Math.cos((((y0 + y1) / 2) * Math.PI) / 180) * (y1 - y0) * 110.57; };

/** Convex hull of all outer-ring vertices: always a valid polygon, a slight over-estimate of the footprint. */
function hull(g: Geometry): Geometry {
  const pts = polygonsOf(g).flatMap(p => p[0]).map(([x, y]) => [x, y] as [number, number]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (const p of [...pts].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  const ring = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  ring.push(ring[0]);
  return { type: "Polygon", coordinates: [ring] };
}

async function worldPop(g: Geometry): Promise<number | null> {
  const fc = { type: "FeatureCollection", features: polygonsOf(g).map(coords => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: coords } })) };
  const url = new URL("https://api.worldpop.org/v1/services/stats");
  url.search = new URLSearchParams({ dataset: "wpgppop", year: "2020", geojson: JSON.stringify(fc), runasync: "false" }).toString();
  type Stats = { status?: string; error?: boolean; error_message?: string; taskid?: string; data?: { total_population?: number } };
  let j = await get<Stats>(url.toString(), 40000);
  // Slow requests come back "finished" without data; the result is on the task endpoint.
  for (let i = 0; i < 3 && !j.error && j.data?.total_population === undefined && j.taskid; i++) {
    await new Promise(r => setTimeout(r, 1500));
    j = await get<Stats>(`https://api.worldpop.org/v1/tasks/${j.taskid}`);
  }
  const v = j.data?.total_population;
  return !j.error && Number.isFinite(v) ? Math.round(v!) : null;
}

/** Reads the population figure from a GDACS impact export (scalar named SUMPOP…). */
function sumPop(x: unknown): number | null {
  const s = JSON.stringify(x);
  const m = s.match(/"name":"SUMPOP[^"]*","value":"(\d+)"/);
  return m ? Number(m[1]) : null;
}

async function cycloneImpact(h: Hazard): Promise<EventImpact> {
  const eventid = h.id.split("_")[2];
  type EventData = { properties: { impacts?: { resource?: Record<string, string> }[]; cyclonesurge?: { source: string; data: { url: string; last: boolean }[] }[]; images?: Record<string, string> } };
  const ev = await get<EventData>(`https://www.gdacs.org/gdacsapi/api/events/geteventdata?eventtype=TC&eventid=${eventid}`);
  const res = ev.properties.impacts?.[0]?.resource ?? {};
  const [ts, hu] = await Promise.all([
    res.buffer39 ? get<unknown>(res.buffer39).then(sumPop).catch(() => null) : null,
    res.buffer74 ? get<unknown>(res.buffer74).then(sumPop).catch(() => null) : null,
  ]);
  const people: EventImpact["people"] = [];
  if (ts !== null) people.push({ value: ts, label: "in tropical-storm winds (≥ 63 km/h)", method: "GDACS wind-buffer population over the storm's track and forecast", source: "GDACS (EC JRC / UN OCHA)" });
  if (hu !== null && hu > 0) people.push({ value: hu, label: "in hurricane-force winds (≥ 119 km/h)", method: "GDACS wind-buffer population", source: "GDACS (EC JRC / UN OCHA)" });

  const models = (await Promise.all((ev.properties.cyclonesurge ?? []).map(async s => {
    const last = s.data.find(d => d.last) ?? s.data[0];
    if (!last) return null;
    try {
      const d = await get<{ properties: { maxheight?: number; maxrain?: number } }>(last.url);
      return Number.isFinite(d.properties.maxheight) && d.properties.maxheight! >= 0 ? { model: s.source, maxHeightM: Math.round(d.properties.maxheight! * 100) / 100, maxRainMm: d.properties.maxrain } : null;
    } catch { return null; }
  }))).filter((m): m is NonNullable<typeof m> => !!m);
  let surge: EventImpact["surge"];
  if (models.length) {
    const hs = models.map(m => m.maxHeightM), lo = Math.min(...hs), hi = Math.max(...hs);
    const level = hi >= 4 ? "Extreme — life-threatening coastal inundation" : hi >= 2 ? "Very dangerous — evacuate low coasts and islands" : hi >= 1 ? "Dangerous — flooding of low-lying coast" : "Low";
    const imgs = ev.properties.images ?? {};
    surge = { models, rangeM: [lo, hi], level, mapUrl: imgs.storm_surge_maxheight_end_ECMWF ?? imgs.storm_surge_maxheight_ECMWF ?? imgs.storm_surge_maxheight_GFS, source: "GDACS storm-surge models (ECMWF, HWRF, GFS)" };
  }
  return { people, surge, note: people.length ? undefined : "GDACS has not published population figures for this storm yet." };
}

async function genericImpact(h: Hazard): Promise<EventImpact> {
  const footprint = h.zones?.length ? h.zones.reduce((a, z) => (approxAreaKm2(z.geometry) > approxAreaKm2(a.geometry) ? z : a)).geometry : null;
  if (footprint && approxAreaKm2(footprint) <= Math.PI * MAX_RADIUS_KM ** 2) {
    const v = await worldPop(hull(footprint)).catch(() => null);
    if (v !== null) return { people: [{ value: v, label: h.type === "flood" ? "inside the mapped flood area" : "inside the measured footprint", method: "WorldPop 2020 population inside the outline of the agency footprint (convex hull)", source: "WorldPop (University of Southampton)" }] };
    // fall through to the approximate radius if the footprint request fails
  }
  if (h.radiusKm > MAX_RADIUS_KM) return { people: [], note: `This event's zone (${h.radiusKm} km radius) is too large for a quick population estimate.` };
  const v = await worldPop(circle(h.lat, h.lon, h.radiusKm));
  return v === null ? { people: [], note: "Population estimate unavailable right now." }
    : { people: [{ value: v, label: `within ${h.radiusKm} km (approximate impact zone)`, method: "WorldPop 2020 population inside an approximate radius — an upper-bound screening figure", source: "WorldPop (University of Southampton)" }] };
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[\w.-]{3,80}$/.test(id)) return Response.json({ error: "Unknown event." }, { status: 400 });
  const feed = await getHazardFeed().catch(() => null);
  const h = feed?.hazards.find(x => x.id === id);
  if (!h) return Response.json({ error: "This event is no longer active." }, { status: 404 });
  let hit = memo.get(id);
  if (!hit || hit.until < Date.now()) {
    const value = (h.id.startsWith("GDACS_TC") ? cycloneImpact(h) : genericImpact(h));
    hit = { until: Date.now() + 3 * 3_600_000, value };
    memo.set(id, hit);
    value.catch(() => memo.delete(id));
  }
  try {
    return Response.json(await hit.value, { headers: { "Cache-Control": "public, max-age=1800" } });
  } catch {
    return Response.json({ error: "Impact estimate is unavailable right now." }, { status: 502 });
  }
}
