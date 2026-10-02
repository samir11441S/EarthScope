"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { CircleHelp, Columns2, Layers3, LoaderCircle, ScanSearch, Sparkles, SplitSquareHorizontal, Waypoints } from "lucide-react";
import { RangeControl as Slider } from "./range-control";
import type { Place } from "@/lib/climate";
import { compareLandCover, compareNdvi, COVER_META, LANDCOVER_YEARS, ndviComposites, type CoverChange, type CoverGroup, type NdviChange } from "@/lib/earth-change";

// Satellite comparison, rebuilt for like-for-like accuracy:
//   • Land cover — NASA MODIS MCD12Q1 (official yearly classification), measured shares + change map.
//   • Vegetation — MODIS MOD13Q1 NDVI, the same season in both years (three 16-day composites averaged).
//   • Satellite view — 30 m Landsat/Sentinel-2 (HLS) or MODIS false colour, the same month in both years,
//     the clearest pass in each, preferring the same sensor. Visual context only.

type Mode = "landcover" | "vegetation" | "imagery";
export type ImageryKind = "hls" | "false721";
type View = "swipe" | "side" | "changes";
export type Scene = { date: string; sensor: "S30" | "L30" | "MODIS"; score: number };

const ZOOMS = [
  { label: "City", km: 45, span: 0.4 },
  { label: "Metro", km: 90, span: 0.8 },
  { label: "Region", km: 240, span: 2.2 },
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SENSOR_NAME = { S30: "Sentinel-2", L30: "Landsat 8/9", MODIS: "Terra MODIS" } as const;
const SIZE_ANALYSIS = 512;

const nowYear = () => new Date().getUTCFullYear();
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
const fmtDate = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** Latest year whose given month (day 15) is already in the past. */
const latestYearFor = (month: number) => (Date.now() > Date.UTC(nowYear(), month - 1, 28) ? nowYear() : nowYear() - 1);
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const img = (p: Place, layer: string, date: string, span: number, size: number, extra = "") =>
  `/api/imagery?lat=${p.lat}&lon=${p.lon}&date=${date}&layer=${layer}&span=${span}&size=${size}${extra}`;

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.decoding = "async";
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("image failed"));
    el.src = src;
  });
}
const pixelCache = new Map<string, Promise<ImageData>>();
/** Pixels of a same-origin image (from Terra's /api/imagery), cached. */
export function pixels(src: string, size: number) {
  let job = pixelCache.get(src);
  if (!job) {
    job = loadImage(src).then(el => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.imageSmoothingEnabled = false; // categorical colours must not be blended
      ctx.drawImage(el, 0, 0, size, size);
      return ctx.getImageData(0, 0, size, size);
    });
    job.catch(() => pixelCache.delete(src));
    pixelCache.set(src, job);
  }
  return job;
}

/** Fraction of ground pixels: not empty (outside the swath) and not bright cloud. */
async function clearFraction(src: string) {
  try {
    const d = (await pixels(src, 64)).data;
    let good = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (r + g + b >= 36 && !(mn > 175 && mx - mn < 30)) good++;
    }
    return good / (d.length / 4);
  } catch { return 0; }
}

const sceneCache = new Map<string, Promise<Scene | null>>();
/**
 * Clearest pass near a target date. HLS: Landsat 8/9 and Sentinel-2 within ±24 days, preferring
 * `prefer` (so both years use the same sensor when possible). MODIS: daily within ±10 days.
 */
