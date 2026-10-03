"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { CircleHelp, Columns2, ImageIcon, Layers3, LoaderCircle, ScanSearch, Sparkles, SplitSquareHorizontal, Waypoints } from "lucide-react";
import { RangeControl as Slider } from "./range-control";
import type { Place } from "@/lib/climate";
import { useI18n } from "@/lib/i18n";
import { compareLandCover, compareLst, compareNdvi, COVER_META, HEAT_RAMP, LANDCOVER_LEGEND, LANDCOVER_YEARS, LST_REL_THRESHOLD, lstComposites, ndviComposites, renderLst, type CoverChange, type CoverGroup, type LstChange, type NdviChange } from "@/lib/earth-change";

// Satellite comparison, rebuilt for like-for-like accuracy:
//   • Land cover — NASA MODIS MCD12Q1 (official yearly classification), measured shares + change map.
//   • Vegetation — MODIS MOD13Q1 NDVI, the same season in both years (three 16-day composites averaged).
//   • Satellite view — 30 m Landsat/Sentinel-2 (HLS) or MODIS false colour, the same month in both years,
//     the clearest pass in each, preferring the same sensor. Visual context only.

type Mode = "landcover" | "vegetation" | "heat" | "imagery";
export type ImageryKind = "hls" | "false721";
type View = "swipe" | "side" | "changes";
export type Scene = { date: string; sensor: "S30" | "L30" | "MODIS"; score: number };

/* i18n */const ZOOMS = [
  { label: "City", km: 45, span: 0.4 },
  { label: "Metro", km: 90, span: 0.8 },
  { label: "Region", km: 240, span: 2.2 },
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];/* /i18n */
const SENSOR_NAME = { S30: "Sentinel-2", L30: "Landsat 8/9", MODIS: "Terra MODIS" } as const;
const SIZE_ANALYSIS = 512;

