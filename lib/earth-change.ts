// Measuring land change from NASA's official MODIS products (client-side pixel decoding).
//
//   • MODIS MCD12Q1 land cover (IGBP scheme), 500 m, yearly — GIBS layer MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual
//   • MODIS MOD13Q1 NDVI, 250 m, 16-day composites    — GIBS layer MODIS_Terra_L3_NDVI_16Day
//   • MODIS MOD11A2 land-surface temperature (day), 1 km, 8-day — GIBS layer MODIS_Terra_L3_Land_Surface_Temp_8Day_Day
//
// GIBS renders them with fixed colour maps (colormaps/v1.3/MODIS_IGBP_Land_Cover_Type.xml, MODIS_NDVI.xml and
// MODIS_Land_Surface_Temp.xml, 0.6 K steps), so each pixel can be decoded back to its class or value exactly.
import NDVI_PALETTE from "./ndvi-palette.json";
import LST_PALETTE from "./lst-palette.json";

export const LANDCOVER_YEARS: [number, number] = [2001, 2024];

/** IGBP classes as rendered by GIBS, grouped into the categories people care about. */
export type CoverGroup = "built" | "cropland" | "forest" | "shrubGrass" | "wetland" | "water" | "barren";
const IGBP: Record<string, { name: string; group: CoverGroup }> = {
  "33,138,33": { name: "Evergreen needleleaf forest", group: "forest" },
  "49,204,49": { name: "Evergreen broadleaf forest", group: "forest" },
  "152,204,49": { name: "Deciduous needleleaf forest", group: "forest" },
  "150,250,150": { name: "Deciduous broadleaf forest", group: "forest" },
  "141,186,141": { name: "Mixed forest", group: "forest" },
  "186,141,141": { name: "Closed shrubland", group: "shrubGrass" },
  "245,222,179": { name: "Open shrubland", group: "shrubGrass" },
  "218,235,157": { name: "Woody savanna", group: "shrubGrass" },
  "255,213,0": { name: "Savanna", group: "shrubGrass" },
  "240,185,103": { name: "Grassland", group: "shrubGrass" },
  "71,131,181": { name: "Permanent wetland", group: "wetland" },
  "250,239,115": { name: "Cropland", group: "cropland" },
  "255,0,0": { name: "Urban and built-up", group: "built" },
  "153,147,86": { name: "Cropland / natural mosaic", group: "cropland" },
  "255,255,255": { name: "Snow and ice", group: "barren" },
  "191,191,189": { name: "Barren", group: "barren" },
  "134,202,227": { name: "Water", group: "water" },
};

/* i18n */export const COVER_META: Record<CoverGroup, { label: string; color: string }> = {
  // Same colours as NASA's land-cover map, so the table and the map read together.
  built: { label: "Built-up (urban)", color: "#ff0000" },
  cropland: { label: "Cropland", color: "#faef73" },
  forest: { label: "Forest", color: "#31cc31" },
  shrubGrass: { label: "Shrub, savanna & grass", color: "#ffd500" },
  wetland: { label: "Wetland", color: "#4783b5" },
  water: { label: "Water", color: "#86cae3" },
  barren: { label: "Barren / snow", color: "#bfbfbd" },
};/* /i18n */
const GROUPS = Object.keys(COVER_META) as CoverGroup[];

/** Map key: every IGBP class in the colour GIBS draws it, with plain-language labels. */
/* i18n */export const LANDCOVER_LEGEND: { rgb: string; label: string; hint?: string }[] = [
  { rgb: "255,0,0", label: "Urban and built-up" },
  { rgb: "250,239,115", label: "Cropland" },
  { rgb: "153,147,86", label: "Cropland / natural mosaic", hint: "Fields mixed with trees and villages (homestead gardens)." },
  { rgb: "255,213,0", label: "Savanna", hint: "In Bangladesh MODIS often labels mixed rice fields, homestead trees and seasonally flooded land as savanna." },
  { rgb: "218,235,157", label: "Woody savanna" },
  { rgb: "240,185,103", label: "Grassland" },
  { rgb: "186,141,141", label: "Closed shrubland" },
  { rgb: "245,222,179", label: "Open shrubland" },
  { rgb: "49,204,49", label: "Evergreen broadleaf forest" },
  { rgb: "150,250,150", label: "Deciduous broadleaf forest" },
  { rgb: "141,186,141", label: "Mixed forest" },
  { rgb: "33,138,33", label: "Evergreen needleleaf forest" },
  { rgb: "152,204,49", label: "Deciduous needleleaf forest" },
  { rgb: "71,131,181", label: "Permanent wetland" },
  { rgb: "134,202,227", label: "Water" },
  { rgb: "191,191,189", label: "Barren" },
  { rgb: "255,255,255", label: "Snow and ice" },
];/* /i18n */