export function findClearestScene(p: Place, kind: ImageryKind, target: string, span: number, prefer: "S30" | "L30" | null) {
  const key = `${p.lat},${p.lon},${kind},${target},${span},${prefer}`;
  let job = sceneCache.get(key);
  if (!job) {
    job = (async () => {
      const reach = kind === "hls" ? 24 : 10, step = kind === "hls" ? 2 : 1;
      const offsets = [0, ...Array.from({ length: Math.floor(reach / step) }, (_, i) => [-(i + 1) * step, (i + 1) * step]).flat()];
      const cands: { date: string; sensor: Scene["sensor"] }[] = [];
      for (const o of offsets) {
        const date = addDays(target, o);
        if (date > today() || date < (kind === "hls" ? "2013-04-11" : "2000-02-24")) continue;
        if (kind === "hls") { if (date >= "2015-11-28") cands.push({ date, sensor: "S30" }); cands.push({ date, sensor: "L30" }); }
        else cands.push({ date, sensor: "MODIS" });
      }
      const url = (c: { date: string; sensor: Scene["sensor"] }, size: number) =>
        kind === "hls" ? img(p, "hls", c.date, span, size, `&sensor=${c.sensor}`) : img(p, "false721", c.date, span, size);
      const better = (a: Scene, b: Scene) => {
        const bonus = (s: Scene) => (prefer && s.sensor === prefer ? 0.03 : 0); // same sensor in both years when nearly as clear
        if (Math.abs(a.score + bonus(a) - b.score - bonus(b)) > 0.02) return a.score + bonus(a) > b.score + bonus(b);
        return Math.abs(Date.parse(a.date) - Date.parse(target)) < Math.abs(Date.parse(b.date) - Date.parse(target));
      };
      let best: Scene | null = null, next = 0;
      await Promise.all(Array.from({ length: 6 }, async () => {
        while (next < cands.length && !(best && best.score >= 0.98 && (!prefer || best.sensor === prefer))) {
          const c = cands[next++];
          const s: Scene = { ...c, score: await clearFraction(url(c, 64)) };
          if (!best || better(s, best)) best = s;
        }
      }));
      return best && (best as Scene).score > 0.25 ? best : null;
    })();
    sceneCache.set(key, job);
  }
  return job;
}

const enhanceCache = new Map<string, Promise<string>>();
/** Brightness-driven contrast stretch (same on all channels, so hue is kept) to lift haze. Display only. */
function enhanced(src: string) {
  let job = enhanceCache.get(src);
  if (!job) {
    job = (async () => {
      const el = await loadImage(src);
      const c = document.createElement("canvas");
      c.width = el.naturalWidth; c.height = el.naturalHeight;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(el, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height), d = data.data;
      const hist = new Uint32Array(256);
      let n = 0;
      for (let i = 0; i < d.length; i += 16) { if (d[i] + d[i + 1] + d[i + 2] < 24) continue; hist[Math.round(0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2])]++; n++; }
      if (n < 100) return src;
      const pct = (q: number) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * q) return v; } return 255; };
      const lo = pct(0.01), span = Math.max(24, pct(0.995) - lo), lut = new Uint8ClampedArray(256);
      for (let v = 0; v < 256; v++) lut[v] = 255 * Math.pow(Math.min(1, Math.max(0, (v - lo) / span)), 0.95);
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] + d[i + 1] + d[i + 2] < 24) continue;
        let r = lut[d[i]], g = lut[d[i + 1]], b = lut[d[i + 2]];
        const l = 0.3 * r + 0.59 * g + 0.11 * b;
        r = l + (r - l) * 1.25; g = l + (g - l) * 1.25; b = l + (b - l) * 1.25;
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
      }
      ctx.putImageData(data, 0, 0);
      const blob = await new Promise<Blob | null>(res => c.toBlob(res, "image/jpeg", 0.92));
      return blob ? URL.createObjectURL(blob) : src;
    })().catch(() => src);
    enhanceCache.set(src, job);
  }
  return job;
}

