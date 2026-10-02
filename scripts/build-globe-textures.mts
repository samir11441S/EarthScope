// Downloads the 3D globe's textures from NASA GIBS (all public NASA imagery, no hand edits).
//   node scripts/build-globe-textures.mts [YYYY-MM-DD]   (cloud date; default: 3 days ago)
//   • earth-day.jpg     Blue Marble shaded relief + bathymetry (NASA Visible Earth), 4096×2048
//   • earth-night.jpg   VIIRS Black Marble city lights (2016), 4096×2048
//   • earth-clouds.jpg  Cloud cover for one real day (white = cloud opacity), 2048×1024, made by
//                       standard multi-day cloud clearing of NOAA-20 / Suomi NPP VIIRS true colour:
//                       clouds move from day to day while sea ice, snow and bright deserts do not,
//                       so the darkest value of each pixel over the previous days is the surface and
//                       only what is brighter (and white) on the chosen day is cloud.
import { mkdir, writeFile } from "node:fs/promises";
import jpeg from "jpeg-js";

const date = process.argv[2] ?? new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
const WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";
const W = 2048, H = 1024, CLEAR_DAYS = 10;

async function wms(layer: string, w: number, time?: string): Promise<Buffer> {
  const params = new URLSearchParams({ SERVICE: "WMS", REQUEST: "GetMap", VERSION: "1.1.1", LAYERS: layer, STYLES: "", FORMAT: "image/jpeg", SRS: "EPSG:4326", BBOX: "-180,-90,180,90", WIDTH: String(w), HEIGHT: String(w / 2) });
  if (time) params.set("TIME", time);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${WMS}?${params}`);
    if (res.ok && res.headers.get("content-type")?.includes("image")) return Buffer.from(await res.arrayBuffer());
  }
  throw new Error(`${layer} ${time ?? ""}: download failed`);
}
const day = (offset: number) => new Date(Date.parse(date) - offset * 86_400_000).toISOString().slice(0, 10);
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

await mkdir("public/textures", { recursive: true });
for (const job of [{ file: "earth-day.jpg", layer: "BlueMarble_ShadedRelief_Bathymetry" }, { file: "earth-night.jpg", layer: "VIIRS_Black_Marble" }]) {
  const buf = await wms(job.layer, 4096);
  await writeFile(`public/textures/${job.file}`, buf);
  console.log(`${job.file}  ${job.layer}  ${(buf.length / 1024).toFixed(0)} KB`);
}

// --- Clouds: decode today's two VIIRS passes plus the previous days -----------------------------
const decode = (b: Buffer) => jpeg.decode(b, { useTArray: true, formatAsRGBA: true }).data;
const lum = (d: Uint8Array, i: number) => (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
const [noaa, snpp] = await Promise.all([wms("VIIRS_NOAA20_CorrectedReflectance_TrueColor", W, date), wms("VIIRS_SNPP_CorrectedReflectance_TrueColor", W, date)]).then(bs => bs.map(decode));
const history: Uint8Array[] = [];
for (let k = 1; k <= CLEAR_DAYS; k++) {
  for (const layer of ["VIIRS_NOAA20_CorrectedReflectance_TrueColor", "VIIRS_SNPP_CorrectedReflectance_TrueColor"]) {
    try { history.push(decode(await wms(layer, W, day(k)))); } catch { /* a missing day is fine */ }
  }
  process.stdout.write(`\rcloud clearing: ${history.length} past passes`);
}
console.log();

const out = new Uint8Array(W * H * 4);
let cloudy = 0;
for (let p = 0; p < W * H; p++) {
  const i = p * 4;
  // Today's view: the darker of the NOAA-20 and Suomi NPP passes (~50 min apart). Clouds appear in
  // both, while sun glint on the ocean falls in a different place in each and is removed. Where only
  // one pass has data (orbit gaps), that pass is used.
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
  const polar = 1 - smooth(68, 76, Math.abs(lat));
  const v = Math.round(255 * a * polar);
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
const enc = jpeg.encode({ data: sm, width: W, height: H }, 88).data;
await writeFile("public/textures/earth-clouds.jpg", enc);
console.log(`earth-clouds.jpg  cloud mask ${date} (${history.length} clearing passes)  ${(enc.length / 1024).toFixed(0)} KB  · ${((cloudy / (W * H)) * 100).toFixed(0)}% cloudy`);
await writeFile("public/textures/clouds-date.json", JSON.stringify({ date, method: "multi-day minimum-brightness cloud clearing", passes: history.length, source: "NOAA-20 + Suomi NPP VIIRS corrected reflectance via NASA GIBS" }) + "\n");