export interface CoverStats { valid: number; share: Record<CoverGroup, number> } // shares in %, valid = pixel count
export interface CoverChange {
  a: CoverStats; b: CoverStats;
  changedPct: number; // % of comparable pixels whose group changed
  toBuiltPct: number; // % of comparable pixels that became built-up
  overlay: ImageData; // change map: newly built red, lost vegetation orange, gained vegetation green, water change blue
  pixelKm2: number;
  present: string[]; // IGBP colours ("r,g,b") that appear in either year, most common first

}

const groupAt = (d: Uint8ClampedArray, i: number): CoverGroup | null => (d[i + 3] < 128 ? null : IGBP[`${d[i]},${d[i + 1]},${d[i + 2]}`]?.group ?? null);
const isGreen = (g: CoverGroup | null) => g === "forest" || g === "cropland" || g === "shrubGrass" || g === "wetland";

function shares(d: Uint8ClampedArray): CoverStats {
  const n: Record<string, number> = {};
  let valid = 0;
  for (let i = 0; i < d.length; i += 4) { const g = groupAt(d, i); if (!g) continue; valid++; n[g] = (n[g] ?? 0) + 1; }
  return { valid, share: Object.fromEntries(GROUPS.map(g => [g, valid ? ((n[g] ?? 0) / valid) * 100 : 0])) as Record<CoverGroup, number> };
}

/** Land-cover composition of both years and a per-pixel change map (images must have the same size and extent). */
export function compareLandCover(a: ImageData, b: ImageData, areaKm2: number): CoverChange {
  const overlay = new ImageData(a.width, a.height), o = overlay.data;
  let both = 0, changed = 0, toBuilt = 0;
  const seen = new Map<string, number>();
  for (const d of [a.data, b.data]) for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const k = `${d[i]},${d[i + 1]},${d[i + 2]}`;
    if (k in IGBP) seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  for (let i = 0; i < a.data.length; i += 4) {
    const ga = groupAt(a.data, i), gb = groupAt(b.data, i);
    if (!ga || !gb) continue;
    both++;
    if (ga === gb) continue;
    changed++;
    let c: [number, number, number] | null = null;
    if (gb === "built") { toBuilt++; c = [255, 59, 48]; }
    else if (isGreen(ga) && !isGreen(gb)) c = [255, 149, 0];
    else if (!isGreen(ga) && isGreen(gb)) c = [52, 199, 89];
    else if (ga === "water" || gb === "water") c = [64, 156, 255];
    if (c) { o[i] = c[0]; o[i + 1] = c[1]; o[i + 2] = c[2]; o[i + 3] = 235; }
  }
  return {
    a: shares(a.data), b: shares(b.data),
    changedPct: both ? (changed / both) * 100 : 0, toBuiltPct: both ? (toBuilt / both) * 100 : 0,
    overlay, pixelKm2: areaKm2 / (a.width * a.height),
    present: [...seen].filter(([, n]) => n >= 4).sort((x, y) => y[1] - x[1]).map(([k]) => k),
  };
}

// ---------- NDVI ----------
const PAL = NDVI_PALETTE as [number, number, number, number][];
const cache = new Map<number, number | null>();
/** NDVI value of a rendered pixel (nearest palette colour), or null for no-data / water / cloud fill. */
export function ndviAt(d: Uint8ClampedArray, i: number): number | null {
  if (d[i + 3] < 128) return null;
  const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let best: number | null = null, bd = 1e9;
  for (const [r, g, b, v] of PAL) { const dd = (r - d[i]) ** 2 + (g - d[i + 1]) ** 2 + (b - d[i + 2]) ** 2; if (dd < bd) { bd = dd; best = v; } }
  const v = bd <= 60 ? best : null;
  cache.set(key, v);
  return v;
}