function Picture({ src, alt, enhance = false, pixelated = false, waiting }: { src: string | null; alt: string; enhance?: boolean; pixelated?: boolean; waiting?: string }) {
  const [shown, setShown] = useState<{ from: string; url: string } | null>(null);
  const [state, setState] = useState<{ url: string; ok: boolean } | null>(null);
  useEffect(() => {
    if (!src) return;
    let active = true;
    (enhance ? enhanced(src) : Promise.resolve(src)).then(url => { if (active) setShown({ from: src, url }); });
    return () => { active = false; };
  }, [src, enhance]);
  const url = shown && shown.from === src ? shown.url : null;
  const ok = !!url && state?.url === url && state.ok;
  const failed = !!url && state?.url === url && !state.ok;
  return <div className="sat-image">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {url && <img key={url} src={url} alt={alt} onLoad={() => setState({ url, ok: true })} onError={() => setState({ url, ok: false })} style={{ opacity: ok ? 1 : 0, imageRendering: pixelated ? "pixelated" : undefined }} />}
    {!ok && <div className="image-status">{failed ? <><Layers3 size={25} /><span>No image available for this date.</span><small>Try another year or month; satellite coverage varies.</small></> : <><LoaderCircle className="spin" size={22} /><span>{src ? "Loading NASA imagery…" : waiting ?? "Finding the clearest satellite pass…"}</span></>}</div>}
  </div>;
}

function Overlay({ data }: { data: ImageData | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !data) return;
    c.width = data.width; c.height = data.height;
    c.getContext("2d")!.putImageData(data, 0, 0);
  }, [data]);
  return <canvas ref={ref} className="change-overlay" aria-hidden="true" />;
}

const signedPts = (v: number, d = 1) => `${v > 0 ? "+" : ""}${v.toFixed(d)}`;

