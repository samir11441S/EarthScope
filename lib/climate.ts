import { detectBreak, MIN_RAIN_STEP_FRACTION, MIN_TEMP_STEP, type BreakResult } from "./homogeneity";
import { formatP, linearTrend } from "./stats";

export type Place = { id: string; name: string; country: string; lat: number; lon: number; region?: string };
export type Annual = { year: number; temperature: number; rainfall: number };
export type ClimateData = { annual: Annual[]; source: "NASA POWER" | "Illustrative demo"; retrieved: string; note?: string };
export type Layer = "Natural color" | "Temperature" | "Rainfall" | "Vegetation" | "Flood exposure";
export const PLACES: Place[] = [
  { id: "dhaka", name: "Dhaka", country: "Bangladesh", lat: 23.8103, lon: 90.4125, region: "Dhaka Division" },
  { id: "khulna", name: "Khulna", country: "Bangladesh", lat: 22.8456, lon: 89.5403, region: "Khulna Division" },
  { id: "batiaghata", name: "Batiaghata", country: "Bangladesh", lat: 22.7333, lon: 89.5167, region: "Khulna Division" },
  { id: "tokyo", name: "Tokyo", country: "Japan", lat: 35.6762, lon: 139.6503 },
  { id: "london", name: "London", country: "United Kingdom", lat: 51.5074, lon: -0.1278 },
  { id: "new-york", name: "New York", country: "United States", lat: 40.7128, lon: -74.006 },
  { id: "jakarta", name: "Jakarta", country: "Indonesia", lat: -6.2088, lon: 106.8456 },
  { id: "nairobi", name: "Nairobi", country: "Kenya", lat: -1.2921, lon: 36.8219 },
  { id: "sydney", name: "Sydney", country: "Australia", lat: -33.8688, lon: 151.2093 },
  { id: "reykjavik", name: "Reykjavík", country: "Iceland", lat: 64.1466, lon: -21.9426 },
];
/** NASA POWER monthly records start in 1981; 2025 is the last complete year. */
export const RECORD_START = 1981, RECORD_END = 2025, SCENARIO_END = 2050;
/** Changes are reported between the record's first and last decade (WMO-style 10-year means). */
export const PERIOD_YEARS = 10;
/** A trend needs at least this many consistent years to be reported. */
export const MIN_TREND_YEARS = 15;

export interface Homogeneity {
  tempBreak: BreakResult | null;
  rainBreak: BreakResult | null;
  tempFrom: number; // first year of the consistent temperature record
  rainFrom: number; // first year of the consistent rainfall record
}

/**
 * Finds abrupt, non-climatic steps (see lib/homogeneity.ts). A change in the observations the
 * reanalysis assimilates affects every variable at that place, so rainfall is never trusted from
 * before a temperature break either.
 */
export function homogeneity(annual: Annual[]): Homogeneity {
  const years = annual.map(a => a.year), first = years[0] ?? RECORD_START;
  const tempBreak = detectBreak(years, annual.map(a => a.temperature), MIN_TEMP_STEP);
  const tempFrom = tempBreak?.year ?? first;
  // Rainfall is tested within the part of the record that is already consistent for temperature.
  const rest = annual.filter(a => a.year >= tempFrom);
  const rainMean = rest.reduce((s, a) => s + a.rainfall, 0) / Math.max(1, rest.length);
  const rainBreak = detectBreak(rest.map(a => a.year), rest.map(a => a.rainfall), MIN_RAIN_STEP_FRACTION * rainMean);
  return { tempBreak, rainBreak, tempFrom, rainFrom: rainBreak?.year ?? tempFrom };
}

const since = (annual: Annual[], year: number) => annual.filter(a => a.year >= year);

export function demoClimate(place: Place): ClimateData {
  const base = 29 - Math.abs(place.lat) * .28;
  return { annual: Array.from({ length: RECORD_END - RECORD_START + 1 }, (_, i) => ({ year: RECORD_START + i, temperature: +(base + i * .02 + Math.sin(i * 1.7) * .28).toFixed(2), rainfall: Math.round(1200 + Math.cos(place.lon) * 400 + Math.sin(i * .9) * 160) })), source: "Illustrative demo", retrieved: "", note: "Illustrative values while NASA observations load. These are not measurements." };
}
export interface NasaPowerRaw {
  properties?: {
    parameter?: {
      T2M?: Record<string, number>;
      PRECTOTCORR?: Record<string, number>;
    };
  };
}