const nowYear = () => new Date().getUTCFullYear();
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
const fmtDate = (d: string, lang = "en") => new Date(d + "T00:00:00Z").toLocaleDateString(lang === "bn" ? "bn-BD" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
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

/** Present-day high-resolution photo of the same square, for laying measured maps over real streets and fields. */
const photoUrl = (p: Place, span: number) => {
  const halfLat = span / 2, halfLon = halfLat / Math.max(0.2, Math.cos((p.lat * Math.PI) / 180)); // same square as /api/imagery
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${p.lon - halfLon},${p.lat - halfLat},${p.lon + halfLon},${p.lat + halfLat}&bboxSR=4326&imageSR=4326&size=1024,1024&format=jpg&f=image`;
};
const inBangladesh = (p: Place) => p.lat >= 20.5 && p.lat <= 26.7 && p.lon >= 88 && p.lon <= 92.7;

function Picture({ src, alt, enhance = false, pixelated = false, waiting, under }: { src: string | null; alt: string; enhance?: boolean; pixelated?: boolean; waiting?: string; under?: string | null }) {
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
  const { t } = useI18n();
  return <div className="sat-image">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {under && <img className="sat-under" src={under} alt="" />}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {url && <img key={url} src={url} alt={alt} onLoad={() => setState({ url, ok: true })} onError={() => setState({ url, ok: false })} style={{ opacity: ok ? (under ? 0.55 : 1) : 0, imageRendering: pixelated ? "pixelated" : undefined }} />}
    {!ok && <div className="image-status">{failed ? <><Layers3 size={25} /><span>{t("No image available for this date.")}</span><small>{t("Try another year or month; satellite coverage varies.")}</small></> : <><LoaderCircle className="spin" size={22} /><span>{src ? t("Loading NASA imagery…") : waiting ?? t("Finding the clearest satellite pass…")}</span></>}</div>}
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

// Error messages set in effects and translated at render time.
/* i18n */// "NASA land-cover tiles could not be loaded." "NASA NDVI tiles could not be loaded." "No NDVI composites for that month yet — pick an earlier month or year." "No surface-temperature composites for that month yet — pick an earlier month or year." "Clouds hid this area in that month — try a drier month such as January–April." "NASA surface-temperature tiles could not be loaded."
/* /i18n */

export default function SatelliteComparison({ place, large = false }: { place: Place; large?: boolean }) {
  const { t, n, y, lang } = useI18n();
  const sp = (v: number, d = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${n(Math.abs(v), d)}`; // signed, in the interface language
  const [mode, setMode] = useState<Mode>(large ? "landcover" : "imagery");
  const [kind, setKind] = useState<ImageryKind>("hls");
  const [view, setView] = useState<View>("swipe");
  const [split, setSplit] = useState(50);
  const [zoom, setZoom] = useState(0);
  const [month, setMonth] = useState(1);
  const [enhance, setEnhance] = useState(true);
  const [photo, setPhoto] = useState(false);
  const [years, setYears] = useState<Record<Mode | "false721", [number, number]>>(() => ({
    landcover: [LANDCOVER_YEARS[0], LANDCOVER_YEARS[1]],
    vegetation: [2001, latestYearFor(3)],
    heat: [2003, latestYearFor(4)], // April: pre-monsoon peak heat with mostly clear skies over South Asia
    imagery: [2014, nowYear() - 1], // Landsat in both years; current-year L30 often lags in GIBS
    false721: [2001, latestYearFor(1)],
  }));
  const yearKey: Mode | "false721" = mode === "imagery" && kind === "false721" ? "false721" : mode;
  const [ya, yb] = years[yearKey];
  const setYear = (i: 0 | 1, v: number) => setYears(y => ({ ...y, [yearKey]: (i === 0 ? [v, y[yearKey][1]] : [y[yearKey][0], v]) as [number, number] }));
  const span = ZOOMS[zoom].span, areaKm2 = (span * 110.57) ** 2;
  const yearOptions = mode === "landcover" ? range(LANDCOVER_YEARS[0], LANDCOVER_YEARS[1])
    : mode === "vegetation" || mode === "heat" ? range(2001, latestYearFor(month))
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

  // ---- Surface heat (land-surface temperature) -------------------------------
  const lstA = useMemo(() => lstComposites(ya, month), [ya, month]), lstB = useMemo(() => lstComposites(yb, month), [yb, month]);
  const hKey = `${place.lat},${place.lon},${span},${lstA.join()},${lstB.join()}`;
  const [heat, setHeat] = useState<{ key: string; value: (LstChange & { urlA: string; urlB: string }) | null; error?: string } | null>(null);
  useEffect(() => {
    if (mode !== "heat") return;
    let active = true;
    if (!lstA.length || !lstB.length) { queueMicrotask(() => active && setHeat({ key: hKey, value: null, error: "No surface-temperature composites for that month yet — pick an earlier month or year." })); return () => { active = false; }; }
    const urls = (dates: string[]) => dates.map(d => pixels(img(place, "lst8", d, span, SIZE_ANALYSIS), SIZE_ANALYSIS));
    Promise.all([Promise.all(urls(lstA)), Promise.all(urls(lstB))])
      .then(([a, b]) => {
        if (!active) return;
        const c = compareLst(a, b);
        if (c.coverage < 0.05) { setHeat({ key: hKey, value: null, error: "Clouds hid this area in that month — try a drier month such as January–April." }); return; }
        const toUrl = (f: Float32Array) => { const cv = document.createElement("canvas"); cv.width = c.width; cv.height = c.height; cv.getContext("2d")!.putImageData(renderLst(f, c.width, c.height, c.lo, c.hi), 0, 0); return cv.toDataURL(); };
        setHeat({ key: hKey, value: { ...c, urlA: toUrl(c.fieldA), urlB: toUrl(c.fieldB) } });
      })
      .catch(() => active && setHeat({ key: hKey, value: null, error: "NASA surface-temperature tiles could not be loaded." }));
    return () => { active = false; };
    // the key captures every input
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, hKey]);
  const heatNow = heat && heat.key === hKey ? heat : null;

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
  if (mode === "landcover") { srcA = lcA; srcB = lcB; labelA = t("{year} land cover", { year: y(ya) }); labelB = t("{year} land cover", { year: y(yb) }); credit = t("NASA MODIS MCD12Q1 land cover (IGBP), 500 m"); }
  else if (mode === "vegetation") { srcA = compA[0] ? ndviUrls([compA[0]])[0] : null; srcB = compB[0] ? ndviUrls([compB[0]])[0] : null; labelA = `${y(ya)} ${t(MONTHS[month - 1])} NDVI`; labelB = `${y(yb)} ${t(MONTHS[month - 1])} NDVI`; credit = t("NASA MODIS MOD13Q1 NDVI, 250 m, 16-day"); }
  else if (mode === "heat") { srcA = heatNow?.value?.urlA ?? null; srcB = heatNow?.value?.urlB ?? null; labelA = `${y(ya)} ${t(MONTHS[month - 1])} · ${t("surface °C")}`; labelB = `${y(yb)} ${t(MONTHS[month - 1])} · ${t("surface °C")}`; credit = t("NASA MODIS MOD11A2 land-surface temperature (day), 1 km"); }
  else {
    srcA = sceneUrl(sc?.a); srcB = sceneUrl(sc?.b);
    labelA = sc?.a ? `${sc.a.date} · ${SENSOR_NAME[sc.a.sensor]}` : `${y(ya)} ${t(MONTHS[month - 1])}`;
    labelB = sc?.b ? `${sc.b.date} · ${SENSOR_NAME[sc.b.sensor]}` : `${y(yb)} ${t(MONTHS[month - 1])}`;
    credit = kind === "hls" ? t("NASA HLS (Landsat + Sentinel-2), 30 m") : t("NASA Terra MODIS bands 7-2-1, 250 m");
  }
  const pixelated = mode === "landcover" || mode === "heat";
  const overlay = mode === "landcover" ? coverNow?.value?.overlay ?? null : mode === "vegetation" ? ndviNow?.value?.overlay ?? null : mode === "heat" ? heatNow?.value?.overlay ?? null : null;
  const canChanges = mode !== "imagery";
  const effectiveView: View = view === "changes" && !canChanges ? "swipe" : view;
  const useEnhance = enhance && mode === "imagery";
  const short = (s: string) => (large ? s : s.slice(0, 4));
  const canPhoto = mode === "landcover" || mode === "heat";
  const under = photo && canPhoto ? photoUrl(place, span) : null;
  const legend = mode === "landcover" && coverNow?.value ? coverNow.value.present.map(k => LANDCOVER_LEGEND.find(e => e.rgb === k)).filter(e => !!e).slice(0, 9) : [];
  const bd = inBangladesh(place);
  const legendLabel = (e: (typeof LANDCOVER_LEGEND)[number]) => (e.rgb === "255,213,0" && bd ? t("Savanna (mixed rural land)") : t(e.label));

  const viewer = (
    <>
      {effectiveView === "side" ? (
        <div className="sat-side">
          {[{ src: srcA, label: labelA }, { src: srcB, label: labelB }].map((x, i) => (
            <div key={i} className="comparison-image"><Picture src={x.src} enhance={useEnhance} pixelated={pixelated} under={under} alt={`${place.name}, ${x.label}`} /><span className="image-date before-date">{x.label}</span></div>
          ))}
        </div>
      ) : effectiveView === "changes" ? (
        <div className="comparison-image">
          <Picture src={srcB} pixelated={pixelated} under={under} alt={`${place.name}, ${labelB}`} />
          <div className="change-dim" /><Overlay data={overlay} />
          <span className="image-date before-date">{t("Change {a} → {b}", { a: y(ya), b: y(yb) })}</span>
          {!overlay && <div className="image-status overlay-wait"><LoaderCircle className="spin" size={20} /><span>{t("Measuring change…")}</span></div>}
        </div>
      ) : (
        <div className="comparison-image">
          <Picture src={srcB} enhance={useEnhance} pixelated={pixelated} under={under} alt={`${place.name}, ${labelB}`} />
          <div className="before-image" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}><Picture src={srcA} enhance={useEnhance} pixelated={pixelated} under={under} alt={`${place.name}, ${labelA}`} /></div>
          <span className="image-date before-date">{short(labelA)}</span><span className="image-date after-date">{short(labelB)}</span>
          <div className="comparison-line" style={{ left: `${split}%` }}><span>‹<i />›</span></div>
          <Slider aria-label={t("Before and after comparison")} className="comparison-slider" min={0} max={100} value={[split]} onValueChange={v => setSplit(v[0])} />
          <div className="image-credit">{credit}{useEnhance ? ` · ${t("enhanced")}` : ""}{under ? ` · ${t("photo © Esri, Maxar")}` : ""}</div>
        </div>
      )}
      {!!legend.length && <div className="lc-legend" aria-label={t("Map key")}>
        {legend.map(e => <span key={e.rgb} title={e.hint ? t(e.hint) : undefined}><i style={{ background: `rgb(${e.rgb})` }} />{legendLabel(e)}</span>)}
      </div>}
    </>
  );

  if (!large) return <div className="satellite-comparison">{viewer}</div>;

  const order: CoverGroup[] = ["built", "cropland", "forest", "shrubGrass", "wetland", "water", "barren"];
  return (
    <div className="satellite-comparison large">
      <div className="sat-toolbar">
        <div className="sat-seg" role="tablist" aria-label={t("What to compare")}>
          {(/* i18n */[["landcover", "Land cover change", "Measured · NASA MODIS 2001–2024"], ["vegetation", "Vegetation (NDVI)", "Measured · same season · 2001–now"], ["heat", "Surface heat", "Measured · NASA MODIS 1 km · 2001–now"], ["imagery", "Satellite view", "Visual · 30 m Landsat/Sentinel-2"]]/* /i18n */ as const).map(([id, l, s]) => (
            <button key={id} role="tab" aria-selected={mode === id} className={mode === id ? "on" : ""} onClick={() => { setMode(id); if (id === "heat" && month < 2) setMonth(4); }}><strong>{t(l)}</strong><small>{t(s)}</small></button>
          ))}
        </div>

        <div className="sat-controls">
          {mode === "imagery" && <label>{t("Imagery")}<select value={kind} onChange={e => setKind(e.target.value as ImageryKind)}><option value="hls">{t("Natural colour · 30 m (2013+)")}</option><option value="false721">{t("False colour 7-2-1 · 250 m (2000+)")}</option></select></label>}
          <label>{t("Before")}<select value={ya} onChange={e => setYear(0, +e.target.value)}>{yearOptions.filter(v => v < yb).map(v => <option key={v} value={v}>{y(v)}</option>)}</select></label>
          <label>{t("After")}<select value={yb} onChange={e => setYear(1, +e.target.value)}>{yearOptions.filter(v => v > ya).map(v => <option key={v} value={v}>{y(v)}</option>)}</select></label>
          {mode !== "landcover" && <label>{t("Season")}<select value={month} onChange={e => setMonth(+e.target.value)}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{t(m)}</option>)}</select></label>}
          <label>{t("Area")}<select value={zoom} onChange={e => setZoom(+e.target.value)}>{ZOOMS.map((z, i) => <option key={z.label} value={i}>{t(z.label)} · {n(z.km)} km</option>)}</select></label>
          <div className="view-seg" role="tablist" aria-label={t("View")}>
            <button className={effectiveView === "swipe" ? "on" : ""} onClick={() => setView("swipe")}><SplitSquareHorizontal size={13} /> {t("Swipe")}</button>
            <button className={effectiveView === "side" ? "on" : ""} onClick={() => setView("side")}><Columns2 size={13} /> {t("Side by side")}</button>
            {canChanges && <button className={effectiveView === "changes" ? "on" : ""} onClick={() => setView("changes")}><Waypoints size={13} /> {t("Change map")}</button>}
          </div>
          {canPhoto && <label className="hz-check" title={t("Lay the measured map over a present-day high-resolution photo")}><input type="checkbox" checked={photo} onChange={e => setPhoto(e.target.checked)} /> <ImageIcon size={13} /> {t("On satellite photo")}</label>}
          {mode === "imagery" && <label className="hz-check"><input type="checkbox" checked={enhance} onChange={e => setEnhance(e.target.checked)} /> <Sparkles size={13} /> {t("Remove haze")}</label>}
        </div>
      </div>

      <div className="sat-body">
        <div className="sat-view">{viewer}</div>

        <aside className="sat-stats">
          {mode === "landcover" && (coverNow?.value ? (() => {
            const c = coverNow.value, builtKm2 = ((c.b.share.built - c.a.share.built) / 100) * areaKm2;
            return <>
              <h4>{t("What changed, {a} → {b}", { a: y(ya), b: y(yb) })}</h4>
              <p className="stat-lead"><strong>{sp(c.b.share.built - c.a.share.built)} {t("pts")}</strong> {t("built-up land")} ({n(c.a.share.built, 1)}% → {n(c.b.share.built, 1)}%), {t("about")} <strong>{Math.abs(builtKm2) < 1 ? n(Math.abs(builtKm2), 1) : n(Math.round(Math.abs(builtKm2)))} km²</strong> {builtKm2 >= 0 ? t("more") : t("less")} {t("within this {km} km square.", { km: n(ZOOMS[zoom].km) })}</p>
              <table className="stat-table"><thead><tr><th>{t("Cover")}</th><th>{y(ya)}</th><th>{y(yb)}</th><th>{t("Change")}</th></tr></thead><tbody>
                {order.filter(g => c.a.share[g] >= 0.05 || c.b.share[g] >= 0.05).map(g => {
                  const d = c.b.share[g] - c.a.share[g];
                  return <tr key={g}><td><i style={{ background: COVER_META[g].color }} />{t(COVER_META[g].label)}</td><td>{n(c.a.share[g], 1)}%</td><td>{n(c.b.share[g], 1)}%</td><td className={Math.abs(d) < 1 ? "small" : d > 0 ? "up" : "down"}>{sp(d)}</td></tr>;
                })}
              </tbody></table>
              {bd && c.b.share.shrubGrass >= 5 && <p className="stat-note">{t("Golden yellow “savanna” here is mostly mixed rural land: in Bangladesh MODIS often gives this label to rice fields with homestead trees and seasonally flooded land.")}</p>}
              <p className="stat-note">{t("{a}% of the area changed class; {b}% became built-up.", { a: n(c.changedPct, 1), b: n(c.toBuiltPct, 1) })} {t("Open “Change map” to see where.")}</p>
              <div className="change-legend"><span><i style={{ background: "#ff3b30" }} />{t("Became built-up")}</span><span><i style={{ background: "#ff9500" }} />{t("Lost vegetation")}</span><span><i style={{ background: "#34c759" }} />{t("Gained vegetation")}</span><span><i style={{ background: "#409cff" }} />{t("Water change")}</span></div>
              <p className="stat-method">{t("NASA MODIS MCD12Q1 v6.1 (IGBP classes, 500 m, yearly). An official satellite classification with roughly 74% overall accuracy, so changes under 1–2 points may be classification noise. Each data cell is 500 m × 500 m (25 ha). Swaps between cropland and grass are the least reliable classes.")}</p>
            </>;
          })() : <p className="stat-wait">{coverNow?.error ? t(coverNow.error) : <><LoaderCircle className="spin" size={14} /> {t("Measuring land cover…")}</>}</p>)}

          {mode === "vegetation" && (ndviNow?.value ? (() => {
            const v = ndviNow.value;
            return <>
              <h4>{t("Vegetation, {month} {a} vs {b}", { month: t(MONTHS[month - 1]), a: y(ya), b: y(yb) })}</h4>
              <p className="stat-lead">{t("Mean NDVI")} <strong>{n(v.meanA, 2)} → {n(v.meanB, 2)}</strong> ({sp(((v.meanB - v.meanA) / Math.max(0.01, v.meanA)) * 100, 0)}%).</p>
              <table className="stat-table"><tbody>
                <tr><td>{t("Dense vegetation (NDVI ≥ 0.5)")}</td><td>{n(v.denseA)}%</td><td>{n(v.denseB)}%</td><td className={v.denseB - v.denseA > 0 ? "up" : "down"}>{sp(v.denseB - v.denseA, 0)}</td></tr>
                <tr><td><i style={{ background: "#34c759" }} />{t("Clearly greener (ΔNDVI ≥ +0.1)")}</td><td colSpan={3}>{t("{p}% of area", { p: n(v.greenerPct) })}</td></tr>
                <tr><td><i style={{ background: "#d66020" }} />{t("Clearly browner (ΔNDVI ≤ −0.1)")}</td><td colSpan={3}>{t("{p}% of area", { p: n(v.brownerPct) })}</td></tr>
              </tbody></table>
              <p className="stat-method">{t("NASA MODIS MOD13Q1 NDVI (250 m). Each year averages three 16-day composites from the same season (from {start}), so crop calendars and monsoon timing match. Browning can mean new buildings, bare fields or drought; greening can mean irrigation or extra crop cycles.", { start: compA[0] ? fmtDate(compA[0], lang).replace(/ [\d০-৯]{4}$/, "") : t(MONTHS[month - 1]) })}</p>
            </>;
          })() : <p className="stat-wait">{ndviNow?.error ? t(ndviNow.error) : <><LoaderCircle className="spin" size={14} /> {t("Measuring vegetation…")}</>}</p>)}

          {mode === "heat" && (heatNow?.value ? (() => {
            const v = heatNow.value, shift = v.meanB - v.meanA;
            return <>
              <h4>{t("Surface heat, {month} {a} vs {b}", { month: t(MONTHS[month - 1]), a: y(ya), b: y(yb) })}</h4>
              <p className="stat-lead">{t("Area-mean daytime surface")} <strong>{n(v.meanA, 1)} → {n(v.meanB, 1)} °C</strong> ({sp(shift)} °C).</p>
              <div className="heat-ramp"><i style={{ background: `linear-gradient(90deg, ${HEAT_RAMP.join(",")})` }} /><span>{n(v.lo)} °C</span><span>{n(v.hi)} °C</span></div>
              <table className="stat-table"><thead><tr><th></th><th>{y(ya)}</th><th>{y(yb)}</th><th>{t("Change")}</th></tr></thead><tbody>
                <tr><td title={t("Mean of the hottest 10% of the area minus the area median — a surface urban-heat-island measure.")}>{t("Hot-spot intensity")}</td><td>+{n(v.hotA, 1)}°</td><td>+{n(v.hotB, 1)}°</td><td className={v.hotB - v.hotA >= 0.3 ? "up" : v.hotB - v.hotA <= -0.3 ? "down" : "small"}>{sp(v.hotB - v.hotA)}</td></tr>
                <tr><td>{t("Hottest 1% of the area")}</td><td>{n(v.maxA, 1)}°</td><td>{n(v.maxB, 1)}°</td><td className="small">{sp(v.maxB - v.maxA)}</td></tr>
                <tr><td><i style={{ background: "#ff3b30" }} />{t("Warmed more than surroundings (≥ {d} °C)", { d: n(LST_REL_THRESHOLD, 1) })}</td><td colSpan={3}>{t("{p}% of area", { p: n(v.warmerPct) })}</td></tr>
                <tr><td><i style={{ background: "#409cff" }} />{t("Cooled more than surroundings (≥ {d} °C)", { d: n(LST_REL_THRESHOLD, 1) })}</td><td colSpan={3}>{t("{p}% of area", { p: n(v.coolerPct) })}</td></tr>
              </tbody></table>
              {v.coverage < 0.6 && <p className="stat-note">{t("Clouds hid {p}% of the area in at least one of the years, so these numbers cover only the clear part.", { p: n(Math.round((1 - v.coverage) * 100)) })}</p>}
              <p className="stat-method">{t("NASA MODIS MOD11A2 daytime land-surface temperature (1 km; the 8-day composites of the month are averaged; Terra overpass ≈ 10:30). This is the temperature of roofs, roads and ground, which runs hotter than the air. Whole seasons differ from year to year, so the change map shows places that warmed or cooled more than the area as a whole — usually new buildings, lost trees or new water.")}</p>
            </>;
          })() : <p className="stat-wait">{heatNow?.error ? t(heatNow.error) : <><LoaderCircle className="spin" size={14} /> {t("Measuring surface heat…")}</>}</p>)}

          {mode === "imagery" && <>
            <h4>{t("Like-for-like scenes")}</h4>
            {[{ yr: ya, s: sc?.a }, { yr: yb, s: sc?.b }].map(({ yr, s }) => (
              <p key={yr} className="stat-scene">
                <b>{y(yr)}</b>{" "}
                {s === undefined ? <><ScanSearch size={12} /> {t("finding the clearest {month} pass…", { month: t(MONTHS[month - 1]) })}</> : s === null ? t("no clear pass within the search window — try another month") : <>{fmtDate(s.date, lang)} · {SENSOR_NAME[s.sensor]} · {t("{p}% clear", { p: n(Math.round(s.score * 100)) })}</>}
              </p>
            ))}
            {sc?.a && sc?.b && sc.a.sensor !== sc.b.sensor && <p className="stat-note">{t("Different sensors in the two years (the matching sensor had no clear pass in one of them), so colours can differ slightly.")}</p>}
            <p className="stat-method">{kind === "hls" ? t("NASA HLS harmonises Landsat 8/9 and Sentinel-2 to the same 30 m grid and BRDF-normalised reflectance. Both scenes come from the same month and, where possible, the same sensor (Landsat by default; Sentinel-2 when both years are 2018 or later).") : t("Bands 7-2-1 show water dark blue/black, vegetation green and built-up or bare land pink-magenta — good for spotting river shifts and urban growth.")} {t("Use the measured tabs for numbers.")}</p>
          </>}
          <p className="data-note"><CircleHelp size={14} /> {t("Real NASA observations. Comparisons use the same product and season in both years so differences reflect the land, not the sensor.")}</p>
        </aside>
      </div>
    </div>
  );
}
