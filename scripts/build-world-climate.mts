// Precomputes the world-level layer of the Climate Atlas.
//   node scripts/build-world-climate.mts
// 1. Downloads Natural Earth 1:110m country outlines (public domain) and slims them.
// 2. Samples NASA POWER (MERRA-2) monthly T2M + PRECTOTCORR at up to 8 points inside each
//    country, 1981–2025, and stores a cos(latitude)-weighted annual mean per country.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { geometryBBox, pointInGeometry, representativePoint, simplifyGeometry, type Geometry } from "../lib/geo.ts";

const FIRST = 1981, LAST = 2025, YEARS = Array.from({ length: LAST - FIRST + 1 }, (_, i) => FIRST + i);
const OUT = new URL("../public/data/", import.meta.url);
const NE = "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_countries.geojson";
// Cache is keyed by the year range so a change of period never reuses old series.
const CACHE_FILE = new URL(`../.wrangler/world-climate-points-${FIRST}-${LAST}.json`, import.meta.url);

type NeFeature = { properties: Record<string, string | number>; geometry: Geometry };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function samplePoints(g: Geometry): [number, number][] {
  const [x0, y0, x1, y1] = geometryBBox(g);
  const spacing = Math.min(12, Math.max(0.75, Math.sqrt(((x1 - x0) * (y1 - y0)) / 14)));
  const pts: [number, number][] = [];
  for (let y = y0 + spacing / 2; y < y1; y += spacing)
    for (let x = x0 + spacing / 2; x < x1; x += spacing) if (pointInGeometry(x, y, g)) pts.push([x, y]);
  const rep = representativePoint(g);
  if (!pts.length) return [rep];
  if (pts.length <= 8) return pts;
  const step = pts.length / 8;
  return Array.from({ length: 8 }, (_, i) => pts[Math.floor(i * step + step / 2)]);
}

async function powerPoint(lon: number, lat: number): Promise<{ t: (number | null)[]; p: (number | null)[] }> {
  const url = `https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=T2M,PRECTOTCORR&community=RE&longitude=${lon.toFixed(3)}&latitude=${lat.toFixed(3)}&start=${FIRST}&end=${LAST}&format=JSON`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (r.status === 429 || r.status >= 500) throw new Error(String(r.status));
      if (!r.ok) break;
      const j = (await r.json()) as { properties: { parameter: { T2M: Record<string, number>; PRECTOTCORR: Record<string, number> } } };
      const { T2M, PRECTOTCORR } = j.properties.parameter;
      return {
        t: YEARS.map(y => (T2M[`${y}13`] > -900 ? T2M[`${y}13`] : null)),
        p: YEARS.map(y => (PRECTOTCORR[`${y}13`] >= 0 ? PRECTOTCORR[`${y}13`] * (y % 4 === 0 ? 366 : 365) : null)),
      };
    } catch {
      await sleep(1500 * (attempt + 1));
    }
  }
  return { t: YEARS.map(() => null), p: YEARS.map(() => null) };
}

async function pool<T, R>(items: T[], size: number, fn: (x: T, i: number) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
      if (++done % 25 === 0) console.log(`  ${done}/${items.length} points`);
    }
  }));
  return out;
}

const ne = (await (await fetch(NE)).json()) as { features: NeFeature[] };
const countries = ne.features.map(f => {
  const p = f.properties;
  const iso = String(p.ISO_A3 !== "-99" ? p.ISO_A3 : p.ADM0_A3);
  return { iso, name: String(p.NAME), continent: String(p.CONTINENT), geometry: f.geometry };
});

const geo = {
  type: "FeatureCollection",
  features: countries.map(c => ({ type: "Feature", id: c.iso, properties: { id: c.iso, name: c.name, iso: c.iso, continent: c.continent }, geometry: simplifyGeometry(c.geometry, 0.08, 2) })),
};

let cache: Record<string, { t: (number | null)[]; p: (number | null)[] }> = {};
try { cache = JSON.parse(await readFile(CACHE_FILE, "utf8")); } catch {}
const jobs = countries.flatMap(c => samplePoints(c.geometry).map(pt => ({ iso: c.iso, pt })));
console.log(`${countries.length} countries, ${jobs.length} sample points`);
const series = await pool(jobs, 8, async job => {
  const key = `${job.pt[0].toFixed(3)},${job.pt[1].toFixed(3)}`;
  if (!cache[key]?.t.some(v => v !== null)) cache[key] = await powerPoint(job.pt[0], job.pt[1]);
  return cache[key];
});
await mkdir(new URL("../.wrangler/", import.meta.url), { recursive: true });
await writeFile(CACHE_FILE, JSON.stringify(cache));

const climate: Record<string, { name: string; points: number; t: (number | null)[]; p: (number | null)[] }> = {};
for (const c of countries) {
  const rows = jobs.map((j, i) => ({ j, s: series[i] })).filter(r => r.j.iso === c.iso);
  const avg = (key: "t" | "p") => YEARS.map((_, yi) => {
    let sum = 0, w = 0;
    for (const { j, s } of rows) { const v = s[key][yi]; if (v === null) continue; const wt = Math.cos((j.pt[1] * Math.PI) / 180); sum += v * wt; w += wt; }
    return w ? Math.round((sum / w) * (key === "t" ? 100 : 1)) / (key === "t" ? 100 : 1) : null;
  });
  climate[c.iso] = { name: c.name, points: rows.length, t: avg("t"), p: avg("p") };
}

await mkdir(OUT, { recursive: true });
await writeFile(new URL("world-countries.json", OUT), JSON.stringify(geo));
await writeFile(new URL("world-climate.json", OUT), JSON.stringify({ years: YEARS, source: "NASA POWER (MERRA-2), sampled at up to 8 points per country, cos-latitude weighted", built: new Date().toISOString().slice(0, 10), countries: climate }));
console.log("wrote public/data/world-countries.json and world-climate.json");
