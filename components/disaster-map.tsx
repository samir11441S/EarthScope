"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { CloudRain, Crosshair, ExternalLink, Flame, LoaderCircle, LocateFixed, MapPin, Navigation, RefreshCw, ShieldCheck, Siren, Thermometer, TriangleAlert, Users, Waves, Wind } from "lucide-react";
import { aerosolLayer, basemapLayer, createMap, escapeHtml, firesLayer, FLOOD_LEGEND, floodLayer, labelsLayer, loadLeaflet, populationLayer, rainLayer, type FloodMode, type L } from "./map-kit";
import { BangladeshOfficial, EventImpact, HeatOutlookCard, HeatStrip, inBangladeshRegion, worstHeat } from "./hazard-panels";
import { BMD_LABEL, heatAlert, HEAT_META, type HeatOutlook } from "@/lib/heat";
import type { SafetyPack } from "@/lib/safety-watch";
import MyPlaces from "./my-places";
import { LOCATE_HELP, LocateError, locateApproximately, locateWithBrowser, type LocateFailure, type Located } from "@/lib/locate";
import type { Place as SearchPlace } from "@/lib/climate";
import { assessSafety, GUIDANCE, HAZARD_META, insideNow, isInsideAnyZone, SAFE_PLACE_META, SEVERITY_META, type Hazard, type HazardFeed, type HazardType, type SafePlace } from "@/lib/hazards";
import { distanceKm, polygonsOf, type Geometry } from "@/lib/geo";
import type { Place } from "@/lib/climate";
import { toBnDigits, useI18n } from "@/lib/i18n";
import { aqiCategory, type AirQuality } from "@/lib/air-quality";
import { AirQualityCard } from "./air-quality";

type Me = { lat: number; lon: number; label: string; accuracyM?: number | null; source?: Located["source"] | "place" | "map" | "search" };
type RankedPlace = SafePlace & { distanceKm: number };
type When = "all" | "new" | "ongoing" | "forecast";
const TYPES: HazardType[] = ["storm", "flood", "earthquake", "wildfire", "volcano", "drought", "landslide", "heat", "dust", "other"];
const REFRESH_MS = 5 * 60_000;
/* i18n */const WHEN: { id: When; label: string; test: (h: Hazard) => boolean }[] = [
  { id: "all", label: "All current", test: () => true },
  { id: "new", label: "New · last 24 h", test: h => h.phase === "new" },
  { id: "ongoing", label: "Ongoing", test: h => h.phase === "ongoing" },
  { id: "forecast", label: "Coming · forecast", test: h => !!h.forecast?.length },
];/* /i18n */

