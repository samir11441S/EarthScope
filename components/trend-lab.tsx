"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { Activity, CircleHelp, FlaskConical, LoaderCircle, Microscope, Play, ShieldCheck, Sigma, Split, TriangleAlert } from "lucide-react";
import { basemapLayer, createMap, labelsLayer, loadLeaflet, type L } from "./map-kit";
import type { Place } from "@/lib/climate";
import { lstAt, ndviAt } from "@/lib/earth-change";
import { pixels } from "@/lib/pixels";
import { useI18n } from "@/lib/i18n";
import {
  analyseGrid, analysePixels, PIXEL_VARS, SEASONS, TREND_PARAMS, trendColor,
  type CoverClass, type GridResult, type PixelResult, type PixelVar, type Season, type TrendParam,
} from "@/lib/trend-lab";

type Engine = "grid" | "pixel";
type Region = "bd" | "place" | "southAsia";
/* i18n */const REGIONS: Record<Region, { label: string }> = {
  bd: { label: "Bangladesh and neighbours (20–30°N, 80–100°E)" },
  place: { label: "10° square around the selected place" },
  southAsia: { label: "South Asia (10–30°N, 70–100°E)" },
};
const SPANS = [{ label: "City", km: 45, span: 0.4, size: 64 }, { label: "Metro", km: 90, span: 0.8, size: 96 }, { label: "Region", km: 240, span: 2.2, size: 160 }];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CLASS_LABEL: Record<CoverClass, string> = { built: "Built-up since 2001", newBuilt: "Newly built-up (after 2001)", crop: "Cropland", other: "Other land" };/* /i18n */

const DHAKA: Place = { id: "dhaka", name: "Dhaka", country: "Bangladesh", lat: 23.8103, lon: 90.4125 };
const IGBP_BUILT = "255,0,0", IGBP_CROP = new Set(["250,239,115", "153,147,86"]);

const tilesFor = (region: Region, place: Place): [number, number][] =>
  region === "bd" ? [[20, 80], [20, 90]]
  : region === "southAsia" ? [[10, 70], [10, 80], [10, 90], [20, 70], [20, 80], [20, 90]]
  : [[Math.floor(place.lat / 10) * 10, Math.floor(place.lon / 10) * 10]];

const squareBounds = (p: Place, span: number): [[number, number], [number, number]] => {
  const h = span / 2, w = h / Math.max(0.2, Math.cos((p.lat * Math.PI) / 180)); // same square as /api/imagery
  return [[p.lat - h, p.lon - w], [p.lat + h, p.lon + w]];
};
const img = (p: Place, layer: string, date: string, span: number, size: number) => `/api/imagery?lat=${p.lat}&lon=${p.lon}&date=${date}&layer=${layer}&span=${span}&size=${size}`;
/** Newest year whose monthly composite for `month` is published (allow ~6 weeks of processing). */
const lastYearFor = (month: number) => { const now = new Date(); return Date.UTC(now.getUTCFullYear(), month, 15) < Date.now() ? now.getUTCFullYear() : now.getUTCFullYear() - 1; };

const gridCache = new Map<string, Promise<{ years: number[]; cells: (number | null)[][] }>>();
function loadTile(param: TrendParam, lat: number, lon: number) {
  const key = `${param}|${lat}|${lon}`;
  let job = gridCache.get(key);
  if (!job) {
    job = fetch(`/api/trend-grid?param=${param}&lat=${lat}&lon=${lon}`).then(async r => { if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || "failed"); return r.json(); });
    job.catch(() => gridCache.delete(key));
    gridCache.set(key, job);
  }
  return job;
}

