"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type * as Leaflet from "leaflet";
import { ArrowUpRight, ChevronRight, Globe2, Layers3, LoaderCircle, MapPin, Pause, Play, TriangleAlert } from "lucide-react";
import { RangeControl as Slider } from "./range-control";
import { basemapLayer, createMap, escapeHtml, labelsLayer, loadLeaflet, type Basemap, type L } from "./map-kit";
import { geometryBBox, pointInGeometry, polygonsOf, representativePoint, ringBBox, type RegionCollection, type RegionFeature } from "@/lib/geo";
import { PERIOD_YEARS, RECORD_END, RECORD_START, type Place } from "@/lib/climate";
import { detectBreak, MIN_RAIN_STEP_FRACTION, MIN_TEMP_STEP } from "@/lib/homogeneity";
import { formatP, linearTrend } from "@/lib/stats";

const FIRST = RECORD_START, LAST = RECORD_END;
/** Bump when the shape or period of cached data changes, so browsers never reuse old files. */
const DATA_VERSION = `${FIRST}-${LAST}`;
const MIN_TREND = 15, MIN_COMPARE = 2 * PERIOD_YEARS;
const YEARS = Array.from({ length: LAST - FIRST + 1 }, (_, i) => FIRST + i);
const N = YEARS.length;

type Series = { t: (number | null)[]; p: (number | null)[]; cells?: number };
type Level =
  | { kind: "world" }
  | { kind: "country"; iso: string; name: string }
  | { kind: "state"; iso: string; country: string; parentId: string; name: string };
type Metric = "tempAnomaly" | "temp" | "rainAnomaly" | "rain";

const METRICS: Record<Metric, { label: string; short: string; stops: [number, string][]; fmt: (v: number) => string }> = {
  tempAnomaly: { label: "Temperature change", short: "vs first consistent decade", stops: [[-1.5, "#2166ac"], [-0.6, "#67a9cf"], [0, "#f2efe6"], [0.6, "#f4a582"], [1.2, "#d6604d"], [2, "#8e0b25"]], fmt: v => `${v >= 0 ? "+" : ""}${v.toFixed(2)} °C` },
  temp: { label: "Mean temperature", short: "annual mean", stops: [[-20, "#313695"], [-5, "#4575b4"], [5, "#91bfdb"], [15, "#fee090"], [22, "#fc8d59"], [28, "#d73027"], [32, "#7f0000"]], fmt: v => `${v.toFixed(1)} °C` },
  rainAnomaly: { label: "Rainfall change", short: "vs first consistent decade", stops: [[-40, "#8c510a"], [-15, "#d8b365"], [0, "#f2efe6"], [15, "#6181ad"], [40, "#01665e"]], fmt: v => `${v >= 0 ? "+" : ""}${v.toFixed(0)} %` },
  rain: { label: "Annual rainfall", short: "mm / year", stops: [[0, "#f3e3c3"], [300, "#d9d59a"], [800, "#95abc9"], [1500, "#41b6c4"], [2500, "#2c7fb8"], [4000, "#253494"]], fmt: v => `${Math.round(v).toLocaleString("en-US")} mm` },
};

function colorFor(v: number | null, stops: [number, string][]) {
  if (v === null || !Number.isFinite(v)) return "#333c49";
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [b, cb] = stops[i];
    if (v <= b) {
      const [a, ca] = stops[i - 1], f = (v - a) / (b - a);
      const p = (c: string, k: number) => parseInt(c.slice(1 + k * 2, 3 + k * 2), 16);
      return `rgb(${[0, 1, 2].map(k => Math.round(p(ca, k) + (p(cb, k) - p(ca, k)) * f)).join(",")})`;
    }
  }
  return stops[stops.length - 1][1];
}

const mean = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

/**
 * Homogeneity of a region's series (lib/homogeneity.ts): the first year from which temperature and
 * rainfall are free of abrupt non-climatic steps. Rainfall is tested after any temperature break.
 */