export interface NdviChange { meanA: number; meanB: number; denseA: number; denseB: number; greenerPct: number; brownerPct: number; valid: number; overlay: ImageData }

/** Average several composites per year (so one cloudy period doesn't dominate), then compare per pixel. */
export function compareNdvi(yearA: ImageData[], yearB: ImageData[]): NdviChange {
  const w = yearA[0].width, h = yearA[0].height, n = w * h;
  const mean = (imgs: ImageData[]) => {
    const out = new Float32Array(n).fill(NaN);
    for (let p = 0; p < n; p++) {
      let s = 0, k = 0;
      for (const img of imgs) { const v = ndviAt(img.data, p * 4); if (v !== null) { s += v; k++; } }
      if (k) out[p] = s / k;
    }
    return out;
  };
  const A = mean(yearA), B = mean(yearB);
  const overlay = new ImageData(w, h), o = overlay.data;
  let sa = 0, sb = 0, valid = 0, dA = 0, dB = 0, greener = 0, browner = 0;
  for (let p = 0; p < n; p++) {
    if (Number.isNaN(A[p]) || Number.isNaN(B[p])) continue;
    valid++; sa += A[p]; sb += B[p];
    if (A[p] >= 0.5) dA++;
    if (B[p] >= 0.5) dB++;
    const diff = B[p] - A[p];
    if (diff >= 0.1) { greener++; o[p * 4] = 52; o[p * 4 + 1] = 199; o[p * 4 + 2] = 89; o[p * 4 + 3] = Math.min(240, 120 + diff * 400); }
    else if (diff <= -0.1) { browner++; o[p * 4] = 214; o[p * 4 + 1] = 96; o[p * 4 + 2] = 32; o[p * 4 + 3] = Math.min(240, 120 - diff * 400); }
  }
  const pct = (x: number) => (valid ? (x / valid) * 100 : 0);
  return { meanA: valid ? sa / valid : 0, meanB: valid ? sb / valid : 0, denseA: pct(dA), denseB: pct(dB), greenerPct: pct(greener), brownerPct: pct(browner), valid, overlay };
}

