// Trend Lab: where, how much and how significantly NASA variables change.
//
// Two engines share the same statistics (lib/trends.ts: Mann–Kendall with pre-whitening, Sen's slope,
// Benjamini–Hochberg field significance):
//   • grid  — NASA POWER (MERRA-2 model) monthly cells, aggregated to a season, break-tested per cell;
//   • pixel — NASA MODIS monthly satellite products (surface temperature day/night, NDVI), 2001 onward.
import { detectBreak, MIN_SEGMENT } from "./homogeneity";
import { fdrThreshold, mannKendall } from "./trends";

export type TrendParam = "T2M" | "T2M_MAX" | "T2M_MIN" | "PRECTOTCORR" | "RH2M" | "QV2M" | "GWETROOT" | "WS2M" | "ALLSKY_SFC_SW_DWN" | "CLOUD_AMT";

/* i18n */export const TREND_PARAMS: Record<TrendParam, { label: string; unit: string; decimals: number; from: number; kind: "mean" | "total"; minStep: number; relative?: boolean; up: "warm" | "wet" | "neutral"; group: string }> = {
  T2M: { label: "Air temperature (2 m)", unit: "°C", decimals: 2, from: 1981, kind: "mean", minStep: 0.3, up: "warm", group: "Temperature" },
  T2M_MAX: { label: "Daily maximum temperature", unit: "°C", decimals: 2, from: 1981, kind: "mean", minStep: 0.3, up: "warm", group: "Temperature" },
  T2M_MIN: { label: "Daily minimum temperature", unit: "°C", decimals: 2, from: 1981, kind: "mean", minStep: 0.3, up: "warm", group: "Temperature" },
  PRECTOTCORR: { label: "Rainfall", unit: "mm", decimals: 2, from: 1981, kind: "total", minStep: 0.15, relative: true, up: "wet", group: "Water" },
  RH2M: { label: "Relative humidity", unit: "%", decimals: 1, from: 1981, kind: "mean", minStep: 2, up: "wet", group: "Water" },
  QV2M: { label: "Specific humidity", unit: "g/kg", decimals: 2, from: 1981, kind: "mean", minStep: 0.4, up: "wet", group: "Water" },
  GWETROOT: { label: "Root-zone soil wetness", unit: "0–1", decimals: 3, from: 1981, kind: "mean", minStep: 0.03, up: "wet", group: "Water" },
  WS2M: { label: "Wind speed (2 m)", unit: "m/s", decimals: 2, from: 1981, kind: "mean", minStep: 0.2, up: "neutral", group: "Energy & air" },
  ALLSKY_SFC_SW_DWN: { label: "Sunshine at the surface", unit: "kWh/m²/day", decimals: 2, from: 1984, kind: "mean", minStep: 0.2, up: "neutral", group: "Energy & air" },
  CLOUD_AMT: { label: "Cloud cover", unit: "%", decimals: 1, from: 1984, kind: "mean", minStep: 3, up: "neutral", group: "Energy & air" },
};/* /i18n */

export type Season = "ANN" | "DJF" | "MAM" | "JJAS" | "ON";
/* i18n */export const SEASONS: Record<Season, { label: string; months: number[] }> = {
  ANN: { label: "Whole year", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  DJF: { label: "Winter (Dec–Feb)", months: [12, 1, 2] },
  MAM: { label: "Pre-monsoon (Mar–May)", months: [3, 4, 5] },
  JJAS: { label: "Monsoon (Jun–Sep)", months: [6, 7, 8, 9] },
  ON: { label: "Post-monsoon (Oct–Nov)", months: [10, 11] },
};/* /i18n */

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const leap = (y: number) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);

/**
 * One value per year for a season from a cell's monthly series (12 values per year from `years[0]`).
 * Rainfall (mm/day monthly means) becomes a seasonal total in mm; other variables a mean.
 * Winter belongs to the year of its January (Dec of the year before + Jan + Feb).
 */
export function seasonal(monthly: (number | null)[], years: number[], season: Season, kind: "mean" | "total"): (number | null)[] {
  const months = SEASONS[season].months;
  return years.map((y, yi) => {
    let s = 0, w = 0;
    for (const m of months) {
      const yy = season === "DJF" && m === 12 ? y - 1 : y, idx = (yy - years[0]) * 12 + (m - 1);
      const v = idx >= 0 && idx < monthly.length ? monthly[idx] : null;
      if (v === null || v === undefined) return null;
      const days = m === 2 && leap(yy) ? 29 : DAYS[m - 1];
      if (kind === "total") s += v * days; else { s += v * days; w += days; }
    }
    void yi;
    return kind === "total" ? s : s / w;
  });
}

export interface CellTrend {
  lon: number; lat: number;
  series: (number | null)[];
  from: number; // first year used for the trend
  breakYear: number | null; // detected non-climatic step (trend uses the years after it)
  excluded: boolean; // a break leaves too few consistent years
  slope: number; // Sen's slope per decade
  p: number;
  significant: boolean; // after FDR control
  mean: number;
}
export interface GridResult {
  years: number[]; cells: CellTrend[]; fdrP: number;
  up: number; down: number; tested: number; breaks: Map<number, number>;
}