export interface PixelRun { result: PixelResult; frames: (ImageData | null)[]; bounds: [[number, number], [number, number]]; decode: (d: ImageData, i: number) => number | null }
/** Downloads one monthly MODIS image per year plus land cover, and runs the per-pixel trend analysis. */
export async function runPixels(place: Place, v: PixelVar, month: number, spanIdx: number, onProgress?: (done: number, total: number) => void): Promise<PixelRun> {
  const { span, size } = SPANS[spanIdx], meta = PIXEL_VARS[v];
  const years = Array.from({ length: lastYearFor(month) - meta.first + 1 }, (_, i) => meta.first + i);
  let done = 0;
  const total = years.length + 2;
  const tick = <T,>(p: Promise<T>) => p.finally(() => onProgress?.(++done, total));
  const decodeFn = v === "ndvi" ? ndviAt : lstAt;
  const [frames, lcNew, lcOld] = await Promise.all([
    Promise.all(years.map(y => tick(pixels(img(place, meta.layer, `${y}-${String(month).padStart(2, "0")}-01`, span, size), size).catch(() => null)))),
    tick(pixels(img(place, "landcover", "2024-01-01", span, size), size).catch(() => null)),
    tick(pixels(img(place, "landcover", "2001-01-01", span, size), size).catch(() => null)),
  ]);
  const key = (d: ImageData | null, i: number) => (d ? `${d.data[i * 4]},${d.data[i * 4 + 1]},${d.data[i * 4 + 2]}` : "");
  const cls = (i: number): CoverClass | null => {
    if (!lcNew) return null;
    const k = key(lcNew, i);
    if (k === IGBP_BUILT) return key(lcOld, i) === IGBP_BUILT ? "built" : "newBuilt";
    return IGBP_CROP.has(k) ? "crop" : "other";
  };
  const decode = (d: ImageData, i: number) => decodeFn(d.data, i * 4);
  const result = analysePixels(years, frames.map(f => (f ? (i: number) => decode(f, i) : null)), size, size, cls);
  return { result, frames, bounds: squareBounds(place, span), decode };
}

const median = (xs: number[]) => { const s = xs.filter(Number.isFinite).map(Math.abs).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 1; };

