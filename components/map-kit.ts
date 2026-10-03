"use client";
import type * as Leaflet from "leaflet";

export type L = typeof Leaflet;

let leafletPromise: Promise<L> | null = null;
/** Leaflet touches `window` at import time, so it is only ever loaded in the browser. */
export function loadLeaflet(): Promise<L> {
  leafletPromise ??= import("leaflet").then(m => ((m as unknown as { default?: L }).default ?? (m as unknown as L)));
  return leafletPromise;
}

const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
export const GIBS_ATTRIBUTION = 'Imagery <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noreferrer">NASA GIBS</a>';

export const utcDate = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

export type Basemap = "relief" | "satellite" | "night";

// Keep a margin of tiles around the view and do not fetch while zooming, so panning feels instant.
const FAST = { keepBuffer: 4, updateWhenZooming: false } as const;

/** GIBS occasionally drops a tile under load: retry each failed tile once. */
function retryTiles<T extends Leaflet.TileLayer>(layer: T): T {
  layer.on("tileerror", e => {
    const img = e.tile as HTMLImageElement;
    if (img.dataset.retried) return;
    img.dataset.retried = "1";
    const src = img.src;
    setTimeout(() => { img.src = src + (src.includes("?") ? "&" : "?") + "retry=1"; }, 900);
  });
  return layer;
}

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const ESRI_ATTRIBUTION = "Imagery &copy; Esri, Maxar, Earthstar Geographics";

