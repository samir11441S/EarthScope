// Real cloud cover for the 3D globe, rebuilt every day from NASA GIBS VIIRS true colour.
//
// Standard multi-day cloud clearing: clouds move from day to day while sea ice, snow and bright deserts
// do not, so the darkest value of each pixel over the previous days is the surface, and only what is
// brighter (and white) on the chosen day is cloud. Shared by /api/clouds and scripts/build-globe-textures.mts.

export const CLOUD_LAYERS = ["VIIRS_NOAA20_CorrectedReflectance_TrueColor", "VIIRS_SNPP_CorrectedReflectance_TrueColor"] as const;
export const GIBS_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";

/** The newest day whose global VIIRS composite is reliably complete (two days ago, UTC). */
export const cloudDate = (now = Date.now()) => new Date(now - 2 * 86_400_000).toISOString().slice(0, 10);
export const dayBefore = (date: string, days: number) => new Date(Date.parse(date) - days * 86_400_000).toISOString().slice(0, 10);

export function wmsUrl(layer: string, width: number, time: string) {
  return `${GIBS_WMS}?${new URLSearchParams({ SERVICE: "WMS", REQUEST: "GetMap", VERSION: "1.1.1", LAYERS: layer, STYLES: "", FORMAT: "image/jpeg", SRS: "EPSG:4326", BBOX: "-180,-90,180,90", WIDTH: String(width), HEIGHT: String(width / 2), TIME: time })}`;
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lum = (d: Uint8Array, i: number) => (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;

/**
 * Builds a greyscale cloud-opacity mask (RGBA, white = cloud) from the chosen day's NOAA-20 and Suomi NPP
 * passes and any number of earlier passes (all equirectangular RGBA of the same size).
 */
export function cloudMask(noaa: Uint8Array, snpp: Uint8Array, history: Uint8Array[], W: number, H: number) {
  const out = new Uint8Array(W * H * 4);
  let cloudy = 0;
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    // Today's view: the darker of the two passes (~50 min apart). Clouds appear in both, while sun glint
    // on the ocean falls in a different place in each and is removed. In orbit gaps, the pass with data is used.
    const ln = lum(noaa, i), ls = lum(snpp, i);
    const src = ln > 0.04 && (ls <= 0.04 || ln <= ls) ? noaa : snpp;
    const L = lum(src, i);
    if (L <= 0.04) continue; // no data (polar night / orbit gap)
    // Permanent surface brightness = darkest valid value over the previous days (ice, snow, desert).
    let surface = Infinity;
    for (const h of history) { const v = lum(h, i); if (v > 0.04 && v < surface) surface = v; }
    if (!Number.isFinite(surface)) surface = L;
    const mx = Math.max(src[i], src[i + 1], src[i + 2]), mn = Math.min(src[i], src[i + 1], src[i + 2]), sat = (mx - mn) / 255;
    const a = smooth(0.07, 0.32, L - surface) * (1 - smooth(0.1, 0.26, sat)) * smooth(0.25, 0.48, L);
    // Near the poles the low sun and the ice sheets make the imagery unreliable: fade out beyond 70°.
    const lat = 90 - ((Math.floor(p / W) + 0.5) / H) * 180;
    const v = Math.round(255 * a * (1 - smooth(68, 76, Math.abs(lat))));
    out[i] = out[i + 1] = out[i + 2] = v; out[i + 3] = 255;
    if (a > 0.5) cloudy++;
  }
  // Light 3×3 smoothing removes pixel-level speckle from day-to-day lighting differences.
  const sm = new Uint8Array(out.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let sum = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy, xx = (x + dx + W) % W;
      if (yy < 0 || yy >= H) continue;
      sum += out[(yy * W + xx) * 4]; n++;
    }
    const v = Math.round(sum / n), i = (y * W + x) * 4;
    sm[i] = sm[i + 1] = sm[i + 2] = v; sm[i + 3] = 255;
  }
  return { mask: sm, cloudyPct: (cloudy / (W * H)) * 100 };
}