type Quality = { tFrom: number; pFrom: number; tBreak?: number; pBreak?: number };
const qualityCache = new WeakMap<Series, Quality>();
function quality(s: Series): Quality {
  let q = qualityCache.get(s);
  if (!q) {
    const tb = detectBreak(YEARS, s.t, MIN_TEMP_STEP);
    const tFrom = tb?.year ?? FIRST, i0 = tFrom - FIRST;
    const rest = s.p.slice(i0), restMean = mean(rest) ?? 0;
    const pb = detectBreak(YEARS.slice(i0), rest, MIN_RAIN_STEP_FRACTION * restMean);
    q = { tFrom, pFrom: pb?.year ?? tFrom, tBreak: tb?.year, pBreak: pb?.year };
    qualityCache.set(s, q);
  }
  return q;
}

/** Value for the map. Years before a data break, or anomalies without a full consistent baseline, are null. */
function valueAt(s: Series | undefined, metric: Metric, i: number, smooth: boolean): number | null {
  if (!s) return null;
  const isTemp = metric.startsWith("temp"), src = isTemp ? s.t : s.p, q = quality(s);
  const from = (isTemp ? q.tFrom : q.pFrom) - FIRST;
  if (i < from) return null;
  const raw = smooth ? mean(src.slice(Math.max(from, i - 2), Math.min(N, i + 3))) : src[i];
  if (raw === null) return null;
  if (metric === "tempAnomaly" || metric === "rainAnomaly") {
    if (N - from < MIN_COMPARE) return null;
    const b = mean(src.slice(from, from + PERIOD_YEARS));
    if (b === null) return null;
    return metric === "tempAnomaly" ? raw - b : b ? (raw / b - 1) * 100 : null;
  }
  return raw;
}

/** Trend over the consistent part of the series, with autocorrelation-corrected significance. */
function regionTrend(s: Series, kind: "t" | "p") {
  const q = quality(s), from = (kind === "t" ? q.tFrom : q.pFrom) - FIRST;
  const ys = s[kind].slice(from), xs = YEARS.slice(from);
  if (ys.filter(v => v !== null).length < MIN_TREND) return null;
  const t = linearTrend(xs, ys.map(v => (v === null ? NaN : v)));
  return t ? { perDecade: t.slope * 10, significant: t.significant, p: t.pValue, from: xs[0] } : null;
}

// ---- NASA POWER grid tiles → region averages ------------------------------
type Cell = (number | null)[]; // [lon, lat, t×N, p×N]
const tileCache = new Map<string, Promise<Cell[]>>();
function fetchTile(key: string): Promise<Cell[]> {
  let p = tileCache.get(key);
  if (!p) {
    const [lat, lon] = key.split(",");
    p = (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await fetch(`/api/power-grid?lat=${lat}&lon=${lon}&v=${DATA_VERSION}`);
          if (r.ok) return ((await r.json()) as { cells: Cell[] }).cells;
        } catch {}
        await new Promise(res => setTimeout(res, 1200 * (attempt + 1)));
      }
      tileCache.delete(key);
      throw new Error("tile failed");
    })();
    tileCache.set(key, p);
  }
  return p;
}

function tilesForFeature(f: RegionFeature) {
  const keys = new Set<string>();
  for (const poly of polygonsOf(f.geometry)) {
    const [x0, y0, x1, y1] = ringBBox(poly[0]);
    for (let lat = Math.floor((y0 - 0.3) / 10) * 10; lat <= Math.min(80, Math.floor((y1 + 0.3) / 10) * 10); lat += 10)
      for (let lon = Math.floor((x0 - 0.35) / 10) * 10; lon <= Math.min(170, Math.floor((x1 + 0.35) / 10) * 10); lon += 10)
        if (lat >= -90 && lon >= -180) keys.add(`${lat},${lon}`);
  }
  return keys;
}

function aggregateRegion(f: RegionFeature, cells: Cell[]): Series | null {
  const [x0, y0, x1, y1] = geometryBBox(f.geometry);
  let inside = cells.filter(c => { const x = c[0]!, y = c[1]!; return x >= x0 && x <= x1 && y >= y0 && y <= y1 && pointInGeometry(x, y, f.geometry); });
  if (!inside.length) {
    // Region smaller than one grid cell: use the nearest cell centre.
    const [rx, ry] = representativePoint(f.geometry);
    let best: Cell | null = null, bd = Infinity;
    for (const c of cells) { const d = (c[0]! - rx) ** 2 + (c[1]! - ry) ** 2; if (d < bd) { bd = d; best = c; } }
    if (!best || bd > 1.5) return null;
    inside = [best];
  }
  const avg = (offset: number, round: number) => YEARS.map((_, i) => {
    let s = 0, w = 0;
    for (const c of inside) { const v = c[offset + i]; if (v === null || v === undefined) continue; const wt = Math.cos((c[1]! * Math.PI) / 180); s += v * wt; w += wt; }
    return w ? Math.round((s / w) * round) / round : null;
  });
  return { t: avg(2, 100), p: avg(2 + N, 1), cells: inside.length };
}