/** GeoJSON [lon, lat] rings → Leaflet [lat, lon] (multi)polygon. */
const latLngs = (g: Geometry) => polygonsOf(g).map(poly => poly.map(ring => ring.map(([x, y]) => [y, x] as [number, number])));
type T = (en: string, vars?: Record<string, string | number>) => string;
const when = (iso: string, lang = "en") => new Date(iso).toLocaleString(lang === "bn" ? "bn-BD" : [], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
/** Walks away from the hazard centre in 2 km steps until the point leaves the footprint / zone. */
function exitDistance(h: Hazard, lat: number, lon: number) {
  const R = 6371, rad = Math.PI / 180;
  const brg = Math.atan2(Math.sin((lon - h.lon) * rad) * Math.cos(lat * rad), Math.cos(h.lat * rad) * Math.sin(lat * rad) - Math.sin(h.lat * rad) * Math.cos(lat * rad) * Math.cos((lon - h.lon) * rad));
  for (let d = 2; d <= 800; d += 2) {
    const dr = d / R, la = Math.asin(Math.sin(lat * rad) * Math.cos(dr) + Math.cos(lat * rad) * Math.sin(dr) * Math.cos(brg));
    const lo = lon * rad + Math.atan2(Math.sin(brg) * Math.sin(dr) * Math.cos(lat * rad), Math.cos(dr) - Math.sin(lat * rad) * Math.sin(la));
    if (!insideNow(h, la / rad, ((lo / rad + 540) % 360) - 180)) return d + 3;
  }
  return 800;
}
function timeUntil(iso: string, t: T) {
  const h = Math.round((Date.parse(iso) - Date.now()) / 3_600_000);
  return h < 1 ? t("within the hour") : h < 48 ? t("in ~{n} h", { n: h }) : t("in ~{n} days", { n: Math.round(h / 24) });
}

function timeAgo(iso: string, t: T) {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (mins < 60) return t("{n} min ago", { n: mins });
  const h = Math.round(mins / 60);
  if (h < 48) return t("{n} h ago", { n: h });
  return t("{n} days ago", { n: Math.round(h / 24) });
}
const km = (d: number) => (d < 10 ? d.toFixed(1) : Math.round(d).toLocaleString("en-US")) + " km";
const routeUrl = (from: Me, to: { lat: number; lon: number }) =>
  `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=${from.lat.toFixed(5)}%2C${from.lon.toFixed(5)}%3B${to.lat.toFixed(5)}%2C${to.lon.toFixed(5)}`;

export default function DisasterMap({ place }: { place: Place }) {
  const { t, lang, y } = useI18n();
  // Latest translator for map callbacks and fetches that should not re-run on a language switch.
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; });
  const kmL = (d: number) => (lang === "bn" ? toBnDigits(km(d)).replace(/ km$/, " কিমি") : km(d));
  const tu = (iso: string) => timeUntil(iso, t), ta = (iso: string) => timeAgo(iso, t), wh = (iso: string) => when(iso, lang);
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null), lRef = useRef<L | null>(null);
  const groups = useRef<{ hazards?: Leaflet.LayerGroup; me?: Leaflet.LayerGroup; fires?: Leaflet.TileLayer; rain?: Leaflet.TileLayer; pop?: Leaflet.TileLayer; heat?: Leaflet.LayerGroup; aod?: Leaflet.TileLayer }>({});
  const floodRef = useRef<Leaflet.GridLayer | null>(null);
  const pickingRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [feed, setFeed] = useState<HazardFeed | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Set<HazardType>>(() => new Set(TYPES));
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [whenFilter, setWhenFilter] = useState<When>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"events" | "safety">("events");
  const [me, setMe] = useState<Me | null>(null);
  const [picking, setPicking] = useState(false);
  const [safe, setSafe] = useState<{ places: SafePlace[]; radiusKm: number } | null>(null), [safeLoading, setSafeLoading] = useState(false), [safeError, setSafeError] = useState<string | null>(null);
  const [showFires, setShowFires] = useState(true), [showRain, setShowRain] = useState(false);
  // NASA flood map (on by default, unusual flooding only), population density, Bangladesh heat watch
  const [showFlood, setShowFlood] = useState(true), [floodMode, setFloodMode] = useState<FloodMode>("flood"), [floodDays, setFloodDays] = useState<1 | 2 | 3>(3), [showGaps, setShowGaps] = useState(false);
  const [showPop, setShowPop] = useState(false), [showHeat, setShowHeat] = useState(true), [showAod, setShowAod] = useState(false);
  const [aqAtMe, setAqAtMe] = useState<AirQuality | null>(null);
  const [bdHeat, setBdHeat] = useState<(HeatOutlook & { name?: string })[] | null>(null);
  const [heatAtMe, setHeatAtMe] = useState(false), [heatSummary, setHeatSummary] = useState<string | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoFail, setGeoFail] = useState<LocateFailure | null>(null), [locating, setLocating] = useState<"browser" | "ip" | null>(null);
  const [search, setSearch] = useState(""), [searchResults, setSearchResults] = useState<SearchPlace[]>([]), [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Always ask the server (it keeps its own 4-minute cache), so the browser never replays a stale feed.
      const r = await fetch("/api/disasters", { cache: "no-store" });
      const j = (await r.json()) as HazardFeed & { error?: string };
      if (!r.ok) throw new Error(j.error);
      setFeed(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : tRef.current("Live hazard feeds could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    queueMicrotask(load);
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  // Map setup
  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then(Lf => {
      if (cancelled || !el.current) return;
      const map = createMap(Lf, el.current, { center: [18, 60], zoom: 2 });
      basemapLayer(Lf, "relief").addTo(map);
      labelsLayer(Lf).addTo(map);
      groups.current = { hazards: Lf.layerGroup().addTo(map), me: Lf.layerGroup().addTo(map), fires: firesLayer(Lf), rain: rainLayer(Lf), pop: populationLayer(Lf), heat: Lf.layerGroup().addTo(map), aod: aerosolLayer(Lf) };
      map.on("click", e => {
        if (!pickingRef.current) return;
        pickingRef.current = false;
        setPicking(false);
        setMe({ lat: e.latlng.lat, lon: ((e.latlng.lng + 540) % 360) - 180, label: tRef.current("Pinned location"), source: "map" });
        setGeoFail(null);
        setTab("safety");
      });
      mapRef.current = map;
      lRef.current = Lf;
      setReady(true);
    });
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => { pickingRef.current = picking; el.current?.classList.toggle("is-picking", picking); }, [picking]);

  useEffect(() => {
    const map = mapRef.current, g = groups.current;
    if (!ready || !map || !g.fires || !g.rain) return;
    if (showFires) g.fires.addTo(map); else g.fires.remove();
    if (showRain) g.rain.addTo(map); else g.rain.remove();
    if (g.pop) { if (showPop) g.pop.addTo(map); else g.pop.remove(); }
    if (g.aod) { if (showAod) g.aod.addTo(map); else g.aod.remove(); }
  }, [ready, showFires, showRain, showPop, showAod]);

  // NASA flood map: rebuilt when its options change (each option changes how tiles are re-coloured).
  useEffect(() => {
    const Lf = lRef.current, map = mapRef.current;
    if (!ready || !Lf || !map) return;
    floodRef.current?.remove();
    floodRef.current = showFlood ? floodLayer(Lf, { days: floodDays, mode: floodMode, showGaps }).addTo(map) : null;
  }, [ready, showFlood, floodDays, floodMode, showGaps]);

  // Bangladesh heat watch: division capitals, refreshed every 30 minutes.
  useEffect(() => {
    let active = true;
    const run = () => fetch("/api/heat?bd=1").then(r => r.json() as Promise<{ outlooks?: (HeatOutlook & { name?: string })[] }>).then(j => active && setBdHeat(j.outlooks ?? null)).catch(() => {});
    queueMicrotask(run);
    const t = setInterval(run, 30 * 60_000);
    return () => { active = false; clearInterval(t); };
  }, []);
  useEffect(() => {
    const Lf = lRef.current, g = groups.current.heat;
    if (!ready || !Lf || !g) return;
    g.clearLayers();
    if (!showHeat || !bdHeat) return;
    for (const o of bdHeat) {
      const w = worstHeat(o), meta = HEAT_META[w.level];
      Lf.marker([o.lat, o.lon], { icon: Lf.divIcon({ className: "", html: `<div class="heat-pin${heatAlert(w) ? " alert" : ""}" style="--c:${meta.color}"><span>${Math.round(w.heatIndexMax)}°</span></div>`, iconSize: [34, 22], iconAnchor: [17, 11] }), zIndexOffset: -100 })
        .bindTooltip(`<b>${escapeHtml(o.name ?? "")} — ${t("heat watch")}</b><br>${t("Next 3 days: {level}, heat index up to {v} °C", { level: t(meta.label), v: Math.round(w.heatIndexMax) })}<br>${t("Max temperature {v} °C", { v: w.tmax.toFixed(1) })}${w.bmd !== "none" ? " · " + t(BMD_LABEL[w.bmd]) : ""}`, { direction: "top", offset: [0, -10] })
        .addTo(g);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, showHeat, bdHeat, lang]);

  const hazards = useMemo(() => (feed?.hazards ?? []).filter(h => h.type !== "ice"), [feed]);
  const whenTest = WHEN.find(w => w.id === whenFilter)!.test;
  const visible = useMemo(() => hazards.filter(h => active.has(h.type) && whenTest(h) && (!alertsOnly || h.severity === "red" || h.severity === "orange")), [hazards, active, alertsOnly, whenTest]);
  const selectedHazard = hazards.find(h => h.id === selected) ?? null;

  // Hazard markers, measured footprints (or approximate zones), observed tracks and forecasts
  useEffect(() => {
    const Lf = lRef.current, g = groups.current.hazards;
    if (!ready || !Lf || !g) return;
    g.clearLayers();
    for (const h of visible) {
      const meta = HAZARD_META[h.type], sev = SEVERITY_META[h.severity], isSel = h.id === selected;
      // Forecast: uncertainty cone, predicted wind zones (selected only), and the predicted track with times.
      if (h.cone) Lf.polygon(latLngs(h.cone), { color: "#ffffff", weight: 1, opacity: isSel ? 0.8 : 0.45, dashArray: "3 6", fillColor: meta.color, fillOpacity: isSel ? 0.1 : 0.04, interactive: false }).addTo(g);
      if (isSel) for (const z of h.forecastZones ?? []) Lf.polygon(latLngs(z.geometry), { stroke: false, fillColor: SEVERITY_META[z.level].color, fillOpacity: 0.08, interactive: false }).addTo(g);
      if (h.forecast?.length) {
        Lf.polyline([[h.lat, h.lon], ...h.forecast.map(p => [p.lat, p.lon] as [number, number])], { color: "#ffffff", weight: 2, opacity: 0.85, dashArray: "6 7", interactive: false }).addTo(g);
        for (const p of h.forecast)
          Lf.circleMarker([p.lat, p.lon], { radius: isSel ? 5 : 3.5, color: "#ffffff", weight: 1.5, fillColor: meta.color, fillOpacity: 1 })
            .bindTooltip(`<b>${escapeHtml(h.title)}</b><br>${t("Forecast position")} · ${escapeHtml(wh(p.time))} (${tu(p.time)})`, { direction: "top" })
            .addTo(g);
      }
      if (h.track) Lf.polyline(h.track, { color: meta.color, weight: 2.5, opacity: 0.85, interactive: false }).addTo(g);
      // Now: the agency's measured footprint when published, otherwise an approximate radius.
      if (h.zones?.length) {
        for (const z of [...h.zones].sort((a, b) => SEVERITY_META[a.level].rank - SEVERITY_META[b.level].rank))
          Lf.polygon(latLngs(z.geometry), { color: SEVERITY_META[z.level].color, weight: isSel ? 2 : 1, opacity: 0.9, fillColor: h.type === "flood" ? meta.color : SEVERITY_META[z.level].color, fillOpacity: isSel ? 0.3 : 0.18, interactive: false }).addTo(g);
      } else {
        Lf.circle([h.lat, h.lon], { radius: h.radiusKm * 1000, color: sev.color, weight: isSel ? 2 : 1, opacity: isSel ? 0.95 : 0.5, dashArray: "2 5", fillColor: meta.color, fillOpacity: isSel ? 0.16 : 0.05, interactive: false }).addTo(g);
      }
      const icon = Lf.divIcon({ className: "", html: `<div class="hz-pin hz-${h.severity}${isSel ? " is-selected" : ""}${h.phase === "new" ? " is-new" : ""}" style="--c:${meta.color}"><span>${meta.icon}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
      Lf.marker([h.lat, h.lon], { icon, keyboard: true, title: h.title, zIndexOffset: sev.rank * 100 + (isSel ? 1000 : 0) })
        .bindTooltip(`<b>${escapeHtml(h.title)}</b><br>${t(meta.label)} · ${t(sev.label)} · ${h.phase === "new" ? t("new (24 h)") : t("ongoing")}<br>${t("Position at {time}", { time: escapeHtml(wh(h.date)) })}`, { direction: "top", offset: [0, -14] })
        .on("click", () => { setSelected(h.id); setTab("events"); })
        .addTo(g);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, visible, selected, lang]);

  useEffect(() => {
    if (!selectedHazard || !mapRef.current) return;
    const h = selectedHazard, Lf = lRef.current;
    // Frame the whole story: footprint, observed track and forecast path.
    const pts: [number, number][] = [[h.lat, h.lon], ...(h.forecast ?? []).map(p => [p.lat, p.lon] as [number, number]), ...(h.track ?? []).slice(-6)];
    for (const z of h.zones ?? []) for (const poly of latLngs(z.geometry)) pts.push(...poly[0]);
    if (Lf && pts.length > 2) { mapRef.current.flyToBounds(Lf.latLngBounds(pts).pad(0.15), { maxZoom: 8, duration: 1.1 }); return; }
    const r = h.radiusKm;
    mapRef.current.flyTo([h.lat, h.lon], r > 250 ? 5 : r > 80 ? 6 : r > 25 ? 7 : 8, { duration: 1.1 });
  }, [selectedHazard]);

  // Safety check
  const assessment = useMemo(() => (me ? assessSafety(me.lat, me.lon, hazards) : null), [me, hazards]);

  useEffect(() => {
    if (!me) return;
    const controller = new AbortController();
    const run = async () => {
      setSafeLoading(true);
      setSafeError(null);
      setSafe(null);
      try {
        for (const radius of [12, 25]) {
          const r = await fetch(`/api/safe-places?lat=${me.lat.toFixed(5)}&lon=${me.lon.toFixed(5)}&radius=${radius}`, { signal: controller.signal });
          const j = (await r.json()) as { places: SafePlace[]; error?: string };
          if (!r.ok) throw new Error(j.error);
          const outside = j.places.filter(p => !isInsideAnyZone(p.lat, p.lon, hazards));
          setSafe({ places: j.places, radiusKm: radius });
          if (outside.length >= 3) break;
        }
      } catch (e) {
        if (!controller.signal.aborted) setSafeError(e instanceof Error && e.message ? e.message : t("Facility search failed."));
      } finally {
        if (!controller.signal.aborted) setSafeLoading(false);
      }
    };
    queueMicrotask(run);
    return () => controller.abort();
    // hazards are read once per location; the list re-filters below when the feed refreshes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  const ranked: RankedPlace[] = useMemo(() => {
    if (!me || !safe) return [];
    return safe.places
      .filter(p => !isInsideAnyZone(p.lat, p.lon, hazards))
      .map(p => ({ ...p, distanceKm: distanceKm(me.lat, me.lon, p.lat, p.lon) }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 12);
  }, [me, safe, hazards]);
  const unsafeCount = safe ? safe.places.length - safe.places.filter(p => !isInsideAnyZone(p.lat, p.lon, hazards)).length : 0;

  useEffect(() => {
    const Lf = lRef.current, g = groups.current.me, map = mapRef.current;
    if (!ready || !Lf || !g || !map) return;
    g.clearLayers();
    if (!me) return;
    const level = assessment?.level ?? "clear";
    const best = ranked[0];
    if (best) Lf.polyline([[me.lat, me.lon], [best.lat, best.lon]], { color: "#32a6ff", weight: 3, dashArray: "2 8", lineCap: "round", interactive: false }).addTo(g);
    for (const p of ranked) {
      const meta = SAFE_PLACE_META[p.kind];
      Lf.marker([p.lat, p.lon], { icon: Lf.divIcon({ className: "", html: `<div class="safe-pin${p === best ? " is-best" : ""}" style="--c:${meta.color}"><span>${meta.icon}</span></div>`, iconSize: [26, 26], iconAnchor: [13, 13] }), zIndexOffset: 2000 })
        .bindTooltip(`<b>${escapeHtml(p.name)}</b><br>${t(meta.label)} · ${kmL(p.distanceKm)} · ${t("outside hazard zones")}`, { direction: "top", offset: [0, -12] })
        .addTo(g);
    }
    Lf.marker([me.lat, me.lon], { icon: Lf.divIcon({ className: "", html: `<div class="me-pin me-${level}"><i></i></div>`, iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 3000 })
      .bindTooltip(escapeHtml(me.label), { direction: "top", offset: [0, -10] })
      .addTo(g);
    const pts: [number, number][] = [[me.lat, me.lon], ...ranked.slice(0, 5).map(p => [p.lat, p.lon] as [number, number])];
    if (pts.length > 1) map.fitBounds(Lf.latLngBounds(pts).pad(0.35), { maxZoom: 15 });
    else map.setView([me.lat, me.lon], Math.max(map.getZoom(), 11));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, me, ranked, assessment, lang]);

  const applyApproximate = async (because?: LocateFailure) => {
    setLocating("ip");
    try {
      const l = await locateApproximately();
      setMe({ lat: l.lat, lon: l.lon, label: l.label, accuracyM: l.accuracyM, source: "ip" });
      setGeoFail(because ?? null);
      setTab("safety");
    } catch (e) {
      setGeoError(e instanceof Error ? e.message : t("Approximate location is unavailable."));
    } finally { setLocating(null); }
  };
  const locate = async () => {
    setGeoError(null); setGeoFail(null); setLocating("browser");
    try {
      const l = await locateWithBrowser();
      setMe({ lat: l.lat, lon: l.lon, label: l.label, accuracyM: l.accuracyM, source: l.source });
      setTab("safety");
      setLocating(null);
    } catch (e) {
      const reason = e instanceof LocateError ? e.reason : "unavailable";
      setGeoFail(reason);
      setLocating(null);
      // The device simply couldn't locate itself: fall back to city-level location automatically.
      // If the user denied permission, respect that and only offer the fallback.
      if (reason !== "denied") await applyApproximate(reason);
    }
  };
  // Place search (Open-Meteo / GeoNames via EarthScope's /api/places), debounced.
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { queueMicrotask(() => setSearchResults([])); return; }
    const controller = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`/api/places?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        const j = (await r.json()) as { results?: SearchPlace[] };
        setSearchResults((j.results ?? []).slice(0, 5));
      } catch { /* aborted or offline */ } finally { if (!controller.signal.aborted) setSearching(false); }
    }, 350);
    return () => { clearTimeout(t); controller.abort(); };
  }, [search]);
  const toggleType = (t: HazardType) => setActive(s => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; });

  const counts = useMemo(() => {
    const c = new Map<HazardType, number>();
    for (const h of hazards) c.set(h.type, (c.get(h.type) ?? 0) + 1);
    return c;
  }, [hazards]);
  const reds = hazards.filter(h => h.severity === "red").length, oranges = hazards.filter(h => h.severity === "orange").length;
  const newCount = hazards.filter(h => h.phase === "new").length, forecastCount = hazards.filter(h => h.forecast?.length).length;
  const topThreat = assessment?.threats[0];
  const exitKm = topThreat?.inside && me ? exitDistance(topThreat.hazard, me.lat, me.lon) : 0;
  // Dangerous heat raises a "clear" location to "caution" (heat is not a zone you can leave).
  const statusLevel = assessment ? (assessment.level === "clear" && (heatAtMe || (!!aqAtMe && aqiCategory(aqAtMe.peakAqi).rank >= 3)) ? "caution" : assessment.level) : "clear";
  const unhealthyAir = !!aqAtMe && aqiCategory(aqAtMe.peakAqi).rank >= 3;
  const statusText = !assessment ? "" : assessment.level === "danger" ? t("Inside an active hazard zone") : topThreat?.upcoming ? t("In the forecast path — {when}", { when: tu(topThreat.upcoming.eta) }) : assessment.level === "caution" ? t("Close to an active hazard") : heatAtMe ? t("Dangerous heat forecast here") : unhealthyAir ? t("Unhealthy air forecast here") : t("No current or forecast hazard here");
  // The latest safety check, kept on the device for offline use (see MyPlaces).
  const pack = useMemo<SafetyPack | null>(() => {
    // Wait for the shelter search to finish (or fail) so the saved pack is complete.
    if (!me || !assessment || safeLoading || (!safe && !safeError)) return null;
    const guidance = (topThreat ? GUIDANCE[topThreat.hazard.type] : heatAtMe ? GUIDANCE.heat : ["Keep a charged phone, water, medicines and documents ready.", "Know your nearest shelter and how to reach it on foot.", "Follow official warnings from BMD and DDM."]).map(g => t(g));
    return {
      savedAt: new Date().toISOString(), label: me.label, lat: me.lat, lon: me.lon, status: statusText,
      threats: assessment.threats.slice(0, 4).map(th => `${th.hazard.title} — ${th.inside ? t("you are inside its zone") : th.upcoming ? t("forecast to pass {when}", { when: tu(th.upcoming.eta) }) : t("{n} km away", { n: Math.round(th.distanceKm) })}`),
      heat: heatSummary ?? undefined,
      shelters: ranked.slice(0, 8).map(p => ({ name: p.name, kind: t(SAFE_PLACE_META[p.kind].label), distanceKm: p.distanceKm })),
      guidance,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, assessment, safeLoading, safe, safeError, topThreat, heatAtMe, heatSummary, ranked, statusText]);

  return (
    <section className="hz-wrap">
      <div className="hz-stats">
        <div className="hz-stat hz-live"><span className="live-dot" /> <div><strong>{loading && !feed ? "…" : y(hazards.length)}</strong><small>{t("happening now · {n} new in 24 h", { n: y(newCount) })}</small></div></div>
        <div className="hz-stat"><Siren size={18} color="#ff5a4f" /><div><strong>{y(reds)} · {y(oranges)}</strong><small>{t("red · orange alerts now")}</small></div></div>
        <div className="hz-stat"><TriangleAlert size={18} color="#8fb8ff" /><div><strong>{y(forecastCount)}</strong><small>{t("with forecast track")}</small></div></div>
        <div className="hz-stat hz-feeds">
          {(feed?.feeds ?? [{ name: "NASA EONET", ok: true, count: 0 }, { name: "GDACS", ok: true, count: 0 }, { name: "USGS", ok: true, count: 0 }]).map(f => (
            <span key={f.name} className={f.ok ? "ok" : "down"} title={f.ok ? t("{n} events", { n: f.count }) : t("Feed unreachable")}>{f.name}</span>
          ))}
          <button onClick={load} disabled={loading} aria-label={t("Refresh live feeds")}>{loading ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}</button>
          <small>{feed ? t("Updated {time}", { time: new Date(feed.updated).toLocaleTimeString(lang === "bn" ? "bn-BD" : [], { hour: "2-digit", minute: "2-digit" }) }) : t("Connecting…")}</small>
        </div>
      </div>

      <div className="hz-grid">
        <div className="hz-map-card">
          <div ref={el} className="hz-map" role="application" aria-label={t("Live natural hazard map")} />
          <div className="map-toolbar">
            <button className={showFires ? "on" : ""} onClick={() => setShowFires(v => !v)}><Flame size={14} /> {t("VIIRS fires")}</button>
            <button className={showRain ? "on" : ""} onClick={() => setShowRain(v => !v)}><CloudRain size={14} /> {t("GPM rain")}</button>
            <button className={showFlood ? "on" : ""} onClick={() => setShowFlood(v => !v)}><Waves size={14} /> {t("NASA flood map")}</button>
            <button className={showPop ? "on" : ""} onClick={() => setShowPop(v => !v)}><Users size={14} /> {t("Population")}</button>
            <button className={showAod ? "on" : ""} onClick={() => setShowAod(v => !v)}><Wind size={14} /> {t("NASA aerosols")}</button>
            <button className={showHeat ? "on" : ""} onClick={() => setShowHeat(v => !v)}><Thermometer size={14} /> {t("BD heat watch")}</button>
          </div>
          {showFlood && <div className="flood-panel">
            <div className="seg">{([1, 2, 3] as const).map(d => <button key={d} className={floodDays === d ? "on" : ""} onClick={() => setFloodDays(d)}>{t("{n}-day", { n: y(d) })}</button>)}</div>
            <div className="seg">{(["flood", "all"] as const).map(m => <button key={m} className={floodMode === m ? "on" : ""} onClick={() => setFloodMode(m)}>{m === "flood" ? t("Floods only") : t("All water")}</button>)}</div>
            <label className="hz-check"><input type="checkbox" checked={showGaps} onChange={e => setShowGaps(e.target.checked)} /> {t("Cloud gaps")}</label>
            <div className="flood-legend">{FLOOD_LEGEND.filter(l => (floodMode === "all" || l.cls === "flood" || l.cls === "recurring" || (showGaps && l.cls === "nodata")) && (l.cls !== "nodata" || showGaps)).map(l => <span key={l.cls}><i style={{ background: l.color }} />{t(l.label)}</span>)}</div>
            <small>{t("NASA LANCE MODIS flood product · {n}-day composite to yesterday. Monsoon cloud hides some areas.", { n: y(floodDays) })}</small>
          </div>}
          {picking && <div className="pick-banner"><Crosshair size={15} /> {t("Click anywhere on the map to check that spot")} <button onClick={() => setPicking(false)}>{t("Cancel")}</button></div>}
          <div className="map-legend hz-legend">
            {(["red", "orange", "green", "info"] as const).map(s => <span key={s}><i style={{ background: SEVERITY_META[s].color }} />{t(SEVERITY_META[s].label)}</span>)}
            <span><i className="zone" />{t("Measured footprint")}</span>
            <span><i className="ring" />{t("Approx. zone")}</span>
            <span><i className="fc" />{t("Forecast track & cone")}</span>
          </div>
          {error && !feed && <div className="map-error"><TriangleAlert size={18} /> {error} <button onClick={load}>{t("Retry")}</button></div>}
        </div>

        <aside className="hz-panel">
          <div className="hz-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "events"} className={tab === "events" ? "on" : ""} onClick={() => setTab("events")}>{t("Live events")}</button>
            <button role="tab" aria-selected={tab === "safety"} className={tab === "safety" ? "on" : ""} onClick={() => setTab("safety")}><ShieldCheck size={14} /> {t("Am I safe?")}</button>
          </div>

          {tab === "events" && <>
            {showHeat && bdHeat && <details className="bd-heat" open={bdHeat.some(o => heatAlert(worstHeat(o)))}>
              <summary><Thermometer size={13} /> {t("Bangladesh heat watch")} <small>{(() => { const w = bdHeat.map(o => worstHeat(o)).reduce((a, b) => (b.heatIndexMax > a.heatIndexMax ? b : a)); return t("next 3 days: {level}, heat index up to {v} °C", { level: t(HEAT_META[w.level].label).toLowerCase(), v: y(Math.round(w.heatIndexMax)) }); })()}</small></summary>
              {bdHeat.map(o => <div key={o.name} className="bd-heat-row"><span>{o.name}</span><HeatStrip outlook={o} compact /></div>)}
              <p className="impact-source">{t("Heat index (feels-like with humidity), daily max · Open-Meteo forecast · NWS / BMD thresholds")}</p>
            </details>}
            <div className="hz-when" role="tablist" aria-label={t("Time filter")}>
              {WHEN.map(w => <button key={w.id} role="tab" aria-selected={whenFilter === w.id} className={whenFilter === w.id ? "on" : ""} onClick={() => setWhenFilter(w.id)}>{t(w.label)}<b>{y(hazards.filter(w.test).length)}</b></button>)}
            </div>
            <div className="hz-filters">
              {TYPES.filter(ty => counts.get(ty)).map(ty => (
                <button key={ty} className={active.has(ty) ? "on" : ""} style={{ "--c": HAZARD_META[ty].color } as React.CSSProperties} onClick={() => toggleType(ty)}>
                  <span>{HAZARD_META[ty].icon}</span>{t(HAZARD_META[ty].label)}<b>{y(counts.get(ty) ?? 0)}</b>
                </button>
              ))}
              <label className="hz-check"><input type="checkbox" checked={alertsOnly} onChange={e => setAlertsOnly(e.target.checked)} /> {t("Orange & red alerts only")}</label>
            </div>

            {selectedHazard && (
              <article className="hz-detail" style={{ "--c": HAZARD_META[selectedHazard.type].color } as React.CSSProperties}>
                <div className="hz-detail-top"><span className="hz-icon">{HAZARD_META[selectedHazard.type].icon}</span><span className={`sev-badge sev-${selectedHazard.severity}`}>{t(SEVERITY_META[selectedHazard.severity].label)}</span><button onClick={() => setSelected(null)} aria-label={t("Close details")}>×</button></div>
                <h3>{selectedHazard.title}</h3>
                <p>{t(HAZARD_META[selectedHazard.type].label)}{selectedHazard.country ? ` · ${selectedHazard.country}` : ""} · <span className={`phase-badge ph-${selectedHazard.phase}`}>{selectedHazard.phase === "new" ? t("New · 24 h") : t("Ongoing")}</span></p>
                <p className="hz-detail-line">{t("Position")} <strong>{selectedHazard.lat.toFixed(2)}°, {selectedHazard.lon.toFixed(2)}°</strong> {t("observed {time}", { time: wh(selectedHazard.date) })} ({ta(selectedHazard.date)})</p>
                {selectedHazard.started && selectedHazard.type !== "earthquake" && <p className="hz-detail-line">{t("Began {time}", { time: wh(selectedHazard.started) })}</p>}
                {selectedHazard.detail && <p className="hz-detail-line">{selectedHazard.detail}</p>}
                <p className="hz-detail-line">{selectedHazard.zones?.length ? <>{t("Footprint:")} <strong>{selectedHazard.type === "flood" ? t("mapped flooded area") : t("measured wind zones")}</strong> (GDACS)</> : <>{t("Approximate impact zone:")} <strong>{t("{n} km radius", { n: y(selectedHazard.radiusKm) })}</strong></>}</p>
                <EventImpact id={selectedHazard.id} />
                {!!selectedHazard.forecast?.length && <div className="hz-forecast">
                  <h4>{t("Forecast track")}</h4>
                  {selectedHazard.forecast.slice(0, 8).map(p => <div key={p.time}><span>{wh(p.time)}</span><em>{tu(p.time)}</em><b>{p.lat.toFixed(1)}°, {p.lon.toFixed(1)}°</b></div>)}
                </div>}
                <div className="hz-sources">{selectedHazard.sources.map(s => s.url ? <a key={s.name} href={s.url} target="_blank" rel="noreferrer">{s.name} <ExternalLink size={11} /></a> : <span key={s.name}>{s.name}</span>)}</div>
                {inBangladeshRegion(selectedHazard.lat, selectedHazard.lon) && <BangladeshOfficial />}
                <button className="lime-button" onClick={() => { setMe({ lat: selectedHazard.lat, lon: selectedHazard.lon, label: t("Near {name}", { name: selectedHazard.title }) }); setTab("safety"); }}><ShieldCheck size={15} /> {t("Find safe places near this event")}</button>
              </article>
            )}

            <div className="hz-list">
              {!visible.length && <p className="hz-empty">{loading ? t("Loading live events…") : t("No events match these filters.")}</p>}
              {visible.slice(0, 150).map(h => (
                <button key={h.id} className={`hz-item${h.id === selected ? " on" : ""}`} onClick={() => setSelected(h.id)}>
                  <span className="hz-icon" style={{ "--c": HAZARD_META[h.type].color } as React.CSSProperties}>{HAZARD_META[h.type].icon}</span>
                  <span className="hz-item-body"><strong>{h.title}</strong><small><span className={`phase-badge ph-${h.phase}`}>{h.phase === "new" ? t("New") : t("Ongoing")}</span>{h.forecast?.length ? <span className="phase-badge ph-fc">{t("Forecast")}</span> : null} {t(HAZARD_META[h.type].label)} · {t("updated {ago}", { ago: ta(h.date) })}{me ? ` · ${t("{d} away", { d: kmL(distanceKm(me.lat, me.lon, h.lat, h.lon)) })}` : ""}</small></span>
                  <i className={`sev-dot sev-${h.severity}`} title={t(SEVERITY_META[h.severity].label)} />
                </button>
              ))}
            </div>
          </>}

          {tab === "safety" && <div className="safety">
            <MyPlaces hazards={hazards} feedReady={!!feed} me={me} pack={pack} onCheck={p => setMe({ lat: p.lat, lon: p.lon, label: p.name })} />
            <p className="safety-intro">{t("Check a location against every active event, then find emergency facilities that sit outside the hazard zones.")}</p>
            <div className="safety-actions">
              <button className="lime-button" onClick={locate} disabled={!!locating}>{locating ? <LoaderCircle className="spin" size={15} /> : <LocateFixed size={15} />} {locating === "browser" ? t("Finding your location…") : locating === "ip" ? t("Using approximate location…") : t("Use my location")}</button>
              <button className="outline-button" onClick={() => { setGeoFail(null); setMe({ lat: place.lat, lon: place.lon, label: `${place.name}, ${place.country}`, source: "place" }); }}><MapPin size={15} /> {place.name}</button>
              <button className={`outline-button${picking ? " on" : ""}`} onClick={() => setPicking(p => !p)}><Crosshair size={15} /> {t("Pick on map")}</button>
            </div>
            <div className="loc-search">
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("…or type your area, town or district")} aria-label={t("Search for a place to check")} />
              {searching && <LoaderCircle className="spin" size={14} />}
              {!!searchResults.length && <ul>{searchResults.map(r => (
                <li key={r.id}><button onClick={() => { setMe({ lat: r.lat, lon: r.lon, label: `${r.name}, ${r.country}`, source: "search" }); setSearch(""); setSearchResults([]); setGeoFail(null); }}>
                  <MapPin size={12} /> {r.name}<small>{[r.region, r.country].filter(Boolean).join(", ")}</small></button></li>))}</ul>}
            </div>
            {geoFail && (
              <div className={`locate-help${me?.source === "ip" ? " soft" : ""}`}>
                <strong>{t(LOCATE_HELP[geoFail].title)}</strong>
                {me?.source === "ip" ? <p>{t("Using your approximate, city-level location instead — for a precise check, pick your exact spot on the map or search your area.")}</p> : <p>{t(LOCATE_HELP[geoFail].fix)}</p>}
                <div>
                  {me?.source !== "ip" && <button className="outline-button" onClick={() => applyApproximate(geoFail)} disabled={!!locating}>{t("Use approximate location")}</button>}
                  {geoFail !== "insecure" && geoFail !== "unsupported" && <button className="outline-button" onClick={locate} disabled={!!locating}>{t("Try again")}</button>}
                  {geoFail === "blocked-frame" && <a className="outline-button" href={typeof window === "undefined" ? "/" : window.location.href} target="_blank" rel="noreferrer">{t("Open in new tab")}</a>}
                </div>
              </div>
            )}
            {geoError && <p className="safety-error">{geoError}</p>}

            {me && assessment && <>
              <div className={`safety-status s-${statusLevel}`}>
                {statusLevel === "danger" ? <Siren size={24} /> : statusLevel === "caution" ? <TriangleAlert size={24} /> : <ShieldCheck size={24} />}
                <div>
                  <strong>{statusText}</strong>
                  <small>{me.label} · {me.lat.toFixed(3)}, {me.lon.toFixed(3)}{me.source === "ip" ? ` · ${t("approximate (city-level, ±25 km)")}` : me.accuracyM ? ` · ${t("accurate to ±{d}", { d: me.accuracyM >= 1000 ? `${(me.accuracyM / 1000).toFixed(1)} km` : `${me.accuracyM} m` })}` : ""}</small>
                </div>
              </div>

              {topThreat?.inside && (
                <div className="exit-hint"><Navigation size={16} style={{ transform: "rotate(0deg)" }} /><p>{t("Nearest way out of the {hazard} zone: about {d} toward the {dir}.", { hazard: t(HAZARD_META[topThreat.hazard.type].label).toLowerCase(), d: kmL(exitKm), dir: t(topThreat.awayDirection) })} {topThreat.hazard.type === "flood" || topThreat.hazard.type === "storm" ? t("Higher ground and a sturdy shelter matter more than distance.") : ""}</p></div>
              )}

              {assessment.threats.length > 0 && <div className="threats">
                {assessment.threats.slice(0, 4).map(th => (
                  <button key={th.hazard.id} className="threat" onClick={() => { setSelected(th.hazard.id); setTab("events"); }}>
                    <span className="hz-icon" style={{ "--c": HAZARD_META[th.hazard.type].color } as React.CSSProperties}>{HAZARD_META[th.hazard.type].icon}</span>
                    <span><strong>{th.hazard.title}</strong><small>{t("{d} from its centre", { d: kmL(th.distanceKm) })} · {th.inside ? t("you are inside the current zone") : th.upcoming ? t("forecast to pass {when} ({time})", { when: tu(th.upcoming.eta), time: wh(th.upcoming.eta) }) : t("outside, but close")}</small></span>
                    <i className={`sev-dot sev-${th.hazard.severity}`} />
                  </button>
                ))}
              </div>}

              <AirQualityCard key={`aq-${me.lat},${me.lon}`} lat={me.lat} lon={me.lon} onData={setAqAtMe} />
              <HeatOutlookCard key={`${me.lat},${me.lon}`} lat={me.lat} lon={me.lon} label={me.label.split(",")[0]} onAlert={(a, summary) => { setHeatAtMe(a); setHeatSummary(summary); }} />
              {inBangladeshRegion(me.lat, me.lon) && <BangladeshOfficial />}
              {topThreat && <div className="guidance"><h4>{t("What to do now — {hazard}", { hazard: t(HAZARD_META[topThreat.hazard.type].label).toLowerCase() })}</h4><ul>{GUIDANCE[topThreat.hazard.type].map(g => <li key={g}>{t(g)}</li>)}</ul></div>}

              <div className="safe-list">
                <h4>{t("Safer places nearby")} {safe && <small>{t("within {n} km · outside all zones", { n: y(safe.radiusKm) })}</small>}</h4>
                {safeLoading && <p className="hz-empty"><LoaderCircle className="spin" size={14} /> {t("Searching OpenStreetMap for shelters, hospitals and assembly points…")}</p>}
                {safeError && <p className="safety-error">{safeError}</p>}
                {!safeLoading && safe && !ranked.length && <p className="hz-empty">{t("No mapped emergency facilities were found outside hazard zones nearby. Follow directions from local authorities.")}</p>}
                {ranked.map((p, i) => (
                  <div key={p.id} className={`safe-item${i === 0 ? " best" : ""}`}>
                    <span className="safe-icon" style={{ "--c": SAFE_PLACE_META[p.kind].color } as React.CSSProperties}>{SAFE_PLACE_META[p.kind].icon}</span>
                    <span className="safe-body"><strong>{p.name}</strong><small>{t(SAFE_PLACE_META[p.kind].label)} · {kmL(p.distanceKm)}{i === 0 ? ` · ${t("closest safe option")}` : ""}</small></span>
                    <a href={routeUrl(me, p)} target="_blank" rel="noreferrer" aria-label={t("Walking route to {name}", { name: p.name })}>{t("Route")} <ExternalLink size={11} /></a>
                  </div>
                ))}
                {unsafeCount > 0 && <p className="hz-note">{unsafeCount === 1 ? t("1 nearby facility is hidden because it lies inside a hazard zone.") : t("{n} nearby facilities are hidden because they lie inside a hazard zone.", { n: y(unsafeCount) })}</p>}
              </div>
            </>}

            {!me && <div className="safety-empty"><ShieldCheck size={36} strokeWidth={1.2} /><p>{t("Choose a location to see nearby threats, protective actions and the closest shelters outside the danger zones.")}</p></div>}
            <p className="hz-note">{t("Emergency: call your local number — Bangladesh 999 · India / EU 112 · USA 911. Your location is only used to run this check.")}</p>
          </div>}
        </aside>
      </div>

      <p className="hz-disclaimer"><TriangleAlert size={14} /> {t("EarthScope is an educational tool, not an official warning system. Impact zones are simple distance estimates from event severity, and facility data comes from OpenStreetMap volunteers. Always follow your national disaster management authority and local emergency services.")}</p>
    </section>
  );
}