export interface TrendMetrics {
  tempSlopePerDecade: number;
  tempCi95: [number, number]; // °C per decade
  tempPValue: number;
  tempSignificant: boolean;
  rainSlopePerDecade: number;
  rainCi95: [number, number]; // mm per decade
  rainPValue: number;
  rainSignificant: boolean;
  /** Only "warming"/"cooling" when the trend is statistically significant (p < 0.05). */
  direction: "warming" | "cooling" | "no clear trend";
  rainDirection: "wetter" | "drier" | "no clear trend";
  rSquared: number;
  nEff: number; // effective sample size after the autocorrelation correction
  totalChangeTemp: number; // trend line change across the consistent record, °C
  years: [number, number]; // consistent temperature period
  rainYears: [number, number];
  tempEnough: boolean; // ≥ MIN_TREND_YEARS consistent years
  rainEnough: boolean;
  homogeneity: Homogeneity;
}

/**
 * Least-squares trends with autocorrelation-corrected significance tests (lib/stats.ts),
 * computed only over the consistent part of the record (lib/homogeneity.ts).
 */
export function calculateTrend(annual: Annual[]): TrendMetrics {
  const h = homogeneity(annual);
  const tSeg = since(annual, h.tempFrom), rSeg = since(annual, h.rainFrom);
  const tempEnough = tSeg.length >= MIN_TREND_YEARS, rainEnough = rSeg.length >= MIN_TREND_YEARS;
  const t = tempEnough ? linearTrend(tSeg.map(a => a.year), tSeg.map(a => a.temperature)) : null;
  const r = rainEnough ? linearTrend(rSeg.map(a => a.year), rSeg.map(a => a.rainfall)) : null;
  const span = (seg: Annual[]): [number, number] => (seg.length ? [seg[0].year, seg[seg.length - 1].year] : [0, 0]);
  const dec = (v: number) => v * 10;
  return {
    tempSlopePerDecade: t ? dec(t.slope) : 0, tempCi95: t ? [dec(t.ci95[0]), dec(t.ci95[1])] : [0, 0], tempPValue: t?.pValue ?? 1, tempSignificant: !!t?.significant,
    rainSlopePerDecade: r ? dec(r.slope) : 0, rainCi95: r ? [dec(r.ci95[0]), dec(r.ci95[1])] : [0, 0], rainPValue: r?.pValue ?? 1, rainSignificant: !!r?.significant,
    direction: t?.significant ? (t.slope > 0 ? "warming" : "cooling") : "no clear trend",
    rainDirection: r?.significant ? (r.slope > 0 ? "wetter" : "drier") : "no clear trend",
    rSquared: t?.rSquared ?? 0, nEff: t?.nEff ?? 0, totalChangeTemp: t ? t.slope * (span(tSeg)[1] - span(tSeg)[0]) : 0,
    years: span(tSeg), rainYears: span(rSeg), tempEnough, rainEnough, homogeneity: h,
  };
}

/** "+0.21 °C/decade (95% CI +0.12 to +0.30, p < 0.001)" */
export function trendSummary(t: TrendMetrics, kind: "temp" | "rain" = "temp") {
  if (!(kind === "temp" ? t.tempEnough : t.rainEnough)) return `fewer than ${MIN_TREND_YEARS} consistent years`;
  const [slope, ci, p, unit, d] = kind === "temp" ? [t.tempSlopePerDecade, t.tempCi95, t.tempPValue, "°C/decade", 2] as const : [t.rainSlopePerDecade, t.rainCi95, t.rainPValue, "mm/decade", 0] as const;
  return `${signed(slope, d)} ${unit} (95% CI ${signed(ci[0], d)} to ${signed(ci[1], d)}, ${formatP(p)})`;
}

/** Short verdict for cards and badges. */
export const trendVerdict = (t: TrendMetrics) =>
  t.direction === "warming" ? "Significant warming" : t.direction === "cooling" ? "Significant cooling" : "No clear trend yet";

export function parsePower(raw: NasaPowerRaw): ClimateData {
  const params = raw?.properties?.parameter;
  if (!params?.T2M || !params?.PRECTOTCORR) throw new Error("NASA returned an incomplete dataset.");
  const annual: Annual[] = [];
  for (let year = RECORD_START; year <= RECORD_END; year++) {
    const temperature = params.T2M[`${year}13`];
    if (!Number.isFinite(temperature) || temperature === -999) continue;
    let rainfall = 0, validMonths = 0;
    for (let month = 1; month <= 12; month++) {
      const rain = params.PRECTOTCORR[`${year}${String(month).padStart(2, "0")}`];
      if (Number.isFinite(rain) && rain >= 0) { rainfall += rain * new Date(Date.UTC(year, month, 0)).getUTCDate(); validMonths++; }
    }
    if (validMonths === 12) annual.push({ year, temperature, rainfall: Math.round(rainfall) });
  }
  if (!annual.length) throw new Error("No complete annual observations are available.");
  return { annual, source: "NASA POWER", retrieved: new Date().toISOString(), note: "Gridded MERRA-2 reanalysis from NASA POWER. Regional estimates, not a city weather station. Rainfall is summed from monthly daily means." };
}
export function observation(data: ClimateData, year: number, warming = 1.5, rainChange = -10): Annual {
  const last = data.annual[data.annual.length - 1];
  if (year > last.year) {
    const fraction = Math.max(0, Math.min(1, (year - last.year) / (SCENARIO_END - last.year)));
    return { year, temperature: last.temperature + warming * fraction, rainfall: last.rainfall * (1 + rainChange / 100 * fraction) };
  }
  return data.annual.reduce((a, b) => Math.abs(b.year - year) < Math.abs(a.year - year) ? b : a);
}

