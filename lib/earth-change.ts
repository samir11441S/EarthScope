// Measuring land change from NASA's official MODIS products (client-side pixel decoding).
//
//   • MODIS MCD12Q1 land cover (IGBP scheme), 500 m, yearly — GIBS layer MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual
//   • MODIS MOD13Q1 NDVI, 250 m, 16-day composites    — GIBS layer MODIS_Terra_L3_NDVI_16Day
//
// GIBS renders both with fixed colour maps (colormaps/v1.3/MODIS_IGBP_Land_Cover_Type.xml and MODIS_NDVI.xml),
// so each pixel can be decoded back to its class or NDVI value exactly.
import NDVI_PALETTE from "./ndvi-palette.json";

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
  built: { label: "Built-up (urban)", color: "#ff3b30" },
  cropland: { label: "Cropland", color: "#f2d64b" },
  forest: { label: "Forest", color: "#2f9e44" },
  shrubGrass: { label: "Shrub, savanna & grass", color: "#c9a96e" },
  wetland: { label: "Wetland", color: "#4783b5" },
  water: { label: "Water", color: "#86cae3" },
  barren: { label: "Barren / snow", color: "#bfbfbd" },
};/* /i18n */
const GROUPS = Object.keys(COVER_META) as CoverGroup[];

export interface CoverStats { valid: number; share: Record<CoverGroup, number> } // shares in %, valid = pixel count
export interface CoverChange {
  a: CoverStats; b: CoverStats;
  changedPct: number; // % of comparable pixels whose group changed
  toBuiltPct: number; // % of comparable pixels that became built-up
  overlay: ImageData; // change map: newly built red, lost vegetation orange, gained vegetation green, water change blue
  pixelKm2: number;
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