export default function SatelliteComparison({ place, large = false }: { place: Place; large?: boolean }) {
  const [mode, setMode] = useState<Mode>(large ? "landcover" : "imagery");
  const [kind, setKind] = useState<ImageryKind>("hls");
  const [view, setView] = useState<View>("swipe");
  const [split, setSplit] = useState(50);
  const [zoom, setZoom] = useState(0);
  const [month, setMonth] = useState(1);
  const [enhance, setEnhance] = useState(true);
  const [years, setYears] = useState<Record<Mode | "false721", [number, number]>>(() => ({
    landcover: [LANDCOVER_YEARS[0], LANDCOVER_YEARS[1]],
    vegetation: [2001, latestYearFor(3)],
    imagery: [2014, nowYear() - 1], // Landsat in both years; current-year L30 often lags in GIBS
    false721: [2001, latestYearFor(1)],
  }));
  const yearKey: Mode | "false721" = mode === "imagery" && kind === "false721" ? "false721" : mode;
  const [ya, yb] = years[yearKey];
  const setYear = (i: 0 | 1, v: number) => setYears(y => ({ ...y, [yearKey]: (i === 0 ? [v, y[yearKey][1]] : [y[yearKey][0], v]) as [number, number] }));
  const span = ZOOMS[zoom].span, areaKm2 = (span * 110.57) ** 2;
  const yearOptions = mode === "landcover" ? range(LANDCOVER_YEARS[0], LANDCOVER_YEARS[1])
    : mode === "vegetation" ? range(2001, latestYearFor(month))
    : kind === "hls" ? range(2013, latestYearFor(month)) : range(2000, latestYearFor(month));

  // ---- Land cover -------------------------------------------------------------
  const lcA = img(place, "landcover", `${ya}-01-01`, span, SIZE_ANALYSIS), lcB = img(place, "landcover", `${yb}-01-01`, span, SIZE_ANALYSIS);
  const [cover, setCover] = useState<{ key: string; value: CoverChange | null; error?: string } | null>(null);
  useEffect(() => {
    if (mode !== "landcover") return;
    const key = `${lcA}|${lcB}`;
    let active = true;
    Promise.all([pixels(lcA, SIZE_ANALYSIS), pixels(lcB, SIZE_ANALYSIS)])
      .then(([a, b]) => active && setCover({ key, value: compareLandCover(a, b, areaKm2) }))
      .catch(() => active && setCover({ key, value: null, error: "NASA land-cover tiles could not be loaded." }));
    return () => { active = false; };
  }, [mode, lcA, lcB, areaKm2]);
  const coverNow = cover && cover.key === `${lcA}|${lcB}` ? cover : null;

  // ---- Vegetation (NDVI) ------------------------------------------------------
  const compA = useMemo(() => ndviComposites(ya, month), [ya, month]), compB = useMemo(() => ndviComposites(yb, month), [yb, month]);
  const ndviUrls = (dates: string[]) => dates.map(d => img(place, "ndvi16", d, span, SIZE_ANALYSIS));
  const nKey = `${place.lat},${place.lon},${span},${compA.join()},${compB.join()}`;
  const [ndvi, setNdvi] = useState<{ key: string; value: NdviChange | null; error?: string } | null>(null);
  useEffect(() => {
    if (mode !== "vegetation") return;
    let active = true;
    if (!compA.length || !compB.length) { queueMicrotask(() => active && setNdvi({ key: nKey, value: null, error: "No NDVI composites for that month yet — pick an earlier month or year." })); return () => { active = false; }; }
    Promise.all([Promise.all(ndviUrls(compA).map(u => pixels(u, SIZE_ANALYSIS))), Promise.all(ndviUrls(compB).map(u => pixels(u, SIZE_ANALYSIS)))])
      .then(([a, b]) => active && setNdvi({ key: nKey, value: compareNdvi(a, b) }))
      .catch(() => active && setNdvi({ key: nKey, value: null, error: "NASA NDVI tiles could not be loaded." }));
    return () => { active = false; };
    // ndviUrls is derived from the same inputs as nKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, nKey]);
  const ndviNow = ndvi && ndvi.key === nKey ? ndvi : null;

  // ---- Satellite view ---------------------------------------------------------
  const targetA = `${ya}-${String(month).padStart(2, "0")}-15`, targetB = `${yb}-${String(month).padStart(2, "0")}-15`;
  const prefer = kind === "hls" && ya >= 2018 && yb >= 2018 ? "S30" : kind === "hls" ? "L30" : null;
  const sKey = `${place.lat},${place.lon},${kind},${span},${targetA},${targetB},${prefer}`;
  const [scenes, setScenes] = useState<{ key: string; a: Scene | null | undefined; b: Scene | null | undefined } | null>(null);
  useEffect(() => {
    if (mode !== "imagery") return;
    let active = true;
    queueMicrotask(() => active && setScenes({ key: sKey, a: undefined, b: undefined }));
    findClearestScene(place, kind, targetA, span, prefer).then(a => active && setScenes(s => (s && s.key === sKey ? { ...s, a } : s)));
    findClearestScene(place, kind, targetB, span, prefer).then(b => active && setScenes(s => (s && s.key === sKey ? { ...s, b } : s)));
    return () => { active = false; };
    // the key captures every input
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, sKey]);
  const sc = scenes && scenes.key === sKey ? scenes : null;
  const sceneUrl = (s: Scene | null | undefined) => !s ? null : kind === "hls" ? img(place, "hls", s.date, span, large ? 1600 : 720, `&sensor=${s.sensor}`) : img(place, "false721", s.date, span, large ? 1600 : 720);

  // ---- What to show -----------------------------------------------------------
  let srcA: string | null, srcB: string | null, labelA: string, labelB: string, credit: string;
  if (mode === "landcover") { srcA = lcA; srcB = lcB; labelA = `${ya} land cover`; labelB = `${yb} land cover`; credit = "NASA MODIS MCD12Q1 land cover (IGBP), 500 m"; }
  else if (mode === "vegetation") { srcA = compA[0] ? ndviUrls([compA[0]])[0] : null; srcB = compB[0] ? ndviUrls([compB[0]])[0] : null; labelA = `${MONTHS[month - 1]} ${ya} NDVI`; labelB = `${MONTHS[month - 1]} ${yb} NDVI`; credit = "NASA MODIS MOD13Q1 NDVI, 250 m, 16-day"; }
  else {
    srcA = sceneUrl(sc?.a); srcB = sceneUrl(sc?.b);
    labelA = sc?.a ? `${sc.a.date} · ${SENSOR_NAME[sc.a.sensor]}` : `${MONTHS[month - 1]} ${ya}`;
    labelB = sc?.b ? `${sc.b.date} · ${SENSOR_NAME[sc.b.sensor]}` : `${MONTHS[month - 1]} ${yb}`;
    credit = kind === "hls" ? "NASA HLS (Landsat + Sentinel-2), 30 m" : "NASA Terra MODIS bands 7-2-1, 250 m";
  }
  const pixelated = mode === "landcover";
  const overlay = mode === "landcover" ? coverNow?.value?.overlay ?? null : mode === "vegetation" ? ndviNow?.value?.overlay ?? null : null;
  const canChanges = mode !== "imagery";
  const effectiveView: View = view === "changes" && !canChanges ? "swipe" : view;
  const useEnhance = enhance && mode === "imagery";
  const short = (s: string) => (large ? s : s.slice(0, 4));

  const viewer = (
    <>
      {effectiveView === "side" ? (
        <div className="sat-side">
          {[{ src: srcA, label: labelA }, { src: srcB, label: labelB }].map((x, i) => (
            <div key={i} className="comparison-image"><Picture src={x.src} enhance={useEnhance} pixelated={pixelated} alt={`${place.name}, ${x.label}`} /><span className="image-date before-date">{x.label}</span></div>
          ))}
        </div>
      ) : effectiveView === "changes" ? (
        <div className="comparison-image">
          <Picture src={srcB} pixelated={pixelated} alt={`${place.name}, ${labelB}`} />
          <div className="change-dim" /><Overlay data={overlay} />
          <span className="image-date before-date">Change {ya} → {yb}</span>
          {!overlay && <div className="image-status overlay-wait"><LoaderCircle className="spin" size={20} /><span>Measuring change…</span></div>}
        </div>
      ) : (
        <div className="comparison-image">
          <Picture src={srcB} enhance={useEnhance} pixelated={pixelated} alt={`${place.name}, ${labelB}`} />
          <div className="before-image" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}><Picture src={srcA} enhance={useEnhance} pixelated={pixelated} alt={`${place.name}, ${labelA}`} /></div>
          <span className="image-date before-date">{short(labelA)}</span><span className="image-date after-date">{short(labelB)}</span>
          <div className="comparison-line" style={{ left: `${split}%` }}><span>‹<i />›</span></div>
          <Slider aria-label="Before and after comparison" className="comparison-slider" min={0} max={100} value={[split]} onValueChange={v => setSplit(v[0])} />
          <div className="image-credit">{credit}{useEnhance ? " · enhanced" : ""}</div>
        </div>
      )}
    </>
  );

  if (!large) return <div className="satellite-comparison">{viewer}</div>;

  const order: CoverGroup[] = ["built", "cropland", "forest", "shrubGrass", "wetland", "water", "barren"];
  return (
    <div className="satellite-comparison large">
      <div className="sat-toolbar">
        <div className="sat-seg" role="tablist" aria-label="What to compare">
          {([["landcover", "Land cover change", "Measured · NASA MODIS 2001–2024"], ["vegetation", "Vegetation (NDVI)", "Measured · same season · 2001–now"], ["imagery", "Satellite view", "Visual · 30 m Landsat/Sentinel-2"]] as const).map(([id, l, s]) => (
            <button key={id} role="tab" aria-selected={mode === id} className={mode === id ? "on" : ""} onClick={() => setMode(id)}><strong>{l}</strong><small>{s}</small></button>
          ))}
        </div>

        <div className="sat-controls">
          {mode === "imagery" && <label>Imagery<select value={kind} onChange={e => setKind(e.target.value as ImageryKind)}><option value="hls">Natural colour · 30 m (2013+)</option><option value="false721">False colour 7-2-1 · 250 m (2000+)</option></select></label>}
          <label>Before<select value={ya} onChange={e => setYear(0, +e.target.value)}>{yearOptions.filter(y => y < yb).map(y => <option key={y}>{y}</option>)}</select></label>
          <label>After<select value={yb} onChange={e => setYear(1, +e.target.value)}>{yearOptions.filter(y => y > ya).map(y => <option key={y}>{y}</option>)}</select></label>
          {mode !== "landcover" && <label>Season<select value={month} onChange={e => setMonth(+e.target.value)}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>}
          <label>Area<select value={zoom} onChange={e => setZoom(+e.target.value)}>{ZOOMS.map((z, i) => <option key={z.label} value={i}>{z.label} · {z.km} km</option>)}</select></label>
          <div className="view-seg" role="tablist" aria-label="View">
            <button className={effectiveView === "swipe" ? "on" : ""} onClick={() => setView("swipe")}><SplitSquareHorizontal size={13} /> Swipe</button>
            <button className={effectiveView === "side" ? "on" : ""} onClick={() => setView("side")}><Columns2 size={13} /> Side by side</button>
            {canChanges && <button className={effectiveView === "changes" ? "on" : ""} onClick={() => setView("changes")}><Waypoints size={13} /> Change map</button>}
          </div>
          {mode === "imagery" && <label className="hz-check"><input type="checkbox" checked={enhance} onChange={e => setEnhance(e.target.checked)} /> <Sparkles size={13} /> Remove haze</label>}
        </div>
      </div>

      <div className="sat-body">
        <div className="sat-view">{viewer}</div>

        <aside className="sat-stats">
          {mode === "landcover" && (coverNow?.value ? (() => {
            const c = coverNow.value, builtKm2 = ((c.b.share.built - c.a.share.built) / 100) * areaKm2;
            return <>
              <h4>What changed, {ya} → {yb}</h4>
              <p className="stat-lead"><strong>{signedPts(c.b.share.built - c.a.share.built)} pts</strong> built-up land ({c.a.share.built.toFixed(1)}% → {c.b.share.built.toFixed(1)}%), about <strong>{Math.abs(builtKm2) < 1 ? builtKm2.toFixed(1) : Math.round(builtKm2).toLocaleString("en-US")} km²</strong> {builtKm2 >= 0 ? "more" : "less"} within this {ZOOMS[zoom].km} km square.</p>
              <table className="stat-table"><thead><tr><th>Cover</th><th>{ya}</th><th>{yb}</th><th>Change</th></tr></thead><tbody>
                {order.filter(g => c.a.share[g] >= 0.05 || c.b.share[g] >= 0.05).map(g => {
                  const d = c.b.share[g] - c.a.share[g];
                  return <tr key={g}><td><i style={{ background: COVER_META[g].color }} />{COVER_META[g].label}</td><td>{c.a.share[g].toFixed(1)}%</td><td>{c.b.share[g].toFixed(1)}%</td><td className={Math.abs(d) < 1 ? "small" : d > 0 ? "up" : "down"}>{signedPts(d)}</td></tr>;
                })}
              </tbody></table>
              <p className="stat-note">{c.changedPct.toFixed(1)}% of the area changed class; {c.toBuiltPct.toFixed(1)}% became built-up. Open <b>Change map</b> to see where.</p>
              <div className="change-legend"><span><i style={{ background: "#ff3b30" }} />Became built-up</span><span><i style={{ background: "#ff9500" }} />Lost vegetation</span><span><i style={{ background: "#34c759" }} />Gained vegetation</span><span><i style={{ background: "#409cff" }} />Water change</span></div>
              <p className="stat-method">NASA MODIS MCD12Q1 v6.1 (IGBP classes, 500 m, yearly). An official satellite classification with roughly 74% overall accuracy, so changes under 1–2 points may be classification noise. Each data cell is 500 m × 500 m (25 ha). Swaps between cropland and grass are the least reliable classes.</p>
            </>;
          })() : <p className="stat-wait">{coverNow?.error ?? <><LoaderCircle className="spin" size={14} /> Measuring land cover…</>}</p>)}

          {mode === "vegetation" && (ndviNow?.value ? (() => {
            const v = ndviNow.value;
            return <>
              <h4>Vegetation, {MONTHS[month - 1]} {ya} vs {yb}</h4>
              <p className="stat-lead">Mean NDVI <strong>{v.meanA.toFixed(2)} → {v.meanB.toFixed(2)}</strong> ({signedPts(((v.meanB - v.meanA) / Math.max(0.01, v.meanA)) * 100, 0)}%).</p>
              <table className="stat-table"><tbody>
                <tr><td>Dense vegetation (NDVI ≥ 0.5)</td><td>{v.denseA.toFixed(0)}%</td><td>{v.denseB.toFixed(0)}%</td><td className={v.denseB - v.denseA > 0 ? "up" : "down"}>{signedPts(v.denseB - v.denseA, 0)}</td></tr>
                <tr><td><i style={{ background: "#34c759" }} />Clearly greener (ΔNDVI ≥ +0.1)</td><td colSpan={3}>{v.greenerPct.toFixed(0)}% of area</td></tr>
                <tr><td><i style={{ background: "#d66020" }} />Clearly browner (ΔNDVI ≤ −0.1)</td><td colSpan={3}>{v.brownerPct.toFixed(0)}% of area</td></tr>
              </tbody></table>
              <p className="stat-method">NASA MODIS MOD13Q1 NDVI (250 m). Each year averages three 16-day composites from the same season (from {compA[0] ? fmtDate(compA[0]).replace(/ \d{4}$/, "") : MONTHS[month - 1]}), so crop calendars and monsoon timing match. Browning can mean new buildings, bare fields or drought; greening can mean irrigation or extra crop cycles.</p>
            </>;
          })() : <p className="stat-wait">{ndviNow?.error ?? <><LoaderCircle className="spin" size={14} /> Measuring vegetation…</>}</p>)}

          {mode === "imagery" && <>
            <h4>Like-for-like scenes</h4>
            {[{ y: ya, s: sc?.a }, { y: yb, s: sc?.b }].map(({ y, s }) => (
              <p key={y} className="stat-scene">
                <b>{y}</b>{" "}
                {s === undefined ? <><ScanSearch size={12} /> finding the clearest {MONTHS[month - 1]} pass…</> : s === null ? "no clear pass within the search window — try another month" : <>{fmtDate(s.date)} · {SENSOR_NAME[s.sensor]} · {Math.round(s.score * 100)}% clear</>}
              </p>
            ))}
            {sc?.a && sc?.b && sc.a.sensor !== sc.b.sensor && <p className="stat-note">Different sensors in the two years (the matching sensor had no clear pass in one of them), so colours can differ slightly.</p>}
            <p className="stat-method">{kind === "hls" ? "NASA HLS harmonises Landsat 8/9 and Sentinel-2 to the same 30 m grid and BRDF-normalised reflectance. Both scenes come from the same month and, where possible, the same sensor (Landsat by default; Sentinel-2 when both years are 2018 or later)." : "Bands 7-2-1 show water dark blue/black, vegetation green and built-up or bare land pink-magenta — good for spotting river shifts and urban growth."} Use the measured tabs for numbers.</p>
          </>}
          <p className="data-note"><CircleHelp size={14} /> Real NASA observations. Comparisons use the same product and season in both years so differences reflect the land, not the sensor.</p>
        </aside>
      </div>
    </div>
  );
}
