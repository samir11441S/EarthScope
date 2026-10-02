// Rebuilds lib/global-record.json from the original agency files (no hand-typed numbers).
//   node scripts/build-global-record.mts
//   • NASA GISTEMP v4 zonal annual means (°C anomaly vs 1951–1980)
//   • NSIDC Sea Ice Index v4, Arctic September (annual minimum month) extent, million km²
//   • NOAA GML Mauna Loa annual mean CO2, ppm
import { writeFile } from "node:fs/promises";

const FIRST = 1981;
const SOURCES = {
  gistemp: "https://data.giss.nasa.gov/gistemp/tabledata_v4/ZonAnn.Ts+dSST.csv",
  seaIce: "https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data/N_09_extent_v4.0.csv",
  co2: "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_annmean_mlo.txt",
};

async function text(url: string) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "terra-climate-time-machine/1.0" }, signal: AbortSignal.timeout(90000) });
      if (r.ok) return await r.text();
    } catch {}
    await new Promise(res => setTimeout(res, 2000 * (i + 1)));
  }
  throw new Error(`Could not download ${url}`);
}

const [zon, ice, co2] = await Promise.all([text(SOURCES.gistemp), text(SOURCES.seaIce), text(SOURCES.co2)]);

// GISTEMP: header Year,Glob,NHem,SHem,24N-90N,24S-24N,90S-24S,64N-90N,44N-64N,24N-44N,EQU-24N,24S-EQU,44S-24S,64S-44S,90S-64S
const rows = zon.trim().split(/\r?\n/);
const head = rows[0].split(",");
const col = (name: string) => { const i = head.indexOf(name); if (i < 0) throw new Error(`GISTEMP column ${name} missing`); return i; };
const C = { glob: col("Glob"), arctic: col("64N-90N"), nMid: col("44N-64N"), nSub: col("24N-44N"), n0: col("EQU-24N"), s0: col("24S-EQU"), sSub: col("44S-24S"), sMid: col("64S-44S"), antarctic: col("90S-64S") };
const temps = new Map<number, number[]>();
for (const r of rows.slice(1)) {
  const c = r.split(",");
  const y = Number(c[0]);
  const vals = [C.glob, C.arctic, C.nMid, C.nSub, C.n0, C.s0, C.sSub, C.sMid, C.antarctic].map(i => Number(c[i]));
  if (y >= FIRST && vals.every(Number.isFinite)) temps.set(y, vals);
}

const iceBy = new Map<number, number>();
for (const line of ice.trim().split(/\r?\n/).slice(1)) {
  const c = line.split(",").map(s => s.trim());
  const y = Number(c[0]), extent = Number(c[4]);
  if (y >= FIRST && extent > 0) iceBy.set(y, extent);
}

const co2By = new Map<number, number>();
for (const line of co2.split(/\r?\n/)) {
  if (line.startsWith("#") || !line.trim()) continue;
  const [y, mean] = line.trim().split(/\s+/).map(Number);
  if (y >= FIRST && mean > 0) co2By.set(y, mean);
}

const years: Record<number, unknown> = {};
for (const [y, t] of [...temps].sort((a, b) => a[0] - b[0])) {
  if (!iceBy.has(y) || !co2By.has(y)) continue; // keep only years complete in all three records
  years[y] = {
    globalTempAnomaly: t[0], arcticTempAnomaly: t[1], northMidTempAnomaly: t[2], northSubTempAnomaly: t[3],
    equTo24NTempAnomaly: t[4], equTo24STempAnomaly: t[5], southSubTempAnomaly: t[6], southMidTempAnomaly: t[7], antarcticTempAnomaly: t[8],
    seaIceExtent: iceBy.get(y), co2Ppm: co2By.get(y),
  };
}
const list = Object.keys(years).map(Number);
const out = { built: new Date().toISOString().slice(0, 10), first: Math.min(...list), last: Math.max(...list), sources: SOURCES, years };
await writeFile(new URL("../lib/global-record.json", import.meta.url), JSON.stringify(out, null, 1));
console.log(`lib/global-record.json: ${out.first}–${out.last} (${list.length} years)`);