/** Trend of every cell: break test, Mann–Kendall + Sen on the consistent years, then field significance. */
export function analyseGrid(years: number[], raw: (number | null)[][], param: TrendParam, season: Season, fromYear: number, breakTest = true): GridResult {
  const meta = TREND_PARAMS[param], breaks = new Map<number, number>();
  const cells: CellTrend[] = raw.map(row => {
    const lon = row[0] as number, lat = row[1] as number;
    const series = seasonal(row.slice(2), years, season, meta.kind);
    const vals = series.filter((v): v is number => v !== null);
    const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
    const idx = years.map((_, i) => i).filter(i => years[i] >= fromYear);
    let from = years[idx[0]] ?? fromYear, breakYear: number | null = null;
    if (breakTest && vals.length >= 2 * MIN_SEGMENT + 2) {
      const b = detectBreak(idx.map(i => years[i]), idx.map(i => series[i]), meta.relative ? meta.minStep * Math.abs(mean) : meta.minStep);
      if (b) { breakYear = b.year; from = b.year; breaks.set(b.year, (breaks.get(b.year) ?? 0) + 1); }
    }
    const use = idx.filter(i => years[i] >= from);
    const mk = use.length >= 15 ? mannKendall(use.map(i => years[i]), use.map(i => series[i])) : null;
    return { lon, lat, series, from, breakYear, excluded: !mk, slope: mk ? mk.slope * 10 : NaN, p: mk ? mk.p : NaN, significant: false, mean };
  });
  const fdrP = fdrThreshold(cells.filter(c => !c.excluded).map(c => c.p));
  let up = 0, down = 0, tested = 0;
  for (const c of cells) {
    if (c.excluded) continue;
    tested++;
    c.significant = fdrP >= 0 && c.p <= fdrP;
    if (c.significant) { if (c.slope > 0) up++; else if (c.slope < 0) down++; }
  }
  return { years, cells, fdrP, up, down, tested, breaks };
}

// ---------- Satellite pixels (MODIS monthly) ----------
export type PixelVar = "lstDay" | "lstNight" | "ndvi";
/* i18n */export const PIXEL_VARS: Record<PixelVar, { label: string; layer: string; unit: string; first: number; up: "warm" | "green" }> = {
  lstDay: { label: "Daytime surface temperature", layer: "lstMonthDay", unit: "°C", first: 2001, up: "warm" },
  lstNight: { label: "Night-time surface temperature", layer: "lstMonthNight", unit: "°C", first: 2001, up: "warm" },
  ndvi: { label: "Vegetation greenness (NDVI)", layer: "ndviMonth", unit: "NDVI", first: 2001, up: "green" },
};/* /i18n */

export type CoverClass = "built" | "newBuilt" | "crop" | "other";
export interface PixelTrend { slope: number; p: number; significant: boolean; cls: CoverClass | null }
export interface PixelResult {
  years: number[]; width: number; height: number; trends: (PixelTrend | null)[]; fdrP: number;
  up: number; down: number; tested: number;
  byClass: Record<CoverClass, { n: number; mean: number; up: number; down: number }>;
}

/** Per-pixel trends from yearly decoded images; `cls` gives each pixel's land-cover class (or null). */
export function analysePixels(years: number[], frames: (((i: number) => number | null) | null)[], width: number, height: number, cls: (i: number) => CoverClass | null): PixelResult {
  const n = width * height, trends: (PixelTrend | null)[] = new Array(n).fill(null);
  for (let p = 0; p < n; p++) {
    const ys = frames.map(f => (f ? f(p) : null));
    const mk = mannKendall(years, ys);
    if (mk && Number.isFinite(mk.slope)) trends[p] = { slope: mk.slope * 10, p: mk.p, significant: false, cls: cls(p) };
  }
  const fdrP = fdrThreshold(trends.filter((t): t is PixelTrend => !!t).map(t => t.p));
  const byClass = { built: { n: 0, mean: 0, up: 0, down: 0 }, newBuilt: { n: 0, mean: 0, up: 0, down: 0 }, crop: { n: 0, mean: 0, up: 0, down: 0 }, other: { n: 0, mean: 0, up: 0, down: 0 } };
  let up = 0, down = 0, tested = 0;
  for (const t of trends) {
    if (!t) continue;
    tested++;
    t.significant = fdrP >= 0 && t.p <= fdrP;
    if (t.significant) { if (t.slope > 0) up++; else down++; }
    if (t.cls) {
      const b = byClass[t.cls];
      b.n++; b.mean += t.slope;
      if (t.significant) { if (t.slope > 0) b.up++; else b.down++; }
    }
  }
  for (const b of Object.values(byClass)) b.mean = b.n ? b.mean / b.n : NaN;
  return { years, width, height, trends, fdrP, up, down, tested, byClass };
}

/** Diverging colour for a trend (red = up for warm variables, green = up for greenness, brown = drying). */
export function trendColor(slope: number, scale: number, kind: "warm" | "wet" | "green" | "neutral") {
  const x = Math.max(-1, Math.min(1, slope / scale));
  const pos = kind === "warm" ? [214, 48, 39] : kind === "wet" || kind === "green" ? [26, 152, 80] : [118, 42, 131];
  const neg = kind === "warm" ? [49, 130, 189] : kind === "wet" || kind === "green" ? [166, 97, 26] : [27, 120, 55];
  const mid = [245, 245, 240], c = x >= 0 ? pos : neg, a = Math.abs(x);
  return [0, 1, 2].map(i => Math.round(mid[i] + (c[i] - mid[i]) * a)) as [number, number, number];
}