const range = (rows: Annual[]) => (rows.length ? `${rows[0].year}–${rows[rows.length - 1].year}` : "");

/** A decade-vs-decade comparison needs two non-overlapping decades of consistent data. */
const COMPARE_YEARS = 2 * PERIOD_YEARS;

/**
 * Labels for the comparison periods (first vs last decade of the consistent record).
 * Empty strings mean there is not enough consistent data for that comparison.
 * `breakNote` explains when part of the source record was excluded.
 */
export function periodLabels(data: ClimateData) {
  const a = data.annual;
  if (!a.length) return { base: "", recent: "", span: "", rainBase: "", rainRecent: "", first: RECORD_START, last: RECORD_END, breakNote: "" };
  const h = homogeneity(a), t = since(a, h.tempFrom), r = since(a, h.rainFrom);
  const end = a[a.length - 1].year;
  const parts: string[] = [];
  if (h.tempBreak) parts.push(`a ${signed(h.tempBreak.step, 1)} °C temperature step in ${h.tempBreak.year}`);
  if (h.rainBreak) parts.push(`a ${signed((h.rainBreak.step / Math.max(1, r.reduce((s, x) => s + x.rainfall, 0) / Math.max(1, r.length))) * 100, 0)}% rainfall step in ${h.rainBreak.year}`);
  const breakNote = parts.length
    ? `The NASA POWER record here has ${parts.join(" and ")} — abrupt, non-climatic jumps typical of a change in the observations the MERRA-2 reanalysis assimilates — so only ${h.tempFrom}–${end} is used for temperature${h.rainFrom !== h.tempFrom ? ` and ${h.rainFrom}–${end} for rainfall` : ""}.`
    : "";
  const okT = t.length >= COMPARE_YEARS, okR = r.length >= COMPARE_YEARS;
  return {
    base: okT ? range(t.slice(0, PERIOD_YEARS)) : "", recent: okT ? range(t.slice(-PERIOD_YEARS)) : "",
    rainBase: okR ? range(r.slice(0, PERIOD_YEARS)) : "", rainRecent: okR ? range(r.slice(-PERIOD_YEARS)) : "",
    span: range(t), first: t[0].year, last: end, breakNote,
  };
}

/**
 * Change between the first and last decade of the consistent record (temperature °C, rainfall %).
 * null when fewer than 20 consistent years are available for that variable.
 */
export function periodDelta(data: ClimateData): { temperature: number | null; rainfall: number | null } {
  if (!data.annual || data.annual.length === 0) return { temperature: null, rainfall: null };
  const h = homogeneity(data.annual), t = since(data.annual, h.tempFrom), r = since(data.annual, h.rainFrom);
  const average = (rows: Annual[], key: "temperature" | "rainfall") => rows.reduce((sum, x) => sum + x[key], 0) / rows.length;
  const temperature = t.length >= COMPARE_YEARS ? average(t.slice(-PERIOD_YEARS), "temperature") - average(t.slice(0, PERIOD_YEARS), "temperature") : null;
  const startRain = r.length >= COMPARE_YEARS ? average(r.slice(0, PERIOD_YEARS), "rainfall") : 0;
  const rainfall = startRain > 0 ? (average(r.slice(-PERIOD_YEARS), "rainfall") / startRain - 1) * 100 : null;
  return { temperature, rainfall };
}
/** Signed number; values that round to zero print as "0.0" (never "-0.0" or "+0.0"). */
export const signed = (n: number, decimals = 1) => { const r = Number(n.toFixed(decimals)); return r === 0 ? (0).toFixed(decimals) : `${r > 0 ? "+" : ""}${r.toFixed(decimals)}`; };

