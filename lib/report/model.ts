// EarthScope climate report: the analysis model.
// Everything here is computed from measured inputs (no text); lib/report/i18n.ts turns it into
// English or Bangla for the chosen audience. Pure functions — safe to run on saved snapshots.
import { calculateTrend, homogeneity, observation, periodDelta, periodLabels, type Annual, type ClimateData, type Place, type TrendMetrics } from "../climate";
import { summarizeExtremes, type ExtremeYear, type IndexKey, type IndexStat } from "../extremes";
import { observedRate } from "../nasa-global-data";
import type { CoverGroup } from "../earth-change";
import type { HazardType, SafePlaceKind, Severity } from "../hazards";
import type { HeatDay } from "../heat";

export type Lang = "en" | "bn";
export type Audience = "citizen" | "student" | "planner";

/** Everything a report needs, captured at generation time (stored with saved reports). */
export interface ReportInputs {
  version: 2;
  place: Place;
  year: number; warming: number; rainChange: number;
  created: string; // ISO
  climate: ClimateData;
  extremes: { years: ExtremeYear[]; version: string | null } | null;
  land: { years: [number, number]; spanDeg: number; areaKm2: number; a: Record<CoverGroup, number>; b: Record<CoverGroup, number>; changedPct: number; toBuiltPct: number } | null;
  ndvi: { years: [number, number]; month: number; meanA: number; meanB: number; denseA: number; denseB: number; greenerPct: number; brownerPct: number } | null;
  regionWaterPct: number | null; // open water + wetland share within ~240 km (coastal / delta context)
  cover: { date: string; sensor: string } | null; // satellite scene used on the cover
  heat: { days: HeatDay[]; source: string } | null;
  air?: { aqi: number; pm25: number; peakAqi: number; days: { date: string; maxAqi: number }[] } | null; // CAMS forecast (reports saved before v2.1 have none)
  hazards: { title: string; type: HazardType; severity: Severity; distanceKm: number; inside: boolean; eta?: string; url?: string }[] | null;
  hazardsUpdated: string | null;
  safePlaces: { name: string; kind: SafePlaceKind; distanceKm: number }[] | null;
  liveFetched: string | null;
}

export type Likelihood = "virtually-certain" | "very-likely" | "likely" | "about-as-likely";
export interface Confidence { likelihood: Likelihood; probability: number } // probability the sign of the trend is right

/**
 * IPCC calibrated likelihood language (Mastrandrea et al. 2010) for "the trend has this sign":
 * probability ≈ 1 − p/2 for a two-sided t-test.
 */
export function confidence(pValue: number): Confidence {
  const probability = 1 - pValue / 2;
  const likelihood: Likelihood = probability >= 0.99 ? "virtually-certain" : probability >= 0.9 ? "very-likely" : probability >= 0.66 ? "likely" : "about-as-likely";
  return { likelihood, probability };
}

export type RiskId = "live" | "humidHeat" | "urbanHeat" | "extremeRain" | "drought" | "coastal" | "vegetation" | "cold" | "warming";
export type RiskLevel = "high" | "elevated" | "watch";
export interface Evidence { key: string; values: Record<string, string | number>; source: string }
export interface Risk { id: RiskId; level: RiskLevel; score: number; evidence: Evidence[] }

export interface ReportModel {
  inputs: ReportInputs;
  annual: Annual[];
  trend: TrendMetrics;
  periods: ReturnType<typeof periodLabels>;
  delta: ReturnType<typeof periodDelta>;
  consistentFrom: { temp: number; rain: number };
  isScenario: boolean;
  shown: Annual; // values for the selected year (observed or scenario)
  latest: Annual;
  rank: { temp: number | null; rain: number | null; of: number; ofRain: number };
  tempConfidence: Confidence; rainConfidence: Confidence;
  global: { local: number; localCi: [number, number]; global: number; globalCi: [number, number]; arctic: number; ratio: number | null; from: number; to: number } | null;
  extremes: IndexStat[] | null;
  extremeConfidence: Partial<Record<IndexKey, Confidence>>;
  risks: Risk[];
  heatAlertDays: number;
  demo: boolean;
}

const rankOf = (rows: Annual[], key: "temperature" | "rainfall", value: number) => 1 + rows.filter(r => r[key] > value).length;
const fmt = (n: number, d = 1) => Number(n.toFixed(d));

