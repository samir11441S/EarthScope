"use client";
// Collects everything a report needs, in parallel, tolerating any single source failing.
import type { ClimateData, Place } from "../climate";
import { compareLandCover, compareNdvi, LANDCOVER_YEARS, ndviComposites } from "../earth-change";
import type { ExtremeYear } from "../extremes";
import { assessSafety, type HazardFeed, type SafePlace } from "../hazards";
import { distanceKm } from "../geo";
import type { HeatOutlook } from "../heat";
import { findClearestScene, pixels } from "@/components/satellite-compare";
import type { ReportInputs } from "./model";

export const REPORT_SPAN = 0.4; // ≈ 45 km square around the place
const REGION_SPAN = 2.2; // ≈ 240 km, coastal / delta context
const SIZE = 512;

const img = (p: Place, layer: string, date: string, span: number, size = SIZE) =>
  `/api/imagery?lat=${p.lat}&lon=${p.lon}&date=${date}&layer=${layer}&span=${span}&size=${size}`;
export const landcoverUrl = (p: Place, year: number, span = REPORT_SPAN) => img(p, "landcover", `${year}-01-01`, span);

async function json<T>(url: string, ms = 30000): Promise<T> {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(url);
  return r.json() as Promise<T>;
}
const settle = <T,>(p: Promise<T>) => p.then(v => v, () => null);

export type Step = "climate" | "extremes" | "land" | "vegetation" | "live";

export type SafeList = ReportInputs["safePlaces"];

export async function gatherReport(
  base: { place: Place; year: number; warming: number; rainChange: number; climate: ClimateData },
  onStep?: (step: Step, done: boolean) => void,
): Promise<{ inputs: ReportInputs; safeLater: Promise<SafeList> | null }> {
  const { place } = base;
  const track = <T,>(step: Step, p: Promise<T>) => { onStep?.(step, false); return p.finally(() => onStep?.(step, true)); };

  const extremesJob = track("extremes", settle(json<{ years: ExtremeYear[]; version: string | null }>(`/api/extremes?lat=${place.lat.toFixed(4)}&lon=${place.lon.toFixed(4)}`, 60000)));

  const landJob = track("land", settle((async () => {
    const [y0, y1] = LANDCOVER_YEARS, area = (REPORT_SPAN * 110.57) ** 2;
    const [a, b, region] = await Promise.all([pixels(landcoverUrl(place, y0), SIZE), pixels(landcoverUrl(place, y1), SIZE), settle(pixels(landcoverUrl(place, y1, REGION_SPAN), 256))]);
    const c = compareLandCover(a, b, area);
    let regionWaterPct: number | null = null;
    if (region) { const r = compareLandCover(region, region, 1); regionWaterPct = r.b.share.water + r.b.share.wetland; }
    return { land: { years: [y0, y1] as [number, number], spanDeg: REPORT_SPAN, areaKm2: area, a: c.a.share, b: c.b.share, changedPct: c.changedPct, toBuiltPct: c.toBuiltPct }, regionWaterPct };
  })()));

  const vegJob = track("vegetation", settle((async () => {
    // Same season in both years: the three 16-day composites from 1 March (dry season in South Asia).
    const month = 3, latest = new Date().getUTCFullYear() - (Date.now() > Date.UTC(new Date().getUTCFullYear(), 4, 1) ? 0 : 1);
    const ya = 2001, yb = latest, A = ndviComposites(ya, month), B = ndviComposites(yb, month);
    if (!A.length || !B.length) return null;
    const load = (ds: string[]) => Promise.all(ds.map(d => pixels(img(place, "ndvi16", d, REPORT_SPAN), SIZE)));
    const n = compareNdvi(await load(A), await load(B));
    return { years: [ya, yb] as [number, number], month, meanA: n.meanA, meanB: n.meanB, denseA: n.denseA, denseB: n.denseB, greenerPct: n.greenerPct, brownerPct: n.brownerPct };
  })()));

  const coverJob = settle(findClearestScene(place, "hls", `${new Date().getUTCFullYear() - 1}-01-15`, REPORT_SPAN, "L30"));

  // OpenStreetMap's Overpass API can take a minute: the report does not wait for it beyond a few
  // seconds; late answers are patched into the report (and its saved snapshot) by the viewer.
  const safeJob: Promise<SafeList> = settle(json<{ places?: SafePlace[] }>(`/api/safe-places?lat=${place.lat.toFixed(5)}&lon=${place.lon.toFixed(5)}&radius=12`, 58000))
    .then(r => r ?? settle(json<{ places?: SafePlace[] }>(`/api/safe-places?lat=${place.lat.toFixed(4)}&lon=${place.lon.toFixed(4)}&radius=5`, 58000)))
    .then(safe => safe?.places ? safe.places.map(s => ({ name: s.name, kind: s.kind, distanceKm: distanceKm(place.lat, place.lon, s.lat, s.lon) })).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 5) : null);
  const PENDING = Symbol("pending");
  const safeQuick = Promise.race([safeJob, new Promise<typeof PENDING>(r => setTimeout(() => r(PENDING), 8000))]);

  const liveJob = track("live", (async () => {
    const [heat, feed, safe] = await Promise.all([
      settle(json<{ outlooks?: HeatOutlook[] }>(`/api/heat?points=${place.lat.toFixed(3)},${place.lon.toFixed(3)}`)),
      settle(json<HazardFeed>("/api/disasters")),
      safeQuick,
    ]);
    const outlook = heat?.outlooks?.[0];
    const threats = feed ? assessSafety(place.lat, place.lon, feed.hazards).threats : null;
    // Also list notable events within 500 km even when they are outside their impact radius.
    const extra = feed ? feed.hazards.filter(h => h.type !== "ice" && !threats!.some(t => t.hazard.id === h.id)).map(h => ({ h, d: distanceKm(place.lat, place.lon, h.lat, h.lon) })).filter(x => x.d <= 500) : [];
    const hazards = feed ? [
      ...threats!.map(t => ({ title: t.hazard.title, type: t.hazard.type, severity: t.hazard.severity, distanceKm: t.distanceKm, inside: t.inside, eta: t.upcoming?.eta, url: t.hazard.sources[0]?.url })),
      ...extra.sort((a, b) => a.d - b.d).map(({ h, d }) => ({ title: h.title, type: h.type, severity: h.severity, distanceKm: d, inside: false, url: h.sources[0]?.url })),
    ].slice(0, 6) : null;
    const pending = safe === PENDING;
    return { heat: outlook ? { days: outlook.days, source: outlook.source } : null, hazards, hazardsUpdated: feed?.updated ?? null, safePlaces: pending ? null : safe, pending };
  })());

  onStep?.("climate", true);
  const [extremes, land, ndvi, cover, live] = await Promise.all([extremesJob, landJob, vegJob, coverJob, liveJob]);
  const inputs: ReportInputs = {
    version: 2,
    place: base.place, year: base.year, warming: base.warming, rainChange: base.rainChange,
    created: new Date().toISOString(),
    climate: base.climate,
    extremes: extremes ? { years: extremes.years, version: extremes.version } : null,
    land: land?.land ?? null, regionWaterPct: land?.regionWaterPct ?? null,
    ndvi,
    cover: cover ? { date: cover.date, sensor: cover.sensor } : null,
    heat: live.heat, hazards: live.hazards, hazardsUpdated: live.hazardsUpdated, safePlaces: live.safePlaces,
    liveFetched: new Date().toISOString(),
  };
  return { inputs, safeLater: live.pending ? safeJob : null };
}