// ---- component --------------------------------------------------------------
export default function ClimateAtlas({ onOpenPlace }: { onOpenPlace: (p: Place) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null), lRef = useRef<L | null>(null);
  const baseRef = useRef<Leaflet.LayerGroup | null>(null), geoRef = useRef<Leaflet.GeoJSON | null>(null);
  const [ready, setReady] = useState(false);
  const [level, setLevel] = useState<Level>({ kind: "world" });
  const [regions, setRegions] = useState<RegionCollection | null>(null);
  const [values, setValues] = useState<Map<string, Series>>(new Map());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [yearIdx, setYearIdx] = useState(N - 1);
  const [playing, setPlaying] = useState(false);
  const [metric, setMetric] = useState<Metric>("tempAnomaly");
  const [smooth, setSmooth] = useState(true);
  const [basemap, setBasemap] = useState<Basemap>("relief");
  const [selected, setSelected] = useState<string | null>(null);
  const year = YEARS[yearIdx];

  // live refs so Leaflet callbacks always read current state
  const live = useRef({ values, metric, yearIdx, smooth, selected, opacity: 0.72 });
  useEffect(() => { live.current = { values, metric, yearIdx, smooth, selected, opacity: basemap === "satellite" ? 0.42 : 0.72 }; });

  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then(Lf => {
      if (cancelled || !el.current) return;
      const map = createMap(Lf, el.current, { center: [22, 12], zoom: 2 });
      baseRef.current = basemapLayer(Lf, "relief").addTo(map);
      labelsLayer(Lf).addTo(map);
      mapRef.current = map;
      lRef.current = Lf;
      setReady(true);
    });
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  // Basemap (the satellite option shows MODIS imagery from the selected year)
  const satYear = playing ? null : year;
  useEffect(() => {
    const Lf = lRef.current, map = mapRef.current;
    if (!ready || !Lf || !map || (basemap === "satellite" && satYear === null)) return;
    baseRef.current?.remove();
    baseRef.current = basemapLayer(Lf, basemap, basemap === "satellite" ? `${satYear}-03-15` : undefined).addTo(map);
  }, [ready, basemap, satYear]);

  // Load boundaries + data for the current level
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setError(null);
      setSelected(null);
      setRegions(null);
      setValues(new Map());
      if (level.kind === "world") {
        setProgress({ done: 0, total: 1 });
        try {
          const [geo, climate] = await Promise.all([
            fetch(`/data/world-countries.json?v=${DATA_VERSION}`).then(r => r.json()) as Promise<RegionCollection>,
            fetch(`/data/world-climate.json?v=${DATA_VERSION}`).then(r => r.json()) as Promise<{ countries: Record<string, { t: (number | null)[]; p: (number | null)[]; points: number }> }>,
          ]);
          if (cancelled) return;
          setRegions(geo);
          setValues(new Map(Object.entries(climate.countries).map(([k, v]) => [k, { t: v.t, p: v.p, cells: v.points }])));
        } catch {
          if (!cancelled) setError("World climate layer could not be loaded.");
        } finally {
          if (!cancelled) setProgress(null);
        }
        return;
      }
      setProgress({ done: 0, total: 1 });
      const url = level.kind === "country" ? `/api/boundaries?iso=${level.iso}&level=ADM1` : `/api/boundaries?iso=${level.iso}&level=ADM2&parent=${encodeURIComponent(level.parentId)}`;
      let fc: RegionCollection;
      try {
        const r = await fetch(url);
        const j = (await r.json()) as RegionCollection & { error?: string };
        if (!r.ok) throw new Error(j.error);
        fc = j;
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error && e.message ? e.message : "Boundaries could not be loaded.");
        setProgress(null);
        return;
      }
      if (cancelled) return;
      setRegions(fc);
      // Work out which 10° NASA POWER tiles each region needs; color a region once all of its tiles arrive.
      const need = new Map(fc.features.map(f => [f.id, tilesForFeature(f)]));
      const allTiles = [...new Set([...need.values()].flatMap(s => [...s]))];
      const loaded = new Map<string, Cell[]>(), failed = new Set<string>();
      const result = new Map<string, Series>();
      setProgress({ done: 0, total: allTiles.length });
      const settle = () => {
        for (const f of fc.features) {
          if (result.has(f.id)) continue;
          const keys = [...need.get(f.id)!];
          if (!keys.every(k => loaded.has(k) || failed.has(k))) continue;
          const cells = keys.flatMap(k => loaded.get(k) ?? []);
          const s = cells.length ? aggregateRegion(f, cells) : null;
          if (s) result.set(f.id, s);
        }
        if (!cancelled) setValues(new Map(result));
      };
      let next = 0, done = 0;
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (next < allTiles.length && !cancelled) {
          const key = allTiles[next++];
          try { loaded.set(key, await fetchTile(key)); } catch { failed.add(key); }
          done++;
          if (!cancelled) { setProgress({ done, total: allTiles.length }); settle(); }
        }
      }));
      if (cancelled) return;
      setProgress(null);
      if (failed.size) setError(`${failed.size} of ${allTiles.length} NASA POWER tiles did not load; some regions are grey.`);
    };
    run();
    return () => { cancelled = true; };
  }, [level]);

  const styleFor = useCallback((f?: RegionFeature): Leaflet.PathOptions => {
    const { values: vals, metric: m, yearIdx: yi, smooth: sm, selected: sel, opacity } = live.current;
    const v = f ? valueAt(vals.get(f.properties.id), m, yi, sm) : null;
    const isSel = f?.properties.id === sel;
    return { fillColor: colorFor(v, METRICS[m].stops), fillOpacity: opacity, color: isSel ? "#ffffff" : "#050a14", weight: isSel ? 2.6 : 0.7, opacity: isSel ? 1 : 0.7 };
  }, []);

  // Draw region polygons when the region set changes
  useEffect(() => {
    const Lf = lRef.current, map = mapRef.current;
    if (!ready || !Lf || !map) return;
    geoRef.current?.remove();
    geoRef.current = null;
    if (!regions) return;
    const layer = Lf.geoJSON(regions as unknown as GeoJSON.GeoJsonObject, {
      style: f => styleFor(f as unknown as RegionFeature),
      onEachFeature: (f, lyr) => {
        const rf = f as unknown as RegionFeature;
        lyr.bindTooltip(() => {
          const { values: vals, metric: m, yearIdx: yi, smooth: sm } = live.current;
          const v = valueAt(vals.get(rf.properties.id), m, yi, sm);
          const s = vals.get(rf.properties.id), q = s ? quality(s) : null, from = q ? (m.startsWith("temp") ? q.tFrom : q.pFrom) : FIRST;
          const why = !s ? "loading…" : YEARS[yi] < from ? `inconsistent source data before ${from}` : "not enough consistent years";
          return `<b>${escapeHtml(rf.properties.name)}</b><br>${METRICS[m].label} ${YEARS[yi]}: <b>${v === null ? why : METRICS[m].fmt(v)}</b>`;
        }, { sticky: true, className: "atlas-tip" });
        lyr.on({
          mouseover: e => (e.target as Leaflet.Path).setStyle({ weight: 2, color: "#32a6ff" }),
          mouseout: e => (e.target as Leaflet.Path).setStyle(styleFor(rf)),
          click: () => setSelected(rf.properties.id),
        });
      },
    }).addTo(map);
    geoRef.current = layer;
    if (level.kind === "world") map.setView([22, 12], 2);
    else map.fitBounds(layer.getBounds(), { padding: [20, 20] });
  }, [ready, regions, level.kind, styleFor]);

  // Restyle on data / year / metric / selection change
  useEffect(() => {
    geoRef.current?.eachLayer(l => (l as Leaflet.Path & { feature?: RegionFeature }).setStyle(styleFor((l as { feature?: RegionFeature }).feature)));
  }, [values, metric, yearIdx, smooth, selected, basemap, styleFor]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setYearIdx(i => { if (i >= N - 1) { setPlaying(false); return i; } return i + 1; }), 700);
    return () => clearInterval(t);
  }, [playing]);

  const features = useMemo(() => regions?.features ?? [], [regions]);
  const selFeature = features.find(f => f.properties.id === selected) ?? null;
  const selSeries = selFeature ? values.get(selFeature.properties.id) : undefined;
  const isTemp = metric.startsWith("temp");

  const ranking = useMemo(() => {
    return features
      .map(f => {
        const s = values.get(f.properties.id);
        if (!s) return null;
        const t = regionTrend(s, isTemp ? "t" : "p");
        // Rank only like-for-like records: short post-break segments give steep but unreliable slopes.
        if (!t || LAST - t.from + 1 < MIN_COMPARE) return null;
        // Rainfall is ranked in % of the region's consistent-period mean per decade, so wet and dry regions compare fairly.
        const base = isTemp ? 1 : mean(s.p.slice(t.from - FIRST)) ?? 0;
        const score = isTemp ? t.perDecade : base ? (t.perDecade / base) * 100 : null;
        return score === null ? null : { f, score, significant: t.significant, p: t.p, from: t.from };
      })
      .filter((x): x is { f: RegionFeature; score: number; significant: boolean; p: number; from: number } => !!x)
      .sort((a, b) => Number(b.significant) - Number(a.significant) || (isTemp ? b.score - a.score : Math.abs(b.score) - Math.abs(a.score)));
  }, [features, values, isTemp]);

  // Average of the whole view for the stripes when nothing is selected
  const viewSeries = useMemo<Series | undefined>(() => {
    const all = [...values.values()];
    if (!all.length) return undefined;
    return { t: YEARS.map((_, i) => mean(all.map(s => s.t[i]))), p: YEARS.map((_, i) => mean(all.map(s => s.p[i]))) };
  }, [values]);
  const stripeSeries = selSeries ?? viewSeries;

  const unitName = level.kind === "world" ? "countries" : level.kind === "country" ? (regions?.meta?.canonical ? `${regions.meta.canonical.toLowerCase()}s` : "states / provinces") : "districts";
  const loadedCount = values.size;

  const drill = () => {
    if (!selFeature) return;
    if (level.kind === "world") setLevel({ kind: "country", iso: selFeature.properties.iso || selFeature.properties.id, name: selFeature.properties.name });
    else if (level.kind === "country") setLevel({ kind: "state", iso: level.iso, country: level.name, parentId: selFeature.properties.id, name: selFeature.properties.name });
  };
  const openInExplorer = () => {
    if (!selFeature) return;
    const [lon, lat] = representativePoint(selFeature.geometry);
    const country = level.kind === "world" ? selFeature.properties.name : level.kind === "country" ? level.name : level.country;
    onOpenPlace({ id: `atlas-${selFeature.properties.id}`, name: selFeature.properties.name, country, lat: +lat.toFixed(4), lon: +lon.toFixed(4), region: level.kind === "state" ? level.name : undefined });
  };

  const selValue = valueAt(selSeries, metric, yearIdx, smooth);
  const legend = METRICS[metric].stops;

  return (
    <section className="atlas">
      <div className="atlas-top">
        <nav className="atlas-crumbs" aria-label="Map level">
          <button onClick={() => setLevel({ kind: "world" })} className={level.kind === "world" ? "on" : ""}><Globe2 size={14} /> World</button>
          {level.kind !== "world" && <><ChevronRight size={13} /><button className={level.kind === "country" ? "on" : ""} onClick={() => level.kind === "state" && setLevel({ kind: "country", iso: level.iso, name: level.country })}>{level.kind === "country" ? level.name : level.country}</button></>}
          {level.kind === "state" && <><ChevronRight size={13} /><button className="on">{level.name}</button></>}
        </nav>
        <div className="atlas-metrics" role="tablist">
          {(Object.keys(METRICS) as Metric[]).map(m => <button key={m} role="tab" aria-selected={metric === m} className={metric === m ? "on" : ""} onClick={() => setMetric(m)}>{METRICS[m].label}</button>)}
        </div>
      </div>

      <div className="atlas-grid">
        <div className="atlas-map-card">
          <div ref={el} className="atlas-map" role="application" aria-label={`Climate map of ${unitName}`} />
          <div className="atlas-year-badge"><span>{year}</span><small>{METRICS[metric].label}{smooth ? " · 5-yr mean" : ""}</small></div>
          <div className="map-toolbar">
            {(["relief", "satellite", "night"] as Basemap[]).map(b => <button key={b} className={basemap === b ? "on" : ""} onClick={() => setBasemap(b)}>{b === "relief" ? "Blue Marble" : b === "satellite" ? `MODIS ${year}` : "Night lights"}</button>)}
          </div>
          <div className="map-legend atlas-legend">
            <div className="legend-bar" style={{ background: `linear-gradient(90deg, ${legend.map(([, c]) => c).join(",")})` }} />
            <div className="legend-labels"><span>{METRICS[metric].fmt(legend[0][0])}</span><span>{METRICS[metric].short}</span><span>{METRICS[metric].fmt(legend[legend.length - 1][0])}</span></div>
          </div>
          {progress && <div className="atlas-progress"><LoaderCircle className="spin" size={15} /> {progress.total > 1 ? <>Averaging NASA POWER grid cells… {progress.done}/{progress.total} tiles · {loadedCount}/{features.length} {unitName}</> : "Loading map…"}<i style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} /></div>}
          {error && <div className="map-error"><TriangleAlert size={16} /> {error}</div>}
        </div>

        <aside className="atlas-panel">
          {selFeature ? (
            <div className="atlas-region">
              <span className="eyebrow">{level.kind === "world" ? "COUNTRY" : level.kind === "country" ? (regions?.meta?.canonical || "STATE / PROVINCE").toUpperCase() : "DISTRICT"}</span>
              <h2>{selFeature.properties.name}</h2>
              <div className="atlas-value"><strong>{selValue === null ? "—" : METRICS[metric].fmt(selValue)}</strong><span>{METRICS[metric].label.toLowerCase()} in {year}</span></div>
              {selSeries && <div className="atlas-facts">
                <div><span>Temperature trend{regionTrend(selSeries, "t") ? ` ${regionTrend(selSeries, "t")!.from}–${LAST}` : ""}</span><strong>{(() => { const t = regionTrend(selSeries, "t"); return t === null ? "too few years" : `${t.perDecade >= 0 ? "+" : ""}${t.perDecade.toFixed(2)} °C/dec${t.significant ? "" : " · n.s."}`; })()}</strong></div>
                <div><span>Rainfall trend{regionTrend(selSeries, "p") ? ` ${regionTrend(selSeries, "p")!.from}–${LAST}` : ""}</span><strong>{(() => { const t = regionTrend(selSeries, "p"); return t === null ? "too few years" : `${t.perDecade >= 0 ? "+" : ""}${Math.round(t.perDecade)} mm/dec${t.significant ? "" : " · n.s."}`; })()}</strong></div>
                <div><span>{year} mean temp.</span><strong>{selSeries.t[yearIdx]?.toFixed(1) ?? "—"} °C</strong></div>
                <div><span>{year} rainfall</span><strong>{selSeries.p[yearIdx]?.toLocaleString("en-US") ?? "—"} mm</strong></div>
              </div>}
              {selSeries && (quality(selSeries).tBreak || quality(selSeries).pBreak) && <p className="atlas-break">Data break detected{quality(selSeries).tBreak ? ` in ${quality(selSeries).tBreak} (temperature)` : ""}{quality(selSeries).pBreak ? `${quality(selSeries).tBreak ? " and" : ""} in ${quality(selSeries).pBreak} (rainfall)` : ""} — earlier years are greyed out and excluded from trends.</p>}
              {selSeries && <p className="atlas-cells">{level.kind === "world" ? `Averaged from ${selSeries.cells} NASA POWER sample points.` : `Area-average of ${selSeries.cells} NASA POWER grid cell${selSeries.cells === 1 ? "" : "s"} (0.5° × 0.625°).`}</p>}
              <div className="atlas-actions">
                {level.kind !== "state" && <button className="lime-button" onClick={drill}><Layers3 size={15} /> {level.kind === "world" ? "Show states / provinces" : "Show districts"}</button>}
                <button className="outline-button" onClick={openInExplorer}><MapPin size={15} /> Open in Earth explorer <ArrowUpRight size={14} /></button>
              </div>
            </div>
          ) : (
            <div className="atlas-region atlas-hint">
              <span className="eyebrow">{level.kind === "world" ? "THE WHOLE PLANET" : level.kind === "country" ? level.name.toUpperCase() : level.name.toUpperCase()}</span>
              <h2>{level.kind === "world" ? "Pick a country" : level.kind === "country" ? `Pick a ${(regions?.meta?.canonical || "state").toLowerCase()}` : "Pick a district"}</h2>
              <p>Click any shape to see its story. Press play to watch {features.length ? features.length.toLocaleString("en-US") : "the"} {unitName} change year by year, {FIRST}–{LAST}.</p>
            </div>
          )}

          <div className="atlas-rank">
            <h4>{isTemp ? "Fastest warming" : "Biggest rainfall trend"} <small>significant first · regions with ≥ {MIN_COMPARE} consistent years</small></h4>
            {ranking.slice(0, 6).map((r, i) => (
              <button key={r.f.id} className={selected === r.f.properties.id ? "on" : ""} onClick={() => { setSelected(r.f.properties.id); const b = geometryBBox(r.f.geometry); mapRef.current?.fitBounds([[b[1], b[0]], [b[3], b[2]]], { maxZoom: level.kind === "world" ? 5 : 9, padding: [40, 40] }); }}>
                <span>{i + 1}</span><em>{r.f.properties.name}</em><strong className={r.significant ? "" : "muted-text"} title={`${r.from}–${LAST} · ${formatP(r.p)}`}>{isTemp ? `${r.score >= 0 ? "+" : ""}${r.score.toFixed(2)}°/dec` : `${r.score >= 0 ? "+" : ""}${r.score.toFixed(1)}%/dec`}{r.significant ? "" : " n.s."}</strong>
              </button>
            ))}
            {!ranking.length && <p className="hz-empty">{progress ? "Waiting for NASA data…" : "No data yet."}</p>}
          </div>
        </aside>
      </div>

      <div className="atlas-timeline content-panel">
        <button className="play-button" onClick={() => { if (yearIdx >= N - 1) setYearIdx(0); setPlaying(p => !p); }} aria-label={playing ? "Pause" : "Play years"}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
        <div className="timeline-body">
          <div className="stripes" aria-label={`Climate stripes for ${selFeature?.properties.name ?? "this view"}`}>
            {YEARS.map((y, i) => {
              const v = valueAt(stripeSeries, isTemp ? "tempAnomaly" : "rainAnomaly", i, false);
              return <button key={y} title={`${y}: ${v === null ? "no data" : METRICS[isTemp ? "tempAnomaly" : "rainAnomaly"].fmt(v)}`} className={i === yearIdx ? "on" : ""} style={{ background: colorFor(v, METRICS[isTemp ? "tempAnomaly" : "rainAnomaly"].stops) } as CSSProperties} onClick={() => { setPlaying(false); setYearIdx(i); }} />;
            })}
          </div>
          <Slider aria-label="Map year" min={0} max={N - 1} step={1} value={[yearIdx]} onValueChange={v => { setPlaying(false); setYearIdx(v[0]); }} />
          <div className="timeline-labels"><span>{FIRST}</span><span>{selFeature ? `${selFeature.properties.name} climate stripes` : `Average of all ${unitName} shown`}</span><span>{LAST}</span></div>
        </div>
        <label className="hz-check"><input type="checkbox" checked={smooth} onChange={e => setSmooth(e.target.checked)} /> 5-year smoothing</label>
      </div>
      <p className="hz-disclaimer">Data: NASA POWER monthly MERRA-2 reanalysis, {FIRST}–{LAST}. Each region is tested for abrupt non-climatic steps (Lund & Reeves two-phase regression, 99%); years before a step are shown grey and excluded. Changes are relative to each region&apos;s first consistent decade; trends marked n.s. are not statistically significant (p ≥ 0.05). {level.kind === "world" ? "Country values are averages of up to 8 sample points." : "Values are averages of the NASA grid cells inside each boundary."} Boundaries: {level.kind === "world" ? "Natural Earth (public domain)" : `${regions?.meta?.source ?? "geoBoundaries"}${regions?.meta?.license ? `, ${regions.meta.license}` : ""}`}. Boundaries are for display only and do not imply any position on disputed territory.</p>
    </section>
  );
}