/** Start dates of the MOD13 16-day composites (day-of-year 1, 17, 33 … each year). */
export function ndviComposites(year: number, month: number, count = 3, latest = new Date(Date.now() - 20 * 86_400_000)): string[] {
  const out: string[] = [];
  for (let doy = 1; doy <= 353 && out.length < count; doy += 16) {
    const d = new Date(Date.UTC(year, 0, doy));
    if (d.getUTCMonth() + 1 < month) continue;
    if (d > latest) break;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// ---------- Land-surface temperature (urban heat) ----------
// Daytime skin temperature of the ground and roofs (Terra overpass ≈ 10:30 local), not air temperature.
// One season can be hotter or cooler than another everywhere, so change is also reported *relative to the
// area-wide shift*: places that warmed more than their surroundings are where land use changed the heat.
const LST = LST_PALETTE as [number, number, number, number][];
const lstCache = new Map<number, number | null>();
/** Surface temperature (°C) of a rendered pixel, or null for cloud / no data. */
export function lstAt(d: Uint8ClampedArray, i: number): number | null {
  if (d[i + 3] < 128) return null;
  const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
  const hit = lstCache.get(key);
  if (hit !== undefined) return hit;
  let best: number | null = null, bd = 1e9;
  for (const [r, g, b, v] of LST) { const dd = (r - d[i]) ** 2 + (g - d[i + 1]) ** 2 + (b - d[i + 2]) ** 2; if (dd < bd) { bd = dd; best = v; } }
  const v = bd <= 60 ? best : null;
  lstCache.set(key, v);
  return v;
}

export interface LstChange {
  meanA: number; meanB: number;
  /** Hot-spot intensity: mean of the hottest 10% minus the area median (a surface urban-heat-island proxy). */
  hotA: number; hotB: number;
  maxA: number; maxB: number;
  /** Share of the area that warmed / cooled ≥ 1.5 °C more than the area-wide shift. */
  warmerPct: number; coolerPct: number;
  coverage: number; // share of pixels with clear-sky values in both years
  overlay: ImageData;
  /** Month-mean surface temperature per pixel (NaN = cloud), drawn on one shared colour scale lo…hi °C. */
  fieldA: Float32Array; fieldB: Float32Array; width: number; height: number; lo: number; hi: number;
}
export const LST_REL_THRESHOLD = 1.5;

const quantile = (sorted: Float32Array, q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];

export function compareLst(yearA: ImageData[], yearB: ImageData[]): LstChange {
  const w = yearA[0].width, h = yearA[0].height, n = w * h;
  const mean = (imgs: ImageData[]) => {
    const out = new Float32Array(n).fill(NaN);
    for (let p = 0; p < n; p++) {
      let s = 0, k = 0;
      for (const img of imgs) { const v = lstAt(img.data, p * 4); if (v !== null) { s += v; k++; } }
      if (k) out[p] = s / k;
    }
    return out;
  };
  const A = mean(yearA), B = mean(yearB);
  const both: number[] = [];
  for (let p = 0; p < n; p++) if (!Number.isNaN(A[p]) && !Number.isNaN(B[p])) both.push(p);
  const stats = (X: Float32Array) => {
    const v = Float32Array.from(both, p => X[p]).sort();
    const top = v.subarray(Math.floor(v.length * 0.9));
    const m = v.reduce((s, x) => s + x, 0) / Math.max(1, v.length);
    return { mean: m, hot: v.length ? top.reduce((s, x) => s + x, 0) / Math.max(1, top.length) - quantile(v, 0.5) : 0, max: v.length ? quantile(v, 0.99) : 0 };
  };
  const a = stats(A), b = stats(B), shift = b.mean - a.mean;
  const overlay = new ImageData(w, h), o = overlay.data;
  let warmer = 0, cooler = 0;
  for (const p of both) {
    const rel = B[p] - A[p] - shift;
    if (rel >= LST_REL_THRESHOLD) { warmer++; o[p * 4] = 255; o[p * 4 + 1] = 59; o[p * 4 + 2] = 48; o[p * 4 + 3] = Math.min(240, 110 + rel * 30); }
    else if (rel <= -LST_REL_THRESHOLD) { cooler++; o[p * 4] = 64; o[p * 4 + 1] = 156; o[p * 4 + 2] = 255; o[p * 4 + 3] = Math.min(240, 110 - rel * 30); }
  }
  const pct = (x: number) => (both.length ? (x / both.length) * 100 : 0);
  const all = Float32Array.from([...both.map(p => A[p]), ...both.map(p => B[p])]).sort();
  const lo = all.length ? Math.floor(quantile(all, 0.02)) : 20, hi = all.length ? Math.ceil(quantile(all, 0.98)) : 45;
  return { meanA: a.mean, meanB: b.mean, hotA: a.hot, hotB: b.hot, maxA: a.max, maxB: b.max, warmerPct: pct(warmer), coolerPct: pct(cooler), coverage: both.length / n, overlay, fieldA: A, fieldB: B, width: w, height: h, lo, hi: Math.max(hi, lo + 1) };
}

/** Perceptual heat ramp (inferno-like) used to draw surface temperature. */
export const HEAT_RAMP = ["#000004", "#420a68", "#932667", "#dd513a", "#fca50a", "#fcffa4"];
export function renderLst(field: Float32Array, w: number, h: number, lo: number, hi: number): ImageData {
  const stops = HEAT_RAMP.map(c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)));
  const out = new ImageData(w, h), o = out.data;
  for (let p = 0; p < w * h; p++) {
    const v = field[p];
    if (Number.isNaN(v)) continue; // cloud: transparent
    const x = Math.min(1, Math.max(0, (v - lo) / (hi - lo))) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
    for (let c = 0; c < 3; c++) o[p * 4 + c] = stops[i][c] + (stops[i + 1][c] - stops[i][c]) * f;
    o[p * 4 + 3] = 255;
  }
  return out;
}

/** Start dates of the MOD11A2 8-day composites (day-of-year 1, 9, 17 … each year) that begin in `month`. */
export function lstComposites(year: number, month: number, latest = new Date(Date.now() - 12 * 86_400_000)): string[] {
  const out: string[] = [];
  for (let doy = 1; doy <= 361; doy += 8) {
    const d = new Date(Date.UTC(year, 0, doy));
    if (d.getUTCMonth() + 1 !== month) continue;
    if (d > latest) break;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