export function buildModel(inputs: ReportInputs): ReportModel {
  const annual = inputs.climate.annual;
  const trend = calculateTrend(annual), h = homogeneity(annual), periods = periodLabels(inputs.climate), delta = periodDelta(inputs.climate);
  const latest = annual[annual.length - 1];
  const isScenario = inputs.year > latest.year;
  const shown = observation(inputs.climate, inputs.year, inputs.warming, inputs.rainChange);
  const tRows = annual.filter(a => a.year >= h.tempFrom), rRows = annual.filter(a => a.year >= h.rainFrom);

  // How fast this place warms compared with the planet over the same consistent years (NASA GISTEMP).
  let global: ReportModel["global"] = null;
  if (trend.tempEnough) {
    const g = observedRate("globalTempAnomaly", trend.years[0]), a = observedRate("arcticTempAnomaly", trend.years[0]);
    global = { local: trend.tempSlopePerDecade, localCi: trend.tempCi95, global: g.perDecade, globalCi: g.ci95, arctic: a.perDecade, ratio: g.perDecade > 0.005 ? trend.tempSlopePerDecade / g.perDecade : null, from: trend.years[0], to: Math.min(trend.years[1], g.to) };
  }

  const extremes = inputs.extremes ? summarizeExtremes(inputs.extremes.years, h.tempFrom, h.rainFrom) : null;
  const extremeConfidence: ReportModel["extremeConfidence"] = {};
  for (const s of extremes ?? []) if (s.trend) extremeConfidence[s.key] = confidence(s.trend.pValue);
  const ex = (k: IndexKey) => extremes?.find(s => s.key === k) ?? null;
  const heatAlertDays = inputs.heat?.days.filter(d => ["danger", "extreme-danger"].includes(d.level) || ["moderate", "severe", "very-severe"].includes(d.bmd)).length ?? 0;

  const risks: Risk[] = [];
  const add = (id: RiskId, score: number, evidence: Evidence[]) => {
    if (score <= 0 || !evidence.length) return;
    risks.push({ id, score, level: score >= 3 ? "high" : score >= 2 ? "elevated" : "watch", evidence });
  };
  const SRC_POWER = "NASA POWER / MERRA-2", SRC_DAILY = "NASA POWER daily (ETCCDI-style indices)", SRC_LC = "NASA MODIS MCD12Q1", SRC_NDVI = "NASA MODIS MOD13Q1";
  const up = (s: IndexStat | null) => !!s?.trend && s.trend.slope > 0 && s.trend.pValue < 0.1;
  const decadeChange = (s: IndexStat | null) => (s && s.firstMean !== null && s.lastMean !== null ? s.lastMean - s.firstMean : null);

  // 1. Live hazards (now).
  const liveNear = (inputs.hazards ?? []).filter(x => x.inside || x.eta || x.distanceKm <= 300);
  if (liveNear.length) {
    const worst = liveNear[0];
    add("live", worst.inside || worst.eta ? 3 : worst.severity === "red" || worst.severity === "orange" ? 2 : 1,
      liveNear.slice(0, 3).map(x => ({ key: x.inside ? "ev.liveInside" : x.eta ? "ev.liveForecast" : "ev.liveNear", values: { title: x.title, km: Math.round(x.distanceKm), eta: x.eta ?? "" }, source: "NASA EONET · GDACS · USGS" })));
  }

  // 2. Humid heat (health).
  {
    const tw = ex("humidHeatDays"), hot = ex("hotDays"), nights = ex("warmNights"), ev: Evidence[] = [];
    let score = 0;
    if (tw?.relevant && tw.lastMean !== null && tw.lastMean >= 10) { score += tw.lastMean >= 60 ? 2 : 1; ev.push({ key: "ev.humidHeat", values: { days: Math.round(tw.lastMean), period: tw.lastLabel, change: decadeChange(tw) !== null ? fmt(decadeChange(tw)!, 0) : "" }, source: SRC_DAILY }); }
    if (up(tw)) { score += 1; ev.push({ key: "ev.trendUp", values: { index: "humidHeatDays", rate: fmt(tw!.trend!.perDecade, 1) }, source: SRC_DAILY }); }
    if (nights?.relevant && up(nights)) { score += 0.5; ev.push({ key: "ev.trendUp", values: { index: "warmNights", rate: fmt(nights.trend!.perDecade, 1) }, source: SRC_DAILY }); }
    if (hot?.relevant && hot.lastMean !== null && hot.lastMean >= 20) { score += 0.5; ev.push({ key: "ev.hotDays", values: { days: Math.round(hot.lastMean), period: hot.lastLabel }, source: SRC_DAILY }); }
    if (heatAlertDays) { score += 1; ev.push({ key: "ev.heatForecast", values: { days: heatAlertDays }, source: "Open-Meteo · NWS heat index · BMD classes" }); }
    if (!extremes && trend.direction === "warming" && latest.temperature >= 24) { score += 1; ev.push({ key: "ev.warmClimate", values: { t: fmt(latest.temperature, 1) }, source: SRC_POWER }); }
    add("humidHeat", Math.min(3, score), ev);
  }

  // 3. Urban heat island (built-up growth).
  if (inputs.land) {
    const { a, b, years } = inputs.land, d = b.built - a.built;
    if (b.built >= 5 && d >= 1) add("urbanHeat", b.built >= 15 && d >= 3 ? 3 : d >= 2 ? 2 : 1, [
      { key: "ev.builtUp", values: { a: fmt(a.built), b: fmt(b.built), y0: years[0], y1: years[1], km2: Math.round((d / 100) * inputs.land.areaKm2) }, source: SRC_LC },
      ...(inputs.ndvi && inputs.ndvi.brownerPct >= 5 ? [{ key: "ev.browning", values: { pct: Math.round(inputs.ndvi.brownerPct) }, source: SRC_NDVI }] : []),
    ]);
  }

  // 4. Extreme rain / urban flooding.
  {
    const r50 = ex("heavyRainDays"), rx = ex("rx1day"), ev: Evidence[] = [];
    let score = 0;
    if (rx && rx.lastMean !== null && rx.lastMean >= 80) { score += rx.lastMean >= 120 ? 2 : 1; ev.push({ key: "ev.rx1day", values: { mm: Math.round(rx.lastMean), period: rx.lastLabel }, source: SRC_DAILY }); }
    else if (rx && rx.mean >= 80) { score += 1; ev.push({ key: "ev.rx1dayMean", values: { mm: Math.round(rx.mean), from: rx.from, to: rx.to }, source: SRC_DAILY }); }
    if (r50?.relevant && r50.mean >= 1) { score += 0.5; ev.push({ key: "ev.heavyDays", values: { days: fmt(r50.mean, 1), from: r50.from, to: r50.to }, source: SRC_DAILY }); }
    if (up(rx) || up(r50)) { score += 1; const s = up(rx) ? rx! : r50!; ev.push({ key: "ev.trendUp", values: { index: s.key, rate: fmt(s.trend!.perDecade, 1) }, source: SRC_DAILY }); }
    if (trend.rainDirection === "wetter") { score += 0.5; ev.push({ key: "ev.wetter", values: { rate: fmt(trend.rainSlopePerDecade, 0) }, source: SRC_POWER }); }
    if (inputs.land && inputs.land.b.built >= 10 && score > 0) { score += 0.5; ev.push({ key: "ev.sealed", values: { pct: fmt(inputs.land.b.built) }, source: SRC_LC }); }
    if (!extremes && latest.rainfall >= 1800) { score += 1; ev.push({ key: "ev.wetClimate", values: { mm: Math.round(latest.rainfall) }, source: SRC_POWER }); }
    add("extremeRain", Math.min(3, score), ev);
  }

  // 5. Dry spells / drought.
  {
    const cdd = ex("cdd"), ev: Evidence[] = [];
    let score = 0;
    if (cdd && cdd.lastMean !== null && cdd.lastMean >= 60) { score += cdd.lastMean >= 100 ? 2 : 1; ev.push({ key: "ev.cdd", values: { days: Math.round(cdd.lastMean), period: cdd.lastLabel }, source: SRC_DAILY }); }
    if (up(cdd)) { score += 1; ev.push({ key: "ev.trendUp", values: { index: "cdd", rate: fmt(cdd!.trend!.perDecade, 1) }, source: SRC_DAILY }); }
    if (trend.rainDirection === "drier") { score += 1; ev.push({ key: "ev.drier", values: { rate: fmt(trend.rainSlopePerDecade, 0) }, source: SRC_POWER }); }
    if (latest.rainfall < 500) { score += 1; ev.push({ key: "ev.arid", values: { mm: Math.round(latest.rainfall) }, source: SRC_POWER }); }
    add("drought", Math.min(3, score), ev);
  }

  // 6. Coastal / cyclone & storm surge exposure (tropical and subtropical coasts, deltas).
  if (inputs.regionWaterPct !== null && inputs.regionWaterPct >= 12 && Math.abs(inputs.place.lat) <= 35) {
    const storms = (inputs.hazards ?? []).filter(x => x.type === "storm" && (x.inside || x.eta || x.distanceKm < 800));
    add("coastal", inputs.regionWaterPct >= 25 || storms.length ? 2 + (storms.length ? 1 : 0) : 1, [
      { key: "ev.water", values: { pct: Math.round(inputs.regionWaterPct) }, source: SRC_LC },
      ...storms.slice(0, 1).map(s => ({ key: "ev.stormNow", values: { title: s.title, km: Math.round(s.distanceKm) }, source: "GDACS" })),
    ]);
  }

  // 7. Vegetation change.
  if (inputs.ndvi) {
    const n = inputs.ndvi, lost = inputs.land ? (["forest", "cropland", "shrubGrass", "wetland"] as CoverGroup[]).reduce((s, g) => s + inputs.land!.a[g] - inputs.land!.b[g], 0) : 0;
    const score = (n.brownerPct >= 25 ? 2 : n.brownerPct >= 12 ? 1 : 0) + (n.denseB - n.denseA <= -5 ? 1 : 0) + (lost >= 3 ? 0.5 : 0);
    add("vegetation", Math.min(3, score), [
      { key: "ev.ndvi", values: { a: fmt(n.meanA, 2), b: fmt(n.meanB, 2), y0: n.years[0], y1: n.years[1], browner: Math.round(n.brownerPct), greener: Math.round(n.greenerPct) }, source: SRC_NDVI },
      ...(lost >= 1 ? [{ key: "ev.greenLost", values: { pts: fmt(lost) }, source: SRC_LC }] : []),
    ]);
  }

  // 8. Cold extremes where they matter.
  {
    const fd = ex("frostDays");
    if (fd?.relevant && fd.lastMean !== null && fd.lastMean >= 30) add("cold", 1, [{ key: "ev.frost", values: { days: Math.round(fd.lastMean), period: fd.lastLabel }, source: SRC_DAILY }]);
  }

  // 9. Long-term warming signal.
  if (trend.direction === "warming") add("warming", global && global.ratio !== null && global.ratio >= 1.2 ? 2 : 1, [{ key: "ev.warming", values: { rate: fmt(trend.tempSlopePerDecade, 2), from: trend.years[0], to: trend.years[1], ratio: global?.ratio ? fmt(global.ratio, 1) : "" }, source: SRC_POWER }]);

  risks.sort((x, y) => y.score - x.score);
  const ofT = tRows.length, ofR = rRows.length;
  return {
    inputs, annual, trend, periods, delta,
    consistentFrom: { temp: h.tempFrom, rain: h.rainFrom },
    isScenario, shown, latest,
    rank: { temp: ofT ? rankOf(tRows, "temperature", latest.temperature) : null, rain: ofR ? rankOf(rRows, "rainfall", latest.rainfall) : null, of: ofT, ofRain: ofR },
    tempConfidence: confidence(trend.tempPValue), rainConfidence: confidence(trend.rainPValue),
    global, extremes, extremeConfidence, risks, heatAlertDays,
    demo: inputs.climate.source !== "NASA POWER",
  };
}