const DHAKA_PRESETS: Record<string, string> = {
  "2001-01-15": "/images/dhaka-2001.jpg",
  "2024-12-16": "/images/dhaka-terra-2024-12-16.jpg",
  "2025-01-05": "/images/dhaka-terra-2025-01-05.jpg",
  "2025-01-10": "/images/dhaka-terra-2025-01-10.jpg",
  "2025-01-15": "/images/dhaka-terra-2025-01-15.jpg",
  "2025-01-20": "/images/dhaka-2025.jpg",
  "2025-01-31": "/images/dhaka-terra-2025-01-31.jpg",
  "2025-02-01": "/images/dhaka-terra-2025-02-01.jpg",
  "2025-02-15": "/images/dhaka-terra-2025-02-15.jpg",
  "2025-02-25": "/images/dhaka-terra-2025-02-25.jpg",
};

export interface AnomalyPoint {
  year: number;
  temperature: number;
  tempAnomaly: number;
  rainfall: number;
  rainAnomalyPct: number;
}

/** Anomalies relative to the first decade of the consistent record (the same baseline as periodDelta). */
export function calculateAnomalies(annual: Annual[]): AnomalyPoint[] {
  if (!annual.length) return [];
  const h = homogeneity(annual), t = since(annual, h.tempFrom), r = since(annual, h.rainFrom);
  const tb = t.slice(0, PERIOD_YEARS), rb = r.slice(0, PERIOD_YEARS);
  const baseTemp = tb.reduce((s, a) => s + a.temperature, 0) / Math.max(1, tb.length);
  const baseRain = rb.reduce((s, a) => s + a.rainfall, 0) / Math.max(1, rb.length);
  return annual.map(a => ({
    year: a.year,
    temperature: a.temperature,
    tempAnomaly: +(a.temperature - baseTemp).toFixed(2),
    rainfall: a.rainfall,
    rainAnomalyPct: baseRain > 0 ? +(((a.rainfall / baseRain) - 1) * 100).toFixed(1) : 0,
  }));
}

export function imageUrl(place: Place, date: string, layer: "truecolor" | "ndvi" = "truecolor", view?: { span: number; size: number }) {
  if (!view && layer === "truecolor" && place.id === "dhaka" && DHAKA_PRESETS[date]) {
    return DHAKA_PRESETS[date];
  }
  const extra = view ? `&span=${view.span}&size=${view.size}` : "";
  return `/api/imagery?lat=${place.lat}&lon=${place.lon}&date=${date}&layer=${layer}${extra}`;
}
export function climateStory(place: Place, data: ClimateData, year: number, warming: number, rainChange: number) {
  const delta = periodDelta(data), value = observation(data, year, warming, rainChange), p = periodLabels(data);
  const trend = calculateTrend(data.annual);
  if (year > p.last) return `In your ${year} scenario, ${place.name}'s annual mean temperature reaches ${value.temperature.toFixed(1)}°C, with annual precipitation of about ${Math.round(value.rainfall).toLocaleString()} mm. This follows your chosen ${signed(warming)}°C warming and ${signed(rainChange, 0)}% rainfall change by ${SCENARIO_END}, relative to ${p.last}. It is a simple what-if exploration, not a climate model forecast. More shade, resilient water systems, and locally informed planning can help communities adapt.`;
  const source = data.source === "NASA POWER" ? "NASA POWER record" : "illustrative dataset";
  const tempLine = trend.tempSignificant
    ? `Across ${p.span} the record shows statistically significant ${trend.direction}: ${trendSummary(trend, "temp")}.`
    : `Across ${p.span} there is no statistically clear temperature trend yet (${trendSummary(trend, "temp")}): year-to-year variability is larger than any steady change.`;
  const rainLine = trend.rainSignificant
    ? `Annual rainfall shows a statistically significant ${trend.rainDirection === "wetter" ? "increase" : "decrease"}: ${trendSummary(trend, "rain")}.`
    : `Annual rainfall has no statistically clear trend (${trendSummary(trend, "rain")}).`;
  const tempDelta = delta.temperature === null ? "" : `the ${p.recent} average is ${Math.abs(delta.temperature).toFixed(2)}°C ${delta.temperature >= 0 ? "warmer" : "cooler"} than ${p.base}`;
  const rainDelta = delta.rainfall === null ? "" : `average rainfall is ${Math.abs(delta.rainfall).toFixed(1)}% ${delta.rainfall >= 0 ? "higher" : "lower"} in ${p.rainRecent} than in ${p.rainBase}`;
  const deltas = [tempDelta, rainDelta].filter(Boolean).join(", and ");
  return `${place.name}'s climate tells a changing story. ${deltas ? `In this ${source}, ${deltas}. ` : ""}${p.breakNote ? p.breakNote + " " : ""}${tempLine} ${rainLine} Satellite imagery adds visual context; it does not, by itself, explain the causes of those changes.`;
}