// ------------------------------------------------------------------------------------------------
export default function TrendLab({ place }: { place: Place }) {
  const { t, n, y } = useI18n();
  const [engine, setEngine] = useState<Engine>("grid");
  // Grid engine
  const [param, setParam] = useState<TrendParam>("T2M");
  const [season, setSeason] = useState<Season>("ANN");
  const [region, setRegion] = useState<Region>("bd");
  const [from, setFrom] = useState(1981);
  const [breakTest, setBreakTest] = useState(true);
  const [raw, setRaw] = useState<{ key: string; years: number[]; cells: (number | null)[][] } | null>(null);
  const [gridErr, setGridErr] = useState<string | null>(null);
  // Pixel engine
  const [pvar, setPvar] = useState<PixelVar>("lstDay");
  const [month, setMonth] = useState(3);
  const [spanIdx, setSpanIdx] = useState(2);
  const [pixel, setPixel] = useState<{ key: string; run: PixelRun | null; progress: [number, number]; error?: string } | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  // Case study
  const [cases, setCases] = useState<{ state: "idle" | "running" | "done"; rows: Partial<Record<PixelVar, PixelResult>>; step: string }>({ state: "idle", rows: {}, step: "" });

  // ---- Grid data -------------------------------------------------------------------------------
  const tiles = tilesFor(region, place), gridKey = `${param}|${tiles.map(x => x.join(",")).join(";")}`;
  useEffect(() => {
    if (engine !== "grid") return;
    let active = true;
    queueMicrotask(() => { if (active) { setGridErr(null); setSel(null); } });
    Promise.all(tiles.map(([la, lo]) => loadTile(param, la, lo))).then(parts => {
      if (!active) return;
      const seen = new Set<string>(), cells: (number | null)[][] = [];
      for (const part of parts) for (const c of part.cells) { const k = `${c[0]},${c[1]}`; if (!seen.has(k)) { seen.add(k); cells.push(c); } }
      setRaw({ key: gridKey, years: parts[0].years, cells });
    }).catch(e => active && setGridErr(e instanceof Error ? e.message : "failed"));
    return () => { active = false; };
    // the key captures param and tiles
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, gridKey]);
  const rawNow = raw && raw.key === gridKey ? raw : null;
  const firstYear = rawNow?.years[0] ?? TREND_PARAMS[param].from;
  const grid: GridResult | null = useMemo(() => (rawNow ? analyseGrid(rawNow.years, rawNow.cells, param, season, Math.max(from, firstYear), breakTest) : null), [rawNow, param, season, from, firstYear, breakTest]);

  // ---- Pixel data --------------------------------------------------------------------------------
  const pixelKey = `${place.lat},${place.lon}|${pvar}|${month}|${spanIdx}`;
  useEffect(() => {
    if (engine !== "pixel") return;
    let active = true;
    queueMicrotask(() => { if (active) { setPixel({ key: pixelKey, run: null, progress: [0, 1] }); setSel(null); } });
    runPixels(place, pvar, month, spanIdx, (d, tot) => active && setPixel(s => (s && s.key === pixelKey ? { ...s, progress: [d, tot] } : s)))
      .then(run => active && setPixel({ key: pixelKey, run, progress: [1, 1] }))
      .catch(() => active && setPixel({ key: pixelKey, run: null, progress: [1, 1], error: "NASA satellite images could not be loaded." }));
    return () => { active = false; };
    // the key captures every input
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, pixelKey]);
  const pixelNow = pixel && pixel.key === pixelKey ? pixel : null;

  // ---- Map ---------------------------------------------------------------------------------------
  const el = useRef<HTMLDivElement>(null), mapRef = useRef<Leaflet.Map | null>(null), lRef = useRef<L | null>(null), layerRef = useRef<Leaflet.LayerGroup | null>(null);
  const [ready, setReady] = useState(false);
  const fitted = useRef<string>("");
  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then(Lf => {
      if (cancelled || !el.current) return;
      const map = createMap(Lf, el.current, { center: [24, 90], zoom: 5, preferCanvas: true });
      basemapLayer(Lf, "satellite").addTo(map);
      labelsLayer(Lf).addTo(map);
      mapRef.current = map; lRef.current = Lf; layerRef.current = Lf.layerGroup().addTo(map);
      setReady(true);
    });
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  const pkind = TREND_PARAMS[param].up, gridScale = useMemo(() => (grid ? Math.max(1e-6, 2 * median(grid.cells.filter(c => !c.excluded).map(c => c.slope))) : 1), [grid]);
  const pixScale = useMemo(() => (pixelNow?.run ? Math.max(1e-6, 2 * median(pixelNow.run.result.trends.filter(x => !!x).map(x => x!.slope))) : 1), [pixelNow]);

  useEffect(() => {
    const Lf = lRef.current, map = mapRef.current, group = layerRef.current;
    if (!ready || !Lf || !map || !group) return;
    group.clearLayers();
    if (engine === "grid" && grid) {
      const lons = [...new Set(grid.cells.map(c => c.lon))].sort((a, b) => a - b), lats = [...new Set(grid.cells.map(c => c.lat))].sort((a, b) => a - b);
      const dLon = Math.min(...lons.slice(1).map((v, i) => v - lons[i])) || 0.625, dLat = Math.min(...lats.slice(1).map((v, i) => v - lats[i])) || 0.5;
      const renderer = Lf.canvas({ padding: 0.2 });
      grid.cells.forEach((c, i) => {
        const b: Leaflet.LatLngBoundsExpression = [[c.lat - dLat / 2, c.lon - dLon / 2], [c.lat + dLat / 2, c.lon + dLon / 2]];
        const [r, g, bl] = c.excluded ? [150, 150, 150] : trendColor(c.slope, gridScale, pkind);
        Lf.rectangle(b, { renderer, stroke: sel === i, color: "#fff", weight: 2, fillColor: `rgb(${r},${g},${bl})`, fillOpacity: c.excluded ? 0.35 : c.significant ? 0.82 : 0.45 })
          .on("click", () => setSel(i)).addTo(group);
        if (c.significant) Lf.circleMarker([c.lat, c.lon], { renderer, radius: 2.2, stroke: false, fillColor: "#0b1220", fillOpacity: 0.9, interactive: false }).addTo(group);
        else if (c.breakYear && !c.excluded) Lf.circleMarker([c.lat, c.lon], { renderer, radius: 2, color: "#fff", weight: 1, fill: false, interactive: false }).addTo(group);
      });
      const all = grid.cells.map(c => [c.lat, c.lon] as [number, number]);
      if (all.length && fitted.current !== `g|${gridKey}`) { fitted.current = `g|${gridKey}`; setTimeout(() => { map.invalidateSize(); map.fitBounds(Lf.latLngBounds(all), { padding: [10, 10], animate: false }); }, 60); }
    }
    if (engine === "pixel" && pixelNow?.run) {
      const { result, bounds } = pixelNow.run, cv = document.createElement("canvas");
      cv.width = result.width; cv.height = result.height;
      const ctx = cv.getContext("2d")!, im = ctx.createImageData(result.width, result.height);
      result.trends.forEach((tr, p) => {
        if (!tr) return;
        const [r, g, b] = trendColor(tr.slope, pixScale, pvar === "ndvi" ? "green" : "warm");
        im.data.set([r, g, b, tr.significant ? 235 : 90], p * 4);
      });
      ctx.putImageData(im, 0, 0);
      const ov = Lf.imageOverlay(cv.toDataURL(), bounds, { interactive: true, className: "pixelated-overlay" }).addTo(group);
      ov.on("click", e => {
        const [[s, w], [nn, ee]] = bounds, ll = (e as Leaflet.LeafletMouseEvent).latlng;
        const x = Math.floor(((ll.lng - w) / (ee - w)) * result.width), yy = Math.floor(((nn - ll.lat) / (nn - s)) * result.height);
        if (x >= 0 && yy >= 0 && x < result.width && yy < result.height) setSel(yy * result.width + x);
      });
      Lf.rectangle(bounds, { color: "#5cc2ff", weight: 1.5, fill: false, interactive: false }).addTo(group);
      // Zoom to the square once the map has its final size (it may still be laying out).
      if (fitted.current !== `p|${pixelKey}`) { fitted.current = `p|${pixelKey}`; setTimeout(() => { map.invalidateSize(); map.setView(Lf.latLngBounds(bounds).getCenter(), Math.max(6, map.getBoundsZoom(bounds, false, Lf.point(16, 16))), { animate: false }); }, 60); }
    }
  }, [ready, engine, grid, gridScale, pkind, sel, pixelNow, pixScale, pvar, gridKey, pixelKey]);

  // ---- Case study: one driver, opposite trends -----------------------------------------------------
  const runCase = async () => {
    setCases({ state: "running", rows: {}, step: "" });
    const rows: Partial<Record<PixelVar, PixelResult>> = {};
    for (const v of ["lstDay", "lstNight", "ndvi"] as PixelVar[]) {
      setCases(c => ({ ...c, step: t(PIXEL_VARS[v].label) }));
      try { rows[v] = (await runPixels(DHAKA, v, 3, 2)).result; } catch { /* shown as missing */ }
      setCases({ state: "running", rows: { ...rows }, step: t(PIXEL_VARS[v].label) });
    }
    setCases({ state: "done", rows, step: "" });
  };
  const showCaseOnMap = () => { setEngine("pixel"); setPvar("lstDay"); setMonth(3); setSpanIdx(2); };

  // ---- Panels --------------------------------------------------------------------------------------
  const sn = (v: number, d: number) => { const r = Number(v.toFixed(d)); return `${r > 0 ? "+" : r < 0 ? "−" : ""}${n(Math.abs(r), d)}`; };
  const pct = (a: number, b: number) => n(b ? (a / b) * 100 : 0, 0);
  const meta = TREND_PARAMS[param];
  const unitPer = engine === "grid" ? `${t(meta.unit)}/${t("decade")}` : `${PIXEL_VARS[pvar].unit === "NDVI" ? "NDVI" : "°C"}/${t("decade")}`;
  const scale = engine === "grid" ? gridScale : pixScale;
  const legendKind = engine === "grid" ? pkind : pvar === "ndvi" ? "green" : "warm";
  const ramp = [-1, -0.5, 0, 0.5, 1].map(x => `rgb(${trendColor(x * scale, scale, legendKind).join(",")})`).join(",");
  const topBreak = grid ? [...grid.breaks].sort((a, b) => b[1] - a[1])[0] : undefined;
  const breakCells = grid ? grid.cells.filter(c => c.breakYear).length : 0;
  const selCell = engine === "grid" && grid && sel !== null ? grid.cells[sel] : null;
  const selPixel = engine === "pixel" && pixelNow?.run && sel !== null ? pixelNow.run : null;

  return (
    <div className="trend-lab">
      <div className="tl-engine" role="tablist" aria-label={t("Data")}>
        <button role="tab" aria-selected={engine === "grid"} className={engine === "grid" ? "on" : ""} onClick={() => { setEngine("grid"); setSel(null); }}><Sigma size={16} /><span><strong>{t("Climate grid")}</strong><small>{t("NASA POWER (MERRA-2 model) · 10 variables · 1981–2025")}</small></span></button>
        <button role="tab" aria-selected={engine === "pixel"} className={engine === "pixel" ? "on" : ""} onClick={() => { setEngine("pixel"); setSel(null); }}><Microscope size={16} /><span><strong>{t("Satellite pixels")}</strong><small>{t("NASA MODIS · surface heat & greenness · 2001–now")}</small></span></button>
      </div>

      <div className="tl-controls-row">
        {engine === "grid" ? <>
          <label>{t("Variable")}<select value={param} onChange={e => setParam(e.target.value as TrendParam)}>
            {[...new Set(Object.values(TREND_PARAMS).map(p => p.group))].map(g => <optgroup key={g} label={t(g)}>{(Object.keys(TREND_PARAMS) as TrendParam[]).filter(k => TREND_PARAMS[k].group === g).map(k => <option key={k} value={k}>{t(TREND_PARAMS[k].label)}</option>)}</optgroup>)}
          </select></label>
          <label>{t("Season")}<select value={season} onChange={e => setSeason(e.target.value as Season)}>{(Object.keys(SEASONS) as Season[]).map(s => <option key={s} value={s}>{t(SEASONS[s].label)}</option>)}</select></label>
          <label>{t("Region")}<select value={region} onChange={e => setRegion(e.target.value as Region)}>{(Object.keys(REGIONS) as Region[]).map(r => <option key={r} value={r}>{r === "place" ? `${t(REGIONS[r].label)} (${place.name})` : t(REGIONS[r].label)}</option>)}</select></label>
          <label>{t("From")}<select value={from} onChange={e => setFrom(+e.target.value)}>{[1981, 1991, 2001].map(v => <option key={v} value={v}>{y(Math.max(v, firstYear))}</option>)}</select></label>
          <label className="hz-check tl-break" title={t("Tests every cell for abrupt, non-climatic steps (Lund & Reeves) and trends only the years after a step")}><input type="checkbox" checked={breakTest} onChange={e => setBreakTest(e.target.checked)} /> <ShieldCheck size={13} /> {t("Break test")}</label>
        </> : <>
          <label>{t("Variable")}<select value={pvar} onChange={e => setPvar(e.target.value as PixelVar)}>{(Object.keys(PIXEL_VARS) as PixelVar[]).map(k => <option key={k} value={k}>{t(PIXEL_VARS[k].label)}</option>)}</select></label>
          <label>{t("Month")}<select value={month} onChange={e => setMonth(+e.target.value)}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{t(m)}</option>)}</select></label>
          <label>{t("Area")}<select value={spanIdx} onChange={e => setSpanIdx(+e.target.value)}>{SPANS.map((s, i) => <option key={s.label} value={i}>{t(s.label)} · {n(s.km)} km · {place.name}</option>)}</select></label>
        </>}
      </div>

      <div className="tlab-grid">
        <div className="tl-map-card">
          <div ref={el} className="tl-map" role="application" aria-label={t("Trend map")} />
          <div className="map-legend tl-legend">
            <div className="legend-bar" style={{ background: `linear-gradient(90deg, ${ramp})` }} />
            <div className="legend-labels"><span>{sn(-scale, 2)}</span><span>{unitPer}</span><span>{sn(scale, 2)}</span></div>
            <div className="tl-legend-keys"><span><i className="dot" /> {t("significant (FDR 10%)")}</span><span><i className="faint" /> {t("not significant")}</span>{engine === "grid" && <><span><i className="ring" /> {t("after a data break")}</span><span><i className="grey" /> {t("too few consistent years")}</span></>}</div>
          </div>
          {engine === "grid" && !grid && !gridErr && <div className="atlas-progress"><LoaderCircle className="spin" size={15} /> {t("Loading NASA POWER grid…")}</div>}
          {engine === "pixel" && pixelNow && !pixelNow.run && !pixelNow.error && <div className="atlas-progress"><LoaderCircle className="spin" size={15} /> {t("Loading {a}/{b} years of MODIS images…", { a: n(pixelNow.progress[0]), b: n(pixelNow.progress[1]) })}<i style={{ width: `${(pixelNow.progress[0] / Math.max(1, pixelNow.progress[1])) * 100}%` }} /></div>}
          {(gridErr || pixelNow?.error) && <div className="map-error"><TriangleAlert size={16} /> {gridErr ? t("NASA POWER grid data is temporarily unavailable.") : t(pixelNow!.error!)}</div>}
        </div>

        <aside className="tl-panel">
          {engine === "grid" && grid && <>
            <span className="eyebrow">{t("WHAT · WHERE · HOW MUCH · SIGNIFICANT?")}</span>
            <h3>{t(meta.label)} · {t(SEASONS[season].label)}</h3>
            <div className="tl-verdict">
              <div className="up"><b>{pct(grid.up, grid.tested)}%</b><span>{t("of the area significantly rising")}</span></div>
              <div className="down"><b>{pct(grid.down, grid.tested)}%</b><span>{t("significantly falling")}</span></div>
              <div><b>{pct(grid.tested - grid.up - grid.down, grid.tested)}%</b><span>{t("no significant trend")}</span></div>
            </div>
            {grid.up > 0 && grid.down > 0 && <p className="tl-note opposite"><Split size={14} /> {t("The same variable is rising in one part of this region and falling in another.")}</p>}
            {breakTest ? (breakCells > 0 && <p className="tl-note warn"><TriangleAlert size={14} /> {t("{n} of {m} cells contain an abrupt, non-climatic step (most often in {year}). Their trends use only the years after it; {x} cells have too few consistent years and are grey.", { n: n(breakCells), m: n(grid.cells.length), year: topBreak ? y(topBreak[0]) : "—", x: n(grid.cells.filter(c => c.excluded).length) })}</p>)
              : <p className="tl-note bad"><TriangleAlert size={14} /> {t("Break test off: this is what a naive analysis would report. Turn it back on to see which “trends” are really data artefacts.")}</p>}
            {selCell ? <CellDetail years={grid.years} series={selCell.series} from={selCell.from} breakYear={selCell.breakYear} slope={selCell.slope} p={selCell.p} significant={selCell.significant} unit={t(meta.unit)} title={`${n(Math.abs(selCell.lat), 2)}°${selCell.lat >= 0 ? "N" : "S"}, ${n(Math.abs(selCell.lon), 2)}°${selCell.lon >= 0 ? "E" : "W"}`} />
              : <p className="muted-text small">{t("Click any cell on the map to see its time series and test result.")}</p>}
          </>}

          {engine === "pixel" && pixelNow?.run && (() => {
            const r = pixelNow.run.result, bc = r.byClass, isNdvi = pvar === "ndvi";
            const opposite = bc.built.n + bc.newBuilt.n > 0 && bc.crop.n > 0 && Math.sign((bc.built.n * bc.built.mean + bc.newBuilt.n * bc.newBuilt.mean) / (bc.built.n + bc.newBuilt.n)) !== Math.sign(bc.crop.mean);
            return <>
              <span className="eyebrow">{t("WHAT · WHERE · HOW MUCH · SIGNIFICANT?")}</span>
              <h3>{t(PIXEL_VARS[pvar].label)} · {t(MONTHS[month - 1])} {y(r.years[0])}–{y(r.years[r.years.length - 1])}</h3>
              <div className="tl-verdict">
                <div className="up"><b>{pct(r.up, r.tested)}%</b><span>{isNdvi ? t("of pixels significantly greener") : t("of pixels significantly warmer")}</span></div>
                <div className="down"><b>{pct(r.down, r.tested)}%</b><span>{isNdvi ? t("significantly browner") : t("significantly cooler")}</span></div>
                <div><b>{n(r.tested)}</b><span>{t("pixels tested")}</span></div>
              </div>
              <table className="stat-table tl-class"><thead><tr><th>{t("Land cover (MODIS 2024)")}</th><th>{t("Mean trend")}</th><th>{t("Sig. up")}</th><th>{t("Sig. down")}</th></tr></thead><tbody>
                {(["built", "newBuilt", "crop", "other"] as CoverClass[]).filter(k => bc[k].n > 0).map(k => <tr key={k}><td>{t(CLASS_LABEL[k])} <small>({n(bc[k].n)})</small></td><td className={bc[k].mean > 0 ? "up" : "down"}>{sn(bc[k].mean, isNdvi ? 3 : 2)}</td><td>{pct(bc[k].up, bc[k].n)}%</td><td>{pct(bc[k].down, bc[k].n)}%</td></tr>)}
              </tbody></table>
              {opposite && <p className="tl-note opposite"><Split size={14} /> {t("Opposite trends: built-up land and cropland are changing in opposite directions here — one driver (land-use change) with opposite effects.")}</p>}
              {selPixel && sel !== null && (() => {
                const tr = r.trends[sel], series = selPixel.frames.map(f => (f ? selPixel.decode(f, sel) : null));
                return tr ? <CellDetail years={r.years} series={series} from={r.years[0]} breakYear={null} slope={tr.slope} p={tr.p} significant={tr.significant} unit={isNdvi ? "NDVI" : "°C"} title={tr.cls ? t(CLASS_LABEL[tr.cls]) : t("Pixel")} /> : null;
              })()}
              {!selPixel && <p className="muted-text small">{t("Click any pixel on the map to see its time series and test result.")}</p>}
            </>;
          })()}
          <details className="tl-method"><summary><CircleHelp size={13} /> {t("How the test works")}</summary>
            <p>{t("Each cell or pixel gets one value per year. The Mann–Kendall test (with trend-free pre-whitening for autocorrelation, Yue et al. 2002) asks whether values rise or fall consistently; Sen's slope gives how much per decade. Because hundreds of places are tested at once, the Benjamini–Hochberg false-discovery rate (10%, Wilks 2016) decides which are significant — otherwise about 5% would look significant by chance.")}</p>
            {engine === "grid" && <p>{t("NASA POWER comes from a reanalysis model whose input observations change over time. Each cell is first tested for abrupt steps (Lund & Reeves two-phase regression, 99%); only the years after a step are trended.")}</p>}
            {engine === "pixel" && <p>{t("NASA MODIS Terra monthly products (MOD11C3-class land-surface temperature, MOD13 NDVI) decoded exactly from the GIBS colour maps. Land-cover classes come from MODIS MCD12Q1 for 2001 and 2024.")}</p>}
          </details>
        </aside>
      </div>

      <section className="tl-case">
        <div className="tl-case-head">
          <span className="eyebrow"><FlaskConical size={13} /> {t("CASE STUDY · ONE DRIVER, OPPOSITE TRENDS")}</span>
          <h3>{t("Irrigation cools Bangladesh’s fields by day and warms them by night — while Dhaka’s heat island grows.")}</h3>
          <p>{t("One driver, opposite trends. Dry-season (boro) rice irrigation has spread across the delta: the fields get greener, and water evaporating from them uses the Sun's energy, so the ground cools by day. At night there is no sunshine to evaporate water, and wet soil and humid air hold heat, so the same fields warm. Dhaka's concrete does not cool by day like the fields around it, so the city–countryside contrast — the surface urban heat island — keeps growing. Three NASA MODIS variables, 240 km around Dhaka, every March since 2001:")}</p>
          <div className="tl-case-actions">
            <button className="lime-button" onClick={runCase} disabled={cases.state === "running"}>{cases.state === "running" ? <><LoaderCircle className="spin" size={15} /> {t("Testing {v}…", { v: cases.step })}</> : <><Play size={15} /> {cases.state === "done" ? t("Run again") : t("Run the case study live")}</>}</button>
            <button className="outline-button" onClick={showCaseOnMap}><Activity size={15} /> {t("Show the daytime map")}</button>
          </div>
        </div>
        {Object.keys(cases.rows).length > 0 && <table className="stat-table tl-case-table"><thead><tr><th>{t("NASA variable (March)")}</th><th>{t("Built-up land")}</th><th>{t("Cropland")}</th><th>{t("Reading")}</th></tr></thead><tbody>
          {(["lstDay", "lstNight", "ndvi"] as PixelVar[]).map(v => {
            const r = cases.rows[v];
            if (!r) return <tr key={v}><td>{t(PIXEL_VARS[v].label)}</td><td colSpan={3} className="small">{cases.state === "running" ? t("waiting…") : t("unavailable")}</td></tr>;
            const b = r.byClass, builtN = b.built.n + b.newBuilt.n, built = builtN ? (b.built.mean * b.built.n + b.newBuilt.mean * b.newBuilt.n) / builtN : NaN, d = v === "ndvi" ? 3 : 2, u = v === "ndvi" ? "" : " °C";
            const day = cases.rows.lstDay, night = cases.rows.lstNight;
            const reading = v === "lstDay"
              ? (b.crop.mean < 0 ? t("Fields cool by day; the city–field contrast grows by {d} °C/decade", { d: sn(built - b.crop.mean, 2) }) : t("Fields do not cool by day here"))
              : v === "lstNight"
                ? (day && night && day.byClass.crop.mean < 0 && b.crop.mean > 0 ? t("Same fields warm at night — the opposite of daytime") : b.crop.mean > 0 ? t("Fields warm at night") : t("Mixed"))
                : (b.crop.mean > 0 && built < b.crop.mean ? t("Fields green up (irrigation); the city browns") : t("Mixed"));
            return <tr key={v}><td>{t(PIXEL_VARS[v].label)}</td><td className={built > 0 ? "up" : "down"}>{sn(built, d)}{u}/{t("dec")}</td><td className={b.crop.mean > 0 ? "up" : "down"}>{sn(b.crop.mean, d)}{u}/{t("dec")} <small>({t("{p}% sig.", { p: pct(b.crop.up + b.crop.down, b.crop.n) })})</small></td><td>{reading}</td></tr>;
          })}
        </tbody></table>}
        <p className="small muted-text">{t("Mean Sen's slope per decade by MODIS land-cover class (2001 and 2024); significance by Mann–Kendall with pre-whitening and FDR control. Satellite skin temperature at the Terra overpass (≈10:30 and ≈22:30), not air temperature. Built-up pixels are fewer and 1–2 km wide, so the city signal averages mixed land. The irrigation day-cooling / night-warming pattern matches published studies of irrigated regions.")}</p>
      </section>
    </div>
  );
}