/** Sharp, fast (CDN) satellite imagery for close zooms, where NASA global layers become blurry and slow. */
function detailImagery(Lf: L, minZoom: number) {
  return Lf.tileLayer(`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, { ...FAST, minZoom, maxNativeZoom: 18, maxZoom: 19, attribution: ESRI_ATTRIBUTION });
}

const dayBefore = (date: string) => new Date(Date.parse(date) - 86_400_000).toISOString().slice(0, 10);
const loadTileImage = (src: string) => new Promise<HTMLImageElement | null>(resolve => {
  const img = new Image();
  img.crossOrigin = "anonymous"; // GIBS sends Access-Control-Allow-Origin: *
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = src;
});

/**
 * A daily MODIS true-colour image has black wedges between orbits near the equator (and black polar
 * night). Each tile fills them the way a mosaic would: Terra → Aqua (same day, orbits ~3 h apart) →
 * Terra the day before → Blue Marble, so the planet view never shows black stripes.
 */
function gapFilledTrueColor(Lf: L, date: string) {
  const tile = (layer: string, d: string, c: Leaflet.Coords) => `${GIBS}/${layer}/default/${d}/GoogleMapsCompatible_Level9/${c.z}/${c.y}/${c.x}.jpg`;
  const Layer = Lf.GridLayer.extend({
    createTile(coords: Leaflet.Coords, done: Leaflet.DoneCallback) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 256;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      const sources = [
        tile("MODIS_Terra_CorrectedReflectance_TrueColor", date, coords),
        tile("MODIS_Aqua_CorrectedReflectance_TrueColor", date, coords),
        tile("MODIS_Terra_CorrectedReflectance_TrueColor", dayBefore(date), coords),
        `${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/${Math.min(coords.z, 8)}/${coords.z > 8 ? coords.y >> 1 : coords.y}/${coords.z > 8 ? coords.x >> 1 : coords.x}.jpeg`,
      ];
      (async () => {
        let out: ImageData | null = null, gap: Uint8Array | null = null;
        for (let s = 0; s < sources.length; s++) {
          const img = await loadTileImage(sources[s]);
          if (!img) continue;
          ctx.clearRect(0, 0, 256, 256);
          if (s === 3 && coords.z > 8) ctx.drawImage(img, (coords.x & 1) * 128, (coords.y & 1) * 128, 128, 128, 0, 0, 256, 256);
          else ctx.drawImage(img, 0, 0, 256, 256);
          const px = ctx.getImageData(0, 0, 256, 256), d = px.data;
          // "No data" is pure black in these JPEGs; widen the mask by 2 px to also catch the dark JPEG fringe.
          const black = new Uint8Array(256 * 256);
          for (let p = 0; p < black.length; p++) if (Math.max(d[p * 4], d[p * 4 + 1], d[p * 4 + 2]) < 14) black[p] = 1;
          const mask = new Uint8Array(black.length);
          for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
            if (!black[y * 256 + x]) continue;
            for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
              const yy = y + dy, xx = x + dx;
              if (yy >= 0 && yy < 256 && xx >= 0 && xx < 256) mask[yy * 256 + xx] = 1;
            }
          }
          if (!out) { out = px; gap = mask; }
          else {
            for (let p = 0; p < gap!.length; p++) if (gap![p] && !mask[p]) {
              out.data.set(d.subarray(p * 4, p * 4 + 4), p * 4);
              gap![p] = 0;
            }
          }
          if (!gap!.some(v => v)) break;
        }
        if (out) ctx.putImageData(out, 0, 0);
        done(undefined, canvas);
      })();
      return canvas;
    },
  });
  const LayerCtor = Layer as unknown as new (o: Leaflet.GridLayerOptions) => Leaflet.GridLayer;
  return new LayerCtor({ ...FAST, maxNativeZoom: 9, maxZoom: 9, attribution: `${GIBS_ATTRIBUTION} · MODIS Terra + Aqua ${date}, gaps filled` });
}

/**
 * NASA GIBS imagery for the planetary view. GIBS serves over HTTP/1.1 (≈6 parallel requests,
 * ~0.7 s per tile), so close-up zooms hand over to a CDN imagery layer instead of stalling on black tiles.
 */
export function basemapLayer(Lf: L, kind: Basemap, date?: string) {
  const group = Lf.layerGroup();
  if (kind === "satellite") {
    gapFilledTrueColor(Lf, date ?? utcDate(-1)).addTo(group);
    detailImagery(Lf, 10).addTo(group);
  } else if (kind === "night") {
    retryTiles(Lf.tileLayer(`${GIBS}/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`, { ...FAST, maxNativeZoom: 8, maxZoom: 9, attribution: `${GIBS_ATTRIBUTION} · VIIRS Black Marble 2016` })).addTo(group);
    detailImagery(Lf, 10).addTo(group);
  } else {
    retryTiles(Lf.tileLayer(`${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`, { ...FAST, maxNativeZoom: 8, maxZoom: 6, attribution: `${GIBS_ATTRIBUTION} · Blue Marble` })).addTo(group);
    detailImagery(Lf, 7).addTo(group);
  }
  return group;
}

/** Country borders + place names for all zooms, and roads once you are close enough to plan a route. */
export function labelsLayer(Lf: L) {
  const group = Lf.layerGroup();
  Lf.tileLayer(`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, { ...FAST, pane: "labels", maxNativeZoom: 18, maxZoom: 19, attribution: "Labels &copy; Esri" }).addTo(group);
  Lf.tileLayer(`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`, { ...FAST, pane: "labels", minZoom: 11, maxNativeZoom: 18, maxZoom: 19, opacity: 0.8 }).addTo(group);
  return group;
}

/** NASA near-real-time overlays (yesterday, so the global composite is complete). */
export function firesLayer(Lf: L) {
  return Lf.tileLayer(`${GIBS}/VIIRS_SNPP_Thermal_Anomalies_375m_All/default/${utcDate(-1)}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`, { ...FAST, maxNativeZoom: 8, maxZoom: 19, opacity: 0.95, attribution: "VIIRS active fires (NASA FIRMS)" });
}
/** NASA MODIS (Terra + Aqua) aerosol optical depth: smoke, dust and haze from yesterday's passes. */
export function aerosolLayer(Lf: L) {
  return Lf.tileLayer(`${GIBS}/MODIS_Combined_Value_Added_AOD/default/${utcDate(-1)}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`, { ...FAST, maxNativeZoom: 6, maxZoom: 19, opacity: 0.65, attribution: "MODIS aerosol optical depth (NASA)" });
}

export function rainLayer(Lf: L) {
  return Lf.tileLayer(`${GIBS}/IMERG_Precipitation_Rate/default/${utcDate(-1)}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`, { ...FAST, maxNativeZoom: 6, maxZoom: 19, opacity: 0.7, attribution: "GPM IMERG precipitation (NASA)" });
}

// ---- NASA LANCE MODIS near-real-time global flood product (MCDWD) ------------------------------
// GIBS renders its classes as fixed colours; we re-colour them on a canvas so the user can show
// only unusual flooding, and so cloud gaps can be hidden or shown faintly.
export type FloodMode = "flood" | "all";
const FLOOD_CLASSES = [
  { rgb: [250, 30, 36], cls: "flood" },        // flood: water where there normally is none
  { rgb: [255, 255, 0], cls: "recurring" },    // recurring (seasonal) flood
  { rgb: [50, 210, 245], cls: "water" },       // normal surface water (reference)
  { rgb: [175, 175, 175], cls: "nodata" },     // cloud / insufficient observations
] as const;
/* i18n */export const FLOOD_LEGEND = [
  { cls: "flood", label: "Unusual flood", color: "#ff2d3a" },
  { cls: "recurring", label: "Seasonal flood", color: "#ffd400" },
  { cls: "water", label: "Normal water", color: "#32d2f5" },
  { cls: "nodata", label: "Cloud / no data", color: "#9aa0a6" },
] as const;/* /i18n */

export function floodLayer(Lf: L, opts: { days: 1 | 2 | 3; mode: FloodMode; showGaps: boolean; date?: string }) {
  const date = opts.date ?? utcDate(-1);
  const keep = new Set<string>(opts.mode === "flood" ? ["flood", "recurring"] : ["flood", "recurring", "water"]);
  if (opts.showGaps) keep.add("nodata");
  const Layer = Lf.GridLayer.extend({
    createTile(coords: Leaflet.Coords, done: Leaflet.DoneCallback) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 256;
      const img = new Image();
      img.crossOrigin = "anonymous"; // GIBS sends Access-Control-Allow-Origin: *
      img.onload = () => {
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, 256, 256);
        const px = ctx.getImageData(0, 0, 256, 256), d = px.data;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] === 0) continue;
          const c = FLOOD_CLASSES.find(k => Math.abs(d[i] - k.rgb[0]) < 24 && Math.abs(d[i + 1] - k.rgb[1]) < 24 && Math.abs(d[i + 2] - k.rgb[2]) < 24);
          if (!c || !keep.has(c.cls)) { d[i + 3] = 0; continue; }
          if (c.cls === "nodata") d[i + 3] = 70; // faint so the basemap shows through
          else if (c.cls === "water") d[i + 3] = 170;
          else d[i + 3] = 255;
        }
        ctx.putImageData(px, 0, 0);
        done(undefined, canvas);
      };
      img.onerror = () => done(undefined, canvas); // empty tile: no data for this area
      img.src = `${GIBS}/MODIS_Combined_Flood_${opts.days}-Day/default/${date}/GoogleMapsCompatible_Level9/${coords.z}/${coords.y}/${coords.x}.png`;
      return canvas;
    },
  });
  const LayerCtor = Layer as unknown as new (o: Leaflet.GridLayerOptions) => Leaflet.GridLayer;
  return new LayerCtor({ maxNativeZoom: 9, maxZoom: 19, opacity: 0.9, zIndex: 5, attribution: `NASA LANCE MODIS flood product (${opts.days}-day, ${date})` });
}

/** NASA SEDAC Gridded Population of the World v4, 2020 density. */
export function populationLayer(Lf: L) {
  return Lf.tileLayer(`${GIBS}/GPW_Population_Density_2020/default/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`, { ...FAST, maxNativeZoom: 7, maxZoom: 19, opacity: 0.6, zIndex: 4, attribution: "NASA SEDAC GPWv4 population density 2020" });
}

/** Creates a map with a separate pane so place labels sit above the data layers. */
export function createMap(Lf: L, el: HTMLElement, opts: Leaflet.MapOptions = {}) {
  const map = Lf.map(el, { worldCopyJump: true, minZoom: 2, maxZoom: 18, zoomControl: false, attributionControl: true, ...opts });
  map.createPane("labels");
  const pane = map.getPane("labels")!;
  pane.style.zIndex = "450";
  pane.style.pointerEvents = "none";
  Lf.control.zoom({ position: "bottomright" }).addTo(map);
  map.attributionControl.setPrefix(false);
  // Keep tiles aligned when the sidebar, pane or layout changes the container size.
  const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
  observer.observe(el);
  map.on("unload", () => observer.disconnect());
  return map;
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
