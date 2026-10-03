// Downloads the 3D globe's textures from NASA GIBS (all public NASA imagery, no hand edits).
//   node scripts/build-globe-textures.mts [YYYY-MM-DD]   (cloud date; default: 3 days ago)
//   • earth-day.jpg     Blue Marble shaded relief + bathymetry (NASA Visible Earth), 4096×2048
//   • earth-night.jpg   VIIRS Black Marble city lights (2016), 4096×2048
//   • earth-clouds.jpg  Cloud cover for one real day (white = cloud opacity), 2048×1024 — the offline
//                       fallback for /api/clouds, which rebuilds it daily (algorithm in lib/clouds.ts).
import { mkdir, writeFile } from "node:fs/promises";
import jpeg from "jpeg-js";
import { CLOUD_LAYERS, cloudMask, dayBefore, wmsUrl } from "../lib/clouds.ts";

const date = process.argv[2] ?? new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
const WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";
const W = 2048, H = 1024, CLEAR_DAYS = 10;

async function get(url: string, what: string): Promise<Buffer> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url);
    if (res.ok && res.headers.get("content-type")?.includes("image")) return Buffer.from(await res.arrayBuffer());
  }
  throw new Error(`${what}: download failed`);
}
const still = (layer: string, w: number) => `${WMS}?${new URLSearchParams({ SERVICE: "WMS", REQUEST: "GetMap", VERSION: "1.1.1", LAYERS: layer, STYLES: "", FORMAT: "image/jpeg", SRS: "EPSG:4326", BBOX: "-180,-90,180,90", WIDTH: String(w), HEIGHT: String(w / 2) })}`;

await mkdir("public/textures", { recursive: true });
for (const job of [{ file: "earth-day.jpg", layer: "BlueMarble_ShadedRelief_Bathymetry" }, { file: "earth-night.jpg", layer: "VIIRS_Black_Marble" }]) {
  const buf = await get(still(job.layer, 4096), job.layer);
  await writeFile(`public/textures/${job.file}`, buf);
  console.log(`${job.file}  ${job.layer}  ${(buf.length / 1024).toFixed(0)} KB`);
}

// --- Clouds (same algorithm as /api/clouds, see lib/clouds.ts) -----------------------------------
const decode = (b: Buffer) => jpeg.decode(b, { useTArray: true, formatAsRGBA: true }).data;
const [noaa, snpp] = await Promise.all(CLOUD_LAYERS.map(l => get(wmsUrl(l, W, date), l))).then(bs => bs.map(decode));
const history: Uint8Array[] = [];
for (let k = 1; k <= CLEAR_DAYS; k++) {
  for (const layer of CLOUD_LAYERS) {
    try { history.push(decode(await get(wmsUrl(layer, W, dayBefore(date, k)), layer))); } catch { /* a missing day is fine */ }
  }
  process.stdout.write(`\rcloud clearing: ${history.length} past passes`);
}
console.log();
const { mask, cloudyPct } = cloudMask(noaa, snpp, history, W, H);
const enc = jpeg.encode({ data: mask, width: W, height: H }, 88).data;
await writeFile("public/textures/earth-clouds.jpg", enc);
console.log(`earth-clouds.jpg  cloud mask ${date} (${history.length} clearing passes)  ${(enc.length / 1024).toFixed(0)} KB  · ${cloudyPct.toFixed(0)}% cloudy`);
await writeFile("public/textures/clouds-date.json", JSON.stringify({ date, method: "multi-day minimum-brightness cloud clearing", passes: history.length, source: "NOAA-20 + Suomi NPP VIIRS corrected reflectance via NASA GIBS" }) + "\n");