/** Time series of one cell or pixel with its Sen trend line and any data break. */
function CellDetail({ years, series, from, breakYear, slope, p, significant, unit, title }: { years: number[]; series: (number | null)[]; from: number; breakYear: number | null; slope: number; p: number; significant: boolean; unit: string; title: string }) {
  const { t, n, y } = useI18n();
  const pts = years.map((yr, i) => ({ yr, v: series[i] })).filter((q): q is { yr: number; v: number } => q.v !== null && Number.isFinite(q.v));
  if (pts.length < 3) return null;
  const W = 300, H = 120, L = 34, B = 18, lo = Math.min(...pts.map(q => q.v)), hi = Math.max(...pts.map(q => q.v)), pad = (hi - lo) * 0.1 || 1;
  const X = (yr: number) => L + ((yr - years[0]) / Math.max(1, years[years.length - 1] - years[0])) * (W - L - 6), Y = (v: number) => 6 + (1 - (v - lo + pad) / (hi - lo + 2 * pad)) * (H - B - 6);
  const used = pts.filter(q => q.yr >= from), mx = used.reduce((a, q) => a + q.yr, 0) / Math.max(1, used.length), my = [...used.map(q => q.v)].sort((a, b) => a - b)[used.length >> 1] ?? 0;
  const per = slope / 10, x0 = used[0]?.yr ?? from, x1 = used[used.length - 1]?.yr ?? years[years.length - 1];
  const sn = (v: number, d: number) => { const r = Number(v.toFixed(d)); return `${r > 0 ? "+" : r < 0 ? "−" : ""}${n(Math.abs(r), d)}`; };
  return <div className="tl-cell">
    <h4>{title}</h4>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("Time series")}>
      {[lo, (lo + hi) / 2, hi].map(v => <g key={v}><line x1={L} x2={W - 4} y1={Y(v)} y2={Y(v)} className="tl-grid" /><text x={L - 4} y={Y(v) + 3} textAnchor="end">{n(v, Math.abs(hi - lo) < 1 ? 2 : 1)}</text></g>)}
      {breakYear && <><rect x={L} y={6} width={X(breakYear) - L} height={H - B - 6} className="tl-excluded" /><line x1={X(breakYear)} x2={X(breakYear)} y1={6} y2={H - B} className="tl-break-line" /></>}
      {pts.map(q => <circle key={q.yr} cx={X(q.yr)} cy={Y(q.v)} r={2.2} className={q.yr < from ? "tl-pt old" : "tl-pt"} />)}
      {used.length > 1 && <line x1={X(x0)} y1={Y(my + per * (x0 - mx))} x2={X(x1)} y2={Y(my + per * (x1 - mx))} className={significant ? "tl-sen sig" : "tl-sen"} />}
      <text x={L} y={H - 4}>{y(years[0])}</text><text x={W - 6} y={H - 4} textAnchor="end">{y(years[years.length - 1])}</text>
    </svg>
    <p><strong className={significant ? (slope > 0 ? "up" : "down") : ""}>{sn(slope, Math.abs(slope) < 0.1 ? 3 : 2)} {unit}/{t("decade")}</strong> · p = {n(p, p < 0.01 ? 3 : 2)} · {significant ? t("significant") : t("not significant")}{breakYear ? ` · ${t("data break in {year}; trend from {year}", { year: y(breakYear) })}` : ""}</p>
  </div>;
}

