import { distanceKm, simplifyGeometry, type Geometry } from "@/lib/geo";
import { impactRadius, SEVERITY_META, type ForecastPoint, type Hazard, type HazardFeed, type HazardType, type Phase, type Severity, type Zone } from "@/lib/hazards";

// Live natural hazards merged from NASA EONET, GDACS (UN / EC JRC) and USGS. Server-only module
// shared by /api/disasters and the Ask Earth assistant.
// Only events that are NEW (reported in the last 24 h) or ONGOING (still active and updated
// recently) are returned; cyclones also carry their official forecast track, cone and wind zones.
const UA = { "User-Agent": "earthscope-climate-time-machine/1.0 (NASA Space Apps Challenge)" };
const HOUR = 3_600_000, DAY = 24 * HOUR;
const NEW_WINDOW = DAY;
// How recently a still-active event must have been updated to count as "ongoing".
const ONGOING_WINDOW: Partial<Record<HazardType, number>> = { storm: 2 * DAY, flood: 3 * DAY, wildfire: 3 * DAY, volcano: 7 * DAY, drought: 45 * DAY };

async function getJson<T>(url: string, ms = 15000): Promise<T> {
  const r = await fetch(url, { headers: { ...UA, Accept: "application/json" }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${r.status}`);
  return (await r.json()) as T;
}
const utc = (s: string) => Date.parse(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z");
/** GDACS track labels carry the point's own time as "dd/mm HH:MM UTC" (the date field is the advisory time). */
function labelTime(label: string | undefined, now: number): number | null {
  const m = label?.match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const year = new Date(now).getUTCFullYear();
  let t = Date.UTC(year, +m[2] - 1, +m[1], +m[3], +m[4]);
  if (t - now > 180 * DAY) t = Date.UTC(year - 1, +m[2] - 1, +m[1], +m[3], +m[4]);
  else if (now - t > 180 * DAY) t = Date.UTC(year + 1, +m[2] - 1, +m[1], +m[3], +m[4]);
  return t;
}

// Small in-memory cache so repeated visits do not re-query every agency (per server instance).
const memo = new Map<string, { until: number; value: Promise<unknown> }>();
function cached<T>(key: string, ttlMs: number, run: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && hit.until > Date.now()) return hit.value as Promise<T>;
  const value = run();
  memo.set(key, { until: Date.now() + ttlMs, value });
  value.catch(() => memo.delete(key));
  return value;
}

function phaseOf(type: HazardType, started: number, updated: number, active: boolean, now: number): Phase | null {
  if (now - started <= NEW_WINDOW || (type === "earthquake" && now - updated <= NEW_WINDOW)) return "new";
  if (type === "earthquake") return null; // quakes are instantaneous: only the last 24 h
  if (active && now - updated <= (ONGOING_WINDOW[type] ?? 3 * DAY)) return "ongoing";
  return null;
}

// Opens NASA Worldview on the event, on the day it was last observed.
const worldview = (lat: number, lon: number, date: string) =>
  `https://worldview.earthdata.nasa.gov/?v=${(lon - 3).toFixed(2)},${(lat - 2).toFixed(2)},${(lon + 3).toFixed(2)},${(lat + 2).toFixed(2)}&t=${date.slice(0, 10)}`;

// ---- NASA EONET (open events only) -------------------------------------------
interface EonetEvent {
  id: string; title: string; closed: string | null;
  categories: { id: string }[];
  sources: { id: string; url: string }[];
  geometry: { date: string; type: string; coordinates: unknown; magnitudeValue?: number | null; magnitudeUnit?: string | null }[];
}
const EONET_TYPES: Record<string, HazardType> = {
  wildfires: "wildfire", severeStorms: "storm", volcanoes: "volcano", floods: "flood", earthquakes: "earthquake",
  landslides: "landslide", drought: "drought", dustHaze: "dust", seaLakeIce: "ice", tempExtremes: "heat",
};
function eonetPoint(g: EonetEvent["geometry"][number]): [number, number] | null {
  if (g.type === "Point") { const [lon, lat] = g.coordinates as number[]; return [lat, lon]; }
  if (g.type === "Polygon") {
    const ring = (g.coordinates as number[][][])[0];
    return [ring.reduce((s, p) => s + p[1], 0) / ring.length, ring.reduce((s, p) => s + p[0], 0) / ring.length];
  }
  return null;
}
async function eonet(now: number): Promise<Hazard[]> {
  const data = await getJson<{ events: EonetEvent[] }>("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=20");
  const out: Hazard[] = [];
  for (const e of data.events) {
    const type = EONET_TYPES[e.categories[0]?.id] ?? "other";
    if (type === "ice") continue;
    const pts = e.geometry.map(g => ({ g, p: eonetPoint(g) })).filter(x => x.p) as { g: EonetEvent["geometry"][number]; p: [number, number] }[];
    if (!pts.length) continue;
    const last = pts[pts.length - 1];
    const phase = phaseOf(type, utc(pts[0].g.date), utc(last.g.date), !e.closed, now);
    if (!phase) continue;
    const mag = last.g.magnitudeValue ?? undefined, unit = last.g.magnitudeUnit ?? "";
    const windKts = unit === "kts" ? mag : undefined;
    const severity: Severity = type === "storm" && windKts !== undefined ? (windKts >= 96 ? "red" : windKts >= 64 ? "orange" : "green") : "info";
    out.push({
      id: e.id, type, title: e.title, lat: last.p[0], lon: last.p[1], date: new Date(utc(last.g.date)).toISOString(), started: new Date(utc(pts[0].g.date)).toISOString(), phase, severity,
      detail: mag !== undefined ? `${Math.round(mag).toLocaleString("en-US")} ${unit === "kts" ? "kt winds" : unit}` : undefined,
      radiusKm: impactRadius(type, severity, { windKts, acres: unit === "acres" ? mag : undefined }),
      sources: [{ name: "NASA EONET · Worldview", url: worldview(last.p[0], last.p[1], last.g.date) }, ...e.sources.slice(0, 2).map(s => ({ name: s.id.replace(/_/g, " "), url: s.url }))],
      track: pts.length > 1 ? pts.slice(-40).map(x => x.p) : undefined,
    });
  }
  return out;
}

// ---- GDACS -------------------------------------------------------------------
interface GdacsProps {
  eventtype: string; eventid: number; episodeid: number; name: string; alertlevel: string; episodealertlevel?: string; iscurrent: string;
  country: string; fromdate: string; todate: string; url?: { report?: string };
  severitydata?: { severity: number; severitytext: string; severityunit: string };
  Class?: string; polygonlabel?: string; polygondate?: string;
}
interface GdacsFeature { bbox?: number[]; geometry: { type: string; coordinates: unknown }; properties: GdacsProps }
const GDACS_TYPES: Record<string, HazardType> = { EQ: "earthquake", TC: "storm", FL: "flood", VO: "volcano", DR: "drought", WF: "wildfire" };
const level = (s?: string): Severity => { const l = (s || "").toLowerCase(); return l === "red" || l === "orange" || l === "green" ? l : "green"; };
const slim = (g: unknown, tol = 0.04) => simplifyGeometry(g as Geometry, tol, 2);

/** Cyclone detail: observed track, forecast track with times, cone and wind zones. */
async function cycloneDetail(eventid: number, episodeid: number, now: number) {
  const geo = await cached(`tc:${eventid}:${episodeid}`, 30 * 60_000, () => getJson<{ features: GdacsFeature[] }>(`https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid=${eventid}&episodeid=${episodeid}`, 12000));
  const points: { lat: number; lon: number; t: number }[] = [];
  const zonesByTime = new Map<number, Zone[]>();
  const swath: Zone[] = [];
  let cone: Geometry | undefined;
  for (const f of geo.features) {
    const p = f.properties, cls = p.Class || "";
    if (/Point_Polygon_Point/.test(cls)) {
      const t = labelTime(p.polygonlabel, now);
      if (t === null) continue;
      const ring = (f.geometry.coordinates as number[][][])[0];
      points.push({ lon: ring.reduce((s, c) => s + c[0], 0) / ring.length, lat: ring.reduce((s, c) => s + c[1], 0) / ring.length, t });
    } else if (/Cones/.test(cls)) {
      cone = slim(f.geometry) ?? undefined;
    } else if (/^Poly_(Green|Orange|Red)$/.test(cls)) {
      const g = slim(f.geometry);
      if (!g) continue;
      const zone: Zone = { level: level(cls.slice(5)), label: p.polygonlabel, geometry: g };
      if (/km\/h/.test(p.polygonlabel || "")) swath.push(zone);
      else { const t = labelTime(p.polygonlabel, now) ?? (p.polygondate ? utc(p.polygondate) : null); if (t !== null) zonesByTime.set(t, [...(zonesByTime.get(t) ?? []), zone]); }
    }
  }
  points.sort((a, b) => a.t - b.t);
  const past = points.filter(p => p.t <= now + HOUR), future = points.filter(p => p.t > now + HOUR);
  const current = past[past.length - 1];
  const zoneTimes = [...zonesByTime.keys()].filter(t => t <= now + HOUR).sort((a, b) => b - a);
  const forecast: ForecastPoint[] = future.map(p => ({ lat: +p.lat.toFixed(3), lon: +p.lon.toFixed(3), time: new Date(p.t).toISOString() }));
  return {
    current, track: past.slice(-60).map(p => [+p.lat.toFixed(3), +p.lon.toFixed(3)] as [number, number]),
    zones: zoneTimes.length ? zonesByTime.get(zoneTimes[0]) : undefined,
    forecast: forecast.length ? forecast : undefined,
    cone: forecast.length ? cone : undefined,
    forecastZones: forecast.length && swath.length ? swath : undefined,
  };
}

async function floodArea(eventid: number, episodeid: number) {
  const geo = await cached(`fl:${eventid}:${episodeid}`, 60 * 60_000, () => getJson<{ features: GdacsFeature[] }>(`https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=FL&eventid=${eventid}&episodeid=${episodeid}`, 12000));
  const f = geo.features.find(x => x.properties.Class === "Poly_Affected");
  return f ? slim(f.geometry, 0.02) : null;
}

async function gdacs(now: number): Promise<Hazard[]> {
  const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);
  const lists = await Promise.all(
    Object.keys(GDACS_TYPES).map(code =>
      getJson<{ features: GdacsFeature[] }>(
        `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=${code}&alertlevel=Green;Orange;Red&fromDate=${fmt(now - (code === "DR" ? 120 : 30) * DAY)}&toDate=${fmt(now + DAY)}`,
      ).then(d => d.features ?? []).catch(() => [] as GdacsFeature[]),
    ),
  );
  const kept: { f: GdacsFeature; h: Hazard }[] = [];
  for (const f of lists.flat()) {
    const p = f.properties, type = GDACS_TYPES[p.eventtype];
    if (!type || f.geometry?.type !== "Point") continue;
    const started = utc(p.fromdate), updated = utc(p.todate);
    const phase = phaseOf(type, started, updated, p.iscurrent === "true", now);
    if (!phase) continue;
    // Current episode level: the event-level alert is the lifetime maximum and can be days old.
    const severity = level(p.episodealertlevel || p.alertlevel);
    const [lon, lat] = f.geometry.coordinates as number[];
    const b = f.bbox;
    const bboxKm = b && b.length === 4 ? distanceKm(b[1], b[0], b[3], b[2]) : 0;
    const sd = p.severitydata;
    const text = sd?.severitytext?.trim();
    kept.push({ f, h: {
      id: `GDACS_${p.eventtype}_${p.eventid}`, type, title: p.name, lat, lon, date: new Date(updated).toISOString(), started: new Date(started).toISOString(), phase, severity,
      detail: text && !/^magnitude 0\b/i.test(text) ? (type === "storm" ? text.replace(/^.*\(maximum wind speed of ([\d.]+) km\/h\)/i, "Peak wind so far $1 km/h") : text) : undefined,
      radiusKm: impactRadius(type, severity, { magnitude: type === "earthquake" ? sd?.severity : undefined, bboxKm }),
      sources: [{ name: "GDACS", url: p.url?.report }], country: p.country || undefined,
    } });
  }
  // Exact footprints and forecasts (a handful of extra requests: current cyclones and floods only).
  await Promise.all(kept.map(async ({ f, h }) => {
    try {
      if (h.type === "storm") {
        const d = await cycloneDetail(f.properties.eventid, f.properties.episodeid, now);
        if (d.current) { h.lat = +d.current.lat.toFixed(3); h.lon = +d.current.lon.toFixed(3); h.date = new Date(d.current.t).toISOString(); }
        h.track = d.track.length > 1 ? d.track : undefined;
        h.zones = d.zones; h.forecast = d.forecast; h.cone = d.cone; h.forecastZones = d.forecastZones;
      } else if (h.type === "flood") {
        const area = await floodArea(f.properties.eventid, f.properties.episodeid);
        if (area) h.zones = [{ level: h.severity, label: "Affected area", geometry: area }];
      }
    } catch { /* keep the point record */ }
  }));
  return kept.map(k => k.h);
}

// ---- USGS earthquakes (M4.5+ in the last 24 h, exact epicentres) --------------
interface UsgsFeature { id: string; geometry: { coordinates: number[] }; properties: { mag: number; place: string; time: number; updated: number; url: string; alert: string | null; tsunami: number } }
async function usgs(now: number): Promise<Hazard[]> {
  const data = await getJson<{ features: UsgsFeature[] }>("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson");
  return data.features.filter(f => now - f.properties.time <= NEW_WINDOW).map(f => {
    const p = f.properties, [lon, lat, depth] = f.geometry.coordinates;
    const severity: Severity = p.alert === "red" ? "red" : p.alert === "orange" || p.alert === "yellow" ? "orange" : p.alert === "green" ? "green" : p.mag >= 7 ? "orange" : p.mag >= 6 ? "green" : "info";
    const t = new Date(p.time).toISOString();
    return {
      id: `USGS_${f.id}`, type: "earthquake" as const, title: `M${p.mag.toFixed(1)} — ${p.place}`, lat, lon, date: t, started: t, phase: "new" as const, severity,
      detail: `Magnitude ${p.mag.toFixed(1)} · depth ${Math.round(depth)} km${p.tsunami ? " · tsunami flag" : ""}`,
      radiusKm: impactRadius("earthquake", severity, { magnitude: p.mag }), sources: [{ name: "USGS", url: p.url }],
    };
  });
}

// ---- merge duplicates reported by several agencies ---------------------------
const stormName = (t: string) => t.toUpperCase().replace(/SUPER TYPHOON|TROPICAL CYCLONE|TROPICAL STORM|TROPICAL DEPRESSION|HURRICANE|TYPHOON|CYCLONE/g, "").replace(/-\d{2}$/, "").trim();
const MERGE_KM: Partial<Record<HazardType, number>> = { earthquake: 60, storm: 350, wildfire: 25, volcano: 30, flood: 150, drought: 400 };
// Which agency's record (position + time) wins: USGS for quake epicentres, GDACS for cyclones/floods (with footprints).
const rank = (h: Hazard) => (h.type === "earthquake" ? (h.id.startsWith("USGS") ? 0 : h.id.startsWith("GDACS") ? 1 : 2) : h.id.startsWith("GDACS") ? 0 : h.id.startsWith("USGS") ? 1 : 2);
function merge(all: Hazard[]): Hazard[] {
  const out: Hazard[] = [];
  for (const h of [...all].sort((a, b) => rank(a) - rank(b))) {
    const limit = MERGE_KM[h.type] ?? 20;
    const twin = out.find(o => o.type === h.type && (
      (distanceKm(o.lat, o.lon, h.lat, h.lon) < limit && Math.abs(Date.parse(o.date) - Date.parse(h.date)) < 2 * DAY) ||
      (h.type === "storm" && stormName(o.title) !== "" && stormName(o.title) === stormName(h.title))));
    if (!twin) { out.push({ ...h }); continue; }
    for (const s of h.sources) if (!twin.sources.some(t => t.name === s.name)) twin.sources.push(s);
    if (SEVERITY_META[h.severity].rank > SEVERITY_META[twin.severity].rank) twin.severity = h.severity;
    twin.radiusKm = Math.max(twin.radiusKm, h.radiusKm);
    twin.track ??= h.track;
    twin.detail ??= h.detail;
    if (h.started && (!twin.started || h.started < twin.started)) twin.started = h.started;
    if (h.phase === "new" && twin.phase !== "new" && twin.started && Date.now() - Date.parse(twin.started) <= NEW_WINDOW) twin.phase = "new";
  }
  return out.sort((a, b) => SEVERITY_META[b.severity].rank - SEVERITY_META[a.severity].rank || Number(!!b.forecast) - Number(!!a.forecast) || Date.parse(b.date) - Date.parse(a.date));
}

/** Merged live hazard feed, cached for 4 minutes per server instance. Server-only. */
export function getHazardFeed(): Promise<HazardFeed> {
  return cached("feed", 4 * 60_000, buildFeed);
}

async function buildFeed(): Promise<HazardFeed> {
  const now = Date.now();
  const feeds = [
    { name: "NASA EONET", run: eonet },
    { name: "GDACS", run: gdacs },
    { name: "USGS", run: usgs },
  ];
  const results = await Promise.allSettled(feeds.map(f => f.run(now)));
  const status = results.map((r, i) => ({ name: feeds[i].name, ok: r.status === "fulfilled", count: r.status === "fulfilled" ? r.value.length : 0 }));
  if (!status.some(s => s.ok)) throw new Error("all feeds down"); // not cached: cached() drops rejected entries
  const hazards = merge(results.flatMap(r => (r.status === "fulfilled" ? r.value : [])));
  return { hazards, updated: new Date(now).toISOString(), feeds: status };
}