/** CSV of every annual value behind the report (planner download). */
export function reportCsv(m: ReportModel): string {
  const ex = new Map((m.inputs.extremes?.years ?? []).map(y => [y.year, y]));
  const head = ["year", "mean_temperature_c", "precipitation_mm", "temperature_consistent", "rainfall_consistent", "hot_days_tmax_ge_35c", "warm_nights_tmin_ge_25c", "humid_heat_days_tw_ge_27c", "frost_days", "hottest_day_c", "heavy_rain_days_ge_50mm", "wettest_day_mm", "longest_dry_spell_days"];
  const rows = m.annual.map(a => {
    const e = ex.get(a.year);
    return [a.year, a.temperature.toFixed(2), a.rainfall, a.year >= m.consistentFrom.temp, a.year >= m.consistentFrom.rain, e?.hotDays ?? "", e?.warmNights ?? "", e?.humidHeatDays ?? "", e?.frostDays ?? "", e?.txx ?? "", e?.heavyRainDays ?? "", e?.rx1day ?? "", e?.cdd ?? ""].join(",");
  });
  const p = m.inputs.place;
  return [
    `# EarthScope climate report data — ${p.name}, ${p.country} (${p.lat.toFixed(4)}, ${p.lon.toFixed(4)})`,
    `# Source: NASA POWER (MERRA-2 reanalysis), monthly and daily point data${m.inputs.extremes?.version ? `, API ${m.inputs.extremes.version}` : ""}. Generated ${m.inputs.created}.`,
    `# Years before the consistent flags are affected by non-climatic steps (two-phase regression test) and are excluded from trends.`,
    head.join(","), ...rows,
  ].join("\n");
}
