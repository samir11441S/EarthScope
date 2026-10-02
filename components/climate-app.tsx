"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, ArrowUpRight, BookOpen, ChevronRight, CircleHelp, CloudRain, Compass, Download, Earth, ExternalLink, FileText, FlaskConical, Globe2, History, Layers3, Leaf, LoaderCircle, MapPin, Maximize2, Pause, Play, Plus, Radar, Search, ShieldCheck, Siren, Sparkles, Sprout, Thermometer, Trash2, TrendingUp, Waves } from "lucide-react";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RangeControl as Slider } from "@/components/range-control";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toaster, toast } from "sonner";
import EarthGlobe from "./earth-globe";
import DisasterMap from "./disaster-map";
import ClimateAtlas from "./climate-atlas";
import SatelliteComparison from "./satellite-compare";
import AskEarth from "./ask-earth";
import ClimateReport, { type ReportRequest } from "./climate-report";
import type { Audience, Lang, ReportInputs } from "@/lib/report/model";
import { parseShare, type SharedReport } from "@/lib/report/share";
import { PLACES, RECORD_END, RECORD_START, SCENARIO_END, calculateAnomalies, calculateTrend, climateStory, demoClimate, homogeneity, imageUrl, observation, parsePower, periodDelta, periodLabels, signed, trendSummary, trendVerdict, type ClimateData, type Layer, type Place } from "@/lib/climate";
import dhakaPower from "@/lib/dhaka-power.json";

type View = "explore" | "disasters" | "atlas" | "satellite" | "future" | "compare" | "reports";
type Report = { id: string; place: Place; year: number; warming: number; rainChange: number; created: string; data: ClimateData; inputs?: ReportInputs; lang?: Lang; audience?: Audience };
const INITIAL = parsePower(dhakaPower);
const CACHE = new Map<string, ClimateData>([["dhaka", INITIAL]]);
const LAYERS: Layer[] = ["Natural color", "Temperature", "Rainfall", "Vegetation", "Flood exposure"];
const NAV: { id: View; title: string; icon: typeof Compass; badge?: string }[] = [{ id: "explore", title: "Earth explorer", icon: Compass }, { id: "disasters", title: "Live disasters", icon: Siren, badge: "LIVE" }, { id: "atlas", title: "Climate atlas", icon: Earth, badge: "MAPS" }, { id: "satellite", title: "Satellite comparison", icon: Layers3 }, { id: "future", title: "Future scenarios", icon: FlaskConical, badge: "LAB" }, { id: "compare", title: "Compare places", icon: Globe2 }, { id: "reports", title: "My climate reports", icon: FileText }];

const HEADINGS: Record<View, [string, string]> = {
  explore: ["Every place has a climate story.", "Travel through time. Understand your world. Imagine what comes next."],
  disasters: ["The planet, right now.", "Live storms, floods, earthquakes and fires from NASA, GDACS and USGS — and the safer places around you."],
  atlas: ["Every country. Every state. Every year.", "Zoom from the whole Earth into a country and its states, and watch 26 years of NASA climate data unfold."],
  satellite: ["See change with your own eyes.", "Two moments in time. A new perspective on the place you call home."],
  future: ["The future is a possibility.", "Change the assumptions. Explore what they could mean for your community."],
  compare: ["Different places. One planet.", "Put two climate histories side by side to see the bigger picture."],
  reports: ["Your planet, on the record.", "Keep your discoveries close. Saved reports stay in this browser."],
};

/** Decorative planet horizon behind every page heading, painted from NASA's own globe textures. */
function HeroSky({ view }: { view: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Lower the horizon just enough that the planet's limb passes below/right of every heading line,
  // whatever the page title length or screen width.
  useEffect(() => {
    const sky = ref.current, heading = sky?.parentElement?.querySelector(".page-heading");
    if (!sky || !heading) return;
    const place = () => {
      const planet = sky.querySelector<HTMLElement>(".hero-planet");
      if (!planet) return;
      sky.style.removeProperty("--hero-top");
      const R = planet.offsetWidth / 2, cx = planet.offsetLeft + R, preferred = planet.offsetTop, box = sky.getBoundingClientRect();
      let needed = -Infinity;
      for (const el of heading.querySelectorAll("h1, p, .eyebrow")) {
        const range = document.createRange();
        range.selectNodeContents(el);
        for (const r of range.getClientRects()) {
          const x = r.right - box.left + 28, y = r.bottom - box.top + 16, dx = Math.abs(cx - x);
          if (dx < R) needed = Math.max(needed, y - (R - Math.sqrt(R * R - dx * dx)));
        }
      }
      sky.style.setProperty("--hero-top", `${Math.round(Math.min(300, Math.max(preferred, needed)))}px`);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(heading);
    ro.observe(sky);
    document.fonts?.ready.then(place).catch(() => {});
    return () => ro.disconnect();
  }, [view]);
  return <div ref={ref} className="hero-sky" aria-hidden="true">
    <div className="hero-stars"/>
    <div className="hero-planet"><div className="hero-night"/><div className="hero-day"/><div className="hero-clouds"/><div className="hero-rim"/></div>
    <div className="hero-flare"/>
  </div>;
}

/** Headline with its last two words in the EarthScope blue gradient. */
function headline(text: string) {
  const words = text.split(" "), tail = words.splice(-2).join(" ");
  return <>{words.join(" ")} <span className="h1-accent">{tail}</span></>;
}

export function PlacePicker({ place, onChange, label = "Search any city or region" }: { place: Place; onChange: (p: Place) => void; label?: string }) {
  const [query, setQuery] = useState(""), [remote, setRemote] = useState<Place[]>([]), [busy, setBusy] = useState(false), [searchError, setSearchError] = useState(false);
  useEffect(() => {
    if (query.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true);
      setSearchError(false);
      try {
        const r = await fetch(`/api/places?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!r.ok) throw new Error();
        const data = await r.json() as { results: Place[] };
        setRemote(data.results || []);
      } catch {
        if (!controller.signal.aborted) setSearchError(true);
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  const options = useMemo(() => {
    const local = PLACES.filter(p => `${p.name} ${p.country} ${p.region || ""}`.toLowerCase().includes(query.toLowerCase()));
    return [...local, ...remote.filter(p => !local.some(c=>c.name===p.name && c.country===p.country))];
  }, [query, remote]);
  return <div className="location-search"><Search size={17}/><Combobox items={options} value={place} onValueChange={p => { if (p) { onChange(p); setQuery(""); setRemote([]); } }} onInputValueChange={q => { setQuery(q); if (q.length < 2) { setRemote([]); setSearchError(false); setBusy(false); } }} itemToStringLabel={(p: Place)=>`${p.name}, ${p.country}`} isItemEqualToValue={(a: Place,b: Place)=>a.id===b.id} filter={null}>
    <ComboboxInput aria-label={label} placeholder={label} className="place-combobox"/>
    <ComboboxContent className="place-results"><div className="picker-heading">{query ? "SEARCH RESULTS" : "EXPLORE A PLACE"}</div><ComboboxEmpty>{busy ? "Searching the planet…" : searchError ? "Search unavailable. Try one of the featured cities." : "No locations found. Try a nearby city."}</ComboboxEmpty><ComboboxList>{(p: Place)=><ComboboxItem key={p.id} value={p}><MapPin size={16}/><span>{p.name}<small>{p.region ? `${p.region}, ` : ""}{p.country}</small></span></ComboboxItem>}</ComboboxList><div className="picker-credit">Places by Open-Meteo / GeoNames</div></ComboboxContent>
  </Combobox></div>;
}

/**
 * Scrolls to the top once no dialog/drawer holds the page's scroll lock. The mobile menu (a Radix
 * sheet) restores the old scroll position when it finishes closing, so scrolling earlier would be undone.
 */
function scrollToTopWhenUnlocked(deadline = Date.now() + 1200) {
  const locked = document.body.hasAttribute("data-scroll-locked") || document.querySelector("[data-slot=sheet-content][data-state]");
  if (locked && Date.now() < deadline) { requestAnimationFrame(() => scrollToTopWhenUnlocked(deadline)); return; }
  window.scrollTo({ top: 0, behavior: locked ? "auto" : "smooth" });
}

function AppNav({ view, navigate, onData }: { view: View; navigate: (v: View)=>void; onData: ()=>void }) {
  const { setOpenMobile } = useSidebar();
  return <Sidebar className="app-sidebar"><SidebarHeader className="brand"><span className="brand-symbol"><Globe2 size={29} strokeWidth={1.3}/></span><div>Earth<b>Scope</b><span>CLIMATE TIME MACHINE</span></div></SidebarHeader>
    <SidebarContent className="nav-content"><p className="nav-caption">YOUR PLANET, THROUGH TIME</p><SidebarMenu>{NAV.map(item=><SidebarMenuItem key={item.id}><SidebarMenuButton isActive={view===item.id} onClick={()=>{setOpenMobile(false);navigate(item.id);}} className="nav-button"><item.icon size={18}/><span>{item.title}</span>{item.badge && <b>{item.badge}</b>}</SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu>
    <div className="nav-divider"/><p className="nav-caption">THE BIGGER PICTURE</p><button className="nav-secondary" onClick={onData}><BookOpen size={18}/> About the data <ArrowUpRight size={14}/></button>
    <div className="planet-note"><div className="note-orbit"><Sprout size={23}/></div><p>One planet.<br/><strong>Endless perspectives.</strong></p><span>A little understanding can<br/>make a world of difference.</span><button onClick={()=>{setOpenMobile(false);navigate("future");}}>Explore what’s possible <ArrowUpRight size={15}/></button></div>
    </SidebarContent><SidebarFooter className="sidebar-bottom"><span className="nasa-small">NASA</span><p>Powered by Earth science<small>Built for the curious.</small></p><button aria-label="About EarthScope" onClick={onData}><CircleHelp size={16}/></button></SidebarFooter></Sidebar>;
}

function Sparkline({ values, color = "#d5a176", fill = false }: { values: number[]; color?: string; fill?: boolean }) {
  const low = Math.min(...values), high = Math.max(...values), range = high-low || 1;
  const points = values.map((v,i)=>`${i/(values.length-1)*160},${42-(v-low)/range*32}`).join(" ");
  return <svg viewBox="0 0 160 48" className="sparkline" aria-label="Annual variation sparkline" role="img">{fill && <polygon points={`0,48 ${points} 160,48`} fill={color} opacity=".10"/>}<polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/></svg>;
}

function MetricCards({ data, year, warming, rainChange }: { data: ClimateData; year: number; warming: number; rainChange: number }) {
  const last = data.annual.at(-1)!, current = observation(data,year,warming,rainChange), delta = periodDelta(data), p = periodLabels(data), scenario = year>last.year;
  const trend = calculateTrend(data.annual);
  const tempChange = scenario ? current.temperature-last.temperature : delta.temperature;
  const rainChangePct = scenario ? (current.rainfall/last.rainfall-1)*100 : delta.rainfall;
  const halfCi = (trend.tempCi95[1]-trend.tempCi95[0])/2;
  return <div className="metrics-grid"><article className="metric-card"><div className="metric-label"><Thermometer size={16}/><span>Mean temperature</span><span className="metric-year">{year}</span></div><div className="metric-main"><strong>{current.temperature.toFixed(1)}<em>°C</em></strong><Sparkline values={data.annual.map(a=>a.temperature)} color="#38c8ff" fill/></div><p>{tempChange===null?<span className="muted-text">Too few consistent years for a decade comparison</span>:<><span className="warm-text">{signed(tempChange)}°C</span> {scenario ? `relative to ${last.year}` : `${p.recent} vs ${p.base}`}</>}</p></article>
    <article className="metric-card"><div className="metric-label"><CloudRain size={16}/><span>Annual precipitation</span><span className="metric-year">{year}</span></div><div className="metric-main"><strong>{Math.round(current.rainfall).toLocaleString()}<em>mm</em></strong><Sparkline values={data.annual.map(a=>a.rainfall)} color="#4f9dff" fill/></div><p>{rainChangePct===null?<span className="muted-text">Too few consistent years for a decade comparison</span>:<><span className="blue-text">{signed(rainChangePct)}%</span> {scenario ? `relative to ${last.year}` : `${p.rainRecent} vs ${p.rainBase}`}</>}</p></article>
    <article className="metric-card"><div className="metric-label"><TrendingUp size={16}/><span>Trend detective</span><span className="metric-year">{trend.years[0]}–{String(trend.years[1]).slice(2)}</span></div><div className="metric-main"><strong>{trend.tempEnough?signed(trend.tempSlopePerDecade, 2):"—"}<em>°C/dec</em></strong><Sparkline values={data.annual.filter(a=>a.year>=trend.years[0]).map(a=>a.temperature)} color={trend.tempSignificant?"#32a6ff":"#5f86c4"}/></div><p title={trendSummary(trend)}><span className={trend.tempSignificant?"lime-text":"muted-text"}>{trendVerdict(trend)}</span> {trend.tempEnough?`±${halfCi.toFixed(2)} (95% CI) · ${trendSummary(trend).match(/p [<=] [\d.]+/)?.[0] ?? ""}`:""}</p></article>
    <article className="metric-card"><div className="metric-label"><History size={16}/><span>Climate record</span><ShieldCheck size={14}/></div><div className="metric-main"><strong>{data.annual.length}<em>years</em></strong><div className="record-bars">{[30,44,35,52,43,58,50,65,56,74,69,83].map((v,i)=><i key={i} style={{height:`${v}%`}}/>)}</div></div><p><span className="lime-text">{data.annual[0].year}–{last.year}</span> {data.source === "NASA POWER" ? (p.breakNote ? `consistent from ${trend.years[0]}` : "NASA POWER observations") : "Illustrative example data"}</p></article></div>;
}

function DataQualityNote({ data }: { data: ClimateData }) {
  const note = periodLabels(data).breakNote;
  if (!note || data.source !== "NASA POWER") return null;
  return <div className="data-quality-note" role="note"><ShieldCheck size={16}/><p><strong>Data quality check:</strong> {note} Detected automatically with a two-phase regression break test (Lund &amp; Reeves 2002, 99% level).</p></div>;
}

export default function ClimateApp() {
  const [view,setView] = useState<View>("explore"), [place,setPlace] = useState(PLACES[0]), [data,setData] = useState<ClimateData>(INITIAL), [year,setYear] = useState(2025), [playing,setPlaying] = useState(false), [layer,setLayer] = useState<Layer>("Natural color"), [warming,setWarming] = useState(1.5), [rainChange,setRainChange] = useState(-10), [dataOpen,setDataOpen] = useState(false), [storyOpen,setStoryOpen] = useState(false), [chatOpen,setChatOpen] = useState(false), [loading,setLoading] = useState(false), [loadError,setLoadError] = useState(false), [retry,setRetry] = useState(0), [reportReq,setReportReq] = useState<ReportRequest|null>(null), [pendingShare,setPendingShare] = useState<SharedReport|null>(null);
  const [chartMetric, setChartMetric] = useState<"temperature" | "rainfall">("temperature");
  const [chartMode, setChartMode] = useState<"absolute" | "anomaly">("absolute");
  const [reports, setReports] = useState<Report[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = JSON.parse(localStorage.getItem("terra-reports") || "[]");
      return Array.isArray(saved) ? saved.filter(r => r?.place?.id && Array.isArray(r?.data?.annual) && r.data.annual.length) : [];
    } catch {
      return [];
    }
  });
  const [comparisonPlace,setComparisonPlace] = useState(PLACES[3]), [comparisonData,setComparisonData] = useState<ClimateData|null>(null), [comparisonError,setComparisonError] = useState(false);
  const chartRef = useRef<SVGSVGElement>(null);
  const navigate = (v: View) => { setView(v); if(v==="future")setYear(SCENARIO_END); setPlaying(false); scrollToTopWhenUnlocked(); };
  const selectPlace = useCallback((p: Place)=>{setPlace(p);setPlaying(false);},[]);

  useEffect(() => {
    const handleRejection = (e: PromiseRejectionEvent) => {
      const err = e.reason;
      const msg = (typeof err === "string" ? err : err?.message || String(err || "")).toLowerCase();
      const stack = (err?.stack || "").toLowerCase();
      if (
        msg.includes("metamask") ||
        msg.includes("failed to connect") ||
        stack.includes("chrome-extension://") ||
        stack.includes("moz-extension://") ||
        stack.includes("inpage.js")
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("unhandledrejection", handleRejection, true);
    return () => window.removeEventListener("unhandledrejection", handleRejection, true);
  }, []);

  // Installable app + offline safety pack + alert notifications (production builds only, so it never
  // interferes with the dev server).
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => { /* the app works without it */ });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const cached = CACHE.get(place.id);
    if (cached && retry === 0) {
      queueMicrotask(() => {
        if (!active) return;
        setData(cached);
        setLoading(false);
        setLoadError(false);
      });
      return () => { active = false; };
    }
    queueMicrotask(() => {
      if (!active) return;
      setData(demoClimate(place));
      setLoading(true);
      setLoadError(false);
    });
    fetch(`/api/climate?lat=${place.lat}&lon=${place.lon}`, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return r.json() as Promise<ClimateData>;
      })
      .then((d) => {
        if (!active) return;
        CACHE.set(place.id, d);
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        if (active && !controller.signal.aborted) {
          setLoading(false);
          setLoadError(true);
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [place, retry]);

  useEffect(()=>{if(!playing)return; const timer=setInterval(()=>setYear(y=>{if(y>=SCENARIO_END){setPlaying(false);return SCENARIO_END;}return y+1;}),650);return()=>clearInterval(timer);},[playing]);

  useEffect(() => {
    if (view !== "compare") return;
    const controller = new AbortController();
    let active = true;
    const cached = CACHE.get(comparisonPlace.id);
    queueMicrotask(() => {
      if (!active) return;
      setComparisonError(false);
      if (cached) {
        setComparisonData(cached);
      } else {
        setComparisonData(null);
      }
    });
    if (!cached) {
      fetch(`/api/climate?lat=${comparisonPlace.lat}&lon=${comparisonPlace.lon}`, { signal: controller.signal })
        .then(async (r) => {
          if (!r.ok) throw new Error();
          return r.json() as Promise<ClimateData>;
        })
        .then((d) => {
          if (!active) return;
          CACHE.set(comparisonPlace.id, d);
          setComparisonData(d);
        })
        .catch(() => {
          if (active && !controller.signal.aborted) setComparisonError(true);
        });
    }
    return () => {
      active = false;
      controller.abort();
    };
  }, [comparisonPlace, view]);

  const delta = periodDelta(data), periods = periodLabels(data), current=observation(data,year,warming,rainChange), story=climateStory(place,data,year,warming,rainChange);
  const trend = calculateTrend(data.annual);

  const exporting = !!reportReq;
  const saveReport = () => setReportReq({ base: { place, year, warming, rainChange, climate: data } });
  const exportReport = (r: Report) => setReportReq({ base: { place: r.place, year: r.year, warming: r.warming, rainChange: r.rainChange, climate: r.data }, inputs: r.inputs, savedId: r.id, lang: r.lang, audience: r.audience });
  const persistReport = useCallback((inputs: ReportInputs, lang: Lang, audience: Audience, id?: string) => {
    const rid = id ?? crypto.randomUUID();
    setReports(prev => {
      const entry: Report = { id: rid, place: inputs.place, year: inputs.year, warming: inputs.warming, rainChange: inputs.rainChange, created: inputs.created, data: inputs.climate, inputs, lang, audience };
      const next = [entry, ...prev.filter(x => x.id !== rid)].slice(0, 30);
      try { localStorage.setItem("terra-reports", JSON.stringify(next)); }
      catch { try { localStorage.setItem("terra-reports", JSON.stringify(next.slice(0, 10))); } catch { toast.error("This browser could not save the report. You can still save it as PDF."); } }
      return next;
    });
    if (!id) toast.success("Report saved to My climate reports");
    return rid;
  }, []);
  const deleteReport = (id: string) => setReports(prev => { const next = prev.filter(r => r.id !== id); try { localStorage.setItem("terra-reports", JSON.stringify(next)); } catch { /* storage unavailable */ } return next; });

  // Share links (?report=…) reopen a report for the same place, year and scenario.
  useEffect(() => {
    const shared = parseShare(new URLSearchParams(window.location.search).get("report"));
    if (!shared) return;
    window.history.replaceState(null, "", window.location.pathname);
    queueMicrotask(() => { setPlace(shared.place); setYear(shared.year); setWarming(shared.warming); setRainChange(shared.rainChange); setView("reports"); setPendingShare(shared); });
  }, []);
  useEffect(() => {
    if (!pendingShare || loading || data.source !== "NASA POWER" || place.id !== pendingShare.place.id) return;
    queueMicrotask(() => { setReportReq({ base: { place, year: pendingShare.year, warming: pendingShare.warming, rainChange: pendingShare.rainChange, climate: data }, lang: pendingShare.lang, audience: pendingShare.audience }); setPendingShare(null); });
  }, [pendingShare, loading, data, place]);
  useEffect(()=>{
    const ctx=(document as unknown as {modelContext?:{registerTool:(tool:unknown,options:{signal:AbortSignal})=>void}}).modelContext;if(!ctx?.registerTool)return;const lifecycle=new AbortController();
    try{ctx.registerTool({name:"explore_climate",description:"Select a featured place and year in the visible EarthScope climate explorer.",inputSchema:{type:"object",properties:{placeId:{type:"string",enum:PLACES.map(p=>p.id)},year:{type:"integer",minimum:RECORD_START,maximum:SCENARIO_END}},required:["placeId","year"],additionalProperties:false},annotations:{readOnlyHint:false},execute:async(input:unknown)=>{const v=input as {placeId:string;year:number};const p=PLACES.find(p=>p.id===v.placeId);if(!p||!Number.isInteger(v.year)||v.year<RECORD_START||v.year>SCENARIO_END)throw new Error(`Choose a featured place and a year from ${RECORD_START} to ${SCENARIO_END}.`);selectPlace(p);setYear(v.year);setView("explore");await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return{place:p.name,year:v.year,mode:v.year>RECORD_END?"scenario":"historical"};}},{signal:lifecycle.signal});}catch{}return()=>lifecycle.abort();
  },[selectPlace]);

  return <SidebarProvider style={{"--sidebar-width":"228px"} as CSSProperties}><AppNav view={view} navigate={navigate} onData={()=>setDataOpen(true)}/><div className="app-main"><header className="topbar"><div className="breadcrumb"><SidebarTrigger className="mobile-nav-trigger"/><span>Workspace</span><ChevronRight size={13}/><strong>{NAV.find(n=>n.id===view)?.title}</strong></div><div className="topbar-right"><span className="science-badge"><span/> Earth science, made personal</span><button className="help-button" onClick={()=>setDataOpen(true)} aria-label="Data information"><CircleHelp size={18}/></button></div></header>
    <main className="workspace"><HeroSky view={view}/><div className="page-heading"><div><div className="eyebrow"><span/> A LITTLE CURIOSITY. A WORLD OF DISCOVERY.</div><h1>{headline(HEADINGS[view][0])}</h1><p>{HEADINGS[view][1]}</p></div><button className="outline-button report-top" disabled={exporting||loading} onClick={saveReport}>{exporting?<LoaderCircle className="spin" size={16}/>:<Download size={16}/>} Export report</button></div>
    <div className="location-bar"><div className="selected-location"><span className="location-symbol"><MapPin size={19}/></span><div><strong>{place.name}<span>, {place.country}</span></strong><small>{Math.abs(place.lat).toFixed(4)}° {place.lat>=0?"N":"S"}<i/>{Math.abs(place.lon).toFixed(4)}° {place.lon>=0?"E":"W"}</small></div><span className="location-tag">{year>RECORD_END?"FUTURE SCENARIO":"YOUR CLIMATE JOURNEY"}</span></div><PlacePicker place={place} onChange={selectPlace}/></div>
    {(loading||loadError||data.source!=="NASA POWER") && <div className="connection-banner" role="status">{loading?<LoaderCircle size={14} className="spin"/>:<CircleHelp size={14}/>} {loading?"Fetching NASA observations. Values shown while loading are illustrative.":"NASA observations are unavailable. Displaying illustrative example data."}{loadError&&<button onClick={()=>setRetry(v=>v+1)}>Retry</button>}</div>}
    {view==="explore"&&<><MetricCards data={data} year={year} warming={warming} rainChange={rainChange}/><DataQualityNote data={data}/><div className="explorer-grid"><section className="earth-panel"><div className="earth-panel-top"><span><Globe2 size={15}/> Planet view</span><div><span className="map-mode">3D EARTH</span><button aria-label="Expand planet view" onClick={()=>{const el=document.querySelector('.earth-panel');if(document.fullscreenElement)document.exitFullscreen();else el?.requestFullscreen?.().catch(()=>toast.info("Fullscreen is not available in this browser."));}}><Maximize2 size={15}/></button></div></div><div className="map-caption"><span className="caption-line"/><span>YOUR WINDOW INTO<br/><strong>A changing world.</strong></span></div><div className="map-year">{year}<span>{year>RECORD_END?"A POSSIBLE FUTURE":"A MOMENT IN TIME"}</span></div><EarthGlobe place={place} layer={layer} year={year} onSelect={selectPlace}/><div className="map-layer"><Layers3 size={15}/><Select value={layer} onValueChange={v=>setLayer(v as Layer)}><SelectTrigger aria-label="Earth visualization layer"><SelectValue/></SelectTrigger><SelectContent>{LAYERS.map(l=><SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent></Select></div><span className="map-credit">{layer==="Natural color"?"NASA Blue Marble · reference imagery":"Conceptual color theme · not a measured risk map"}</span>
      <div className="timeline"><div className="timeline-header"><span><History size={14}/> THE TIME MACHINE</span><Tabs value={year<=RECORD_END?"history":"future"} onValueChange={v=>setYear(v==="history"?RECORD_END:SCENARIO_END)}><TabsList><TabsTrigger value="history">Historical</TabsTrigger><TabsTrigger value="future">Future</TabsTrigger></TabsList></Tabs></div><div className="timeline-control"><button className={playing?"play active":"play"} aria-label={playing?"Pause timeline":"Play timeline"} onClick={()=>{if(year>=SCENARIO_END)setYear(RECORD_START);setPlaying(v=>!v);}}>{playing?<Pause size={15} fill="currentColor"/>:<Play size={15} fill="currentColor"/>}</button><div className="year-track"><Slider aria-label="Climate year" min={RECORD_START} max={SCENARIO_END} step={1} value={[year]} onValueChange={v=>{setYear(v[0]);setPlaying(false);}}/><div className="year-ticks">{[RECORD_START,1990,2000,2010,2025,2040,SCENARIO_END].map(y=><button key={y} className={year===y?"selected":""} style={{left:`${(y-RECORD_START)/(SCENARIO_END-RECORD_START)*100}%`}} onClick={()=>{setYear(y);setPlaying(false);}}>{y}</button>)}</div></div><span className="year-value">{year}</span></div></div></section>
      <aside className="insight-panel"><div className="insight-top"><span className="insight-icon"><Sparkles size={18}/></span><span>THE CLIMATE, EXPLAINED</span><span className="small-pill">INSIGHT</span></div><h2>A small shift.<br/>A bigger story.</h2><p>{delta.temperature===null?<>There are not enough consistent years in this record for a decade-to-decade comparison.</>:<>In {place.name}, {periods.recent} averaged <strong>{Math.abs(delta.temperature).toFixed(2)}°C {delta.temperature>=0?"warmer":"cooler"}</strong> than {periods.base}.</>} {trend.tempEnough?(trend.tempSignificant?<>The {trend.years[0]}–{trend.years[1]} trend is <strong>{signed(trend.tempSlopePerDecade, 2)}°C / decade</strong> and statistically significant ({trendSummary(trend).match(/p [<=] [\d.]+/)?.[0]}).</>:<>Over {trend.years[0]}–{trend.years[1]} there is <strong>no statistically clear trend yet</strong> — natural year-to-year swings are larger than any steady change.</>):null}</p>
      <div className="insight-chart">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", fontSize: "11px", marginBottom: "6px" }}>
          <div style={{ display: "flex", gap: "8px" }}>
            <span style={{ cursor: "pointer", color: chartMetric === "temperature" ? "#32a6ff" : "#5a7192", fontWeight: chartMetric === "temperature" ? 600 : 400 }} onClick={() => setChartMetric("temperature")}>
              Temp (°C)
            </span>
            <span style={{ color: "#354357" }}>|</span>
            <span style={{ cursor: "pointer", color: chartMetric === "rainfall" ? "#87b6d5" : "#5a7192", fontWeight: chartMetric === "rainfall" ? 600 : 400 }} onClick={() => setChartMetric("rainfall")}>
              Rain (mm)
            </span>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <span style={{ cursor: "pointer", color: chartMode === "absolute" ? "#81c8ff" : "#5a7192", fontWeight: chartMode === "absolute" ? 600 : 400 }} onClick={() => setChartMode("absolute")}>
              Absolute
            </span>
            <span style={{ color: "#354357" }}>|</span>
            <span style={{ cursor: "pointer", color: chartMode === "anomaly" ? "#f4ad7e" : "#5a7192", fontWeight: chartMode === "anomaly" ? 600 : 400 }} onClick={() => setChartMode("anomaly")}>
              Anomaly
            </span>
          </div>
        </div>
        <svg ref={chartRef} viewBox="0 0 260 100" role="img" aria-label={`Climate variable history from ${data.annual[0]?.year} to ${data.annual.at(-1)?.year}`}><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop stopColor={chartMetric === "temperature" ? (chartMode === "anomaly" ? "#f4ad7e" : "#36a8ff") : "#87b6d5"} stopOpacity=".25"/><stop offset="1" stopColor={chartMetric === "temperature" ? (chartMode === "anomaly" ? "#f4ad7e" : "#36a8ff") : "#87b6d5"} stopOpacity="0"/></linearGradient></defs>{[20,50,80].map(y=><line key={y} x1="0" x2="260" y1={y} y2={y} stroke="#ffffff0c" strokeDasharray="3 5"/>)}<ChartPath data={data} metric={chartMetric} mode={chartMode}/></svg>
        <div className="chart-labels"><span>{data.annual[0]?.year}</span><span>{data.annual[Math.floor(data.annual.length/2)]?.year}</span><span>{data.annual.at(-1)?.year}</span></div>{homogeneity(data.annual).tempBreak&&<div className="chart-note">Shaded: years before the {homogeneity(data.annual).tempBreak!.year} data break (not used)</div>}
      </div>
      <div className="insight-takeaway"><Sprout size={17}/><p>Trend detectives examine multidecadal slope alongside natural variability to uncover clear climate signals.</p></div><button className="lime-button" onClick={()=>setStoryOpen(true)}>Read your climate story <ArrowUpRight size={17}/></button><span className="insight-footnote">{data.source} · {data.annual[0]?.year}–{data.annual.at(-1)?.year}<br/>Trend {trend.years[0]}–{trend.years[1]}: {trendSummary(trend)}<br/>Autocorrelation-corrected t-test (effective n = {trend.nEff.toFixed(0)})</span></aside></div>
      <div className="discovery-heading"><h2>Go a little deeper</h2><span>Big questions. New perspectives.</span></div><div className="discovery-grid"><article className="discovery-card"><div className="discovery-card-title"><span><Layers3 size={16}/> A VIEW THROUGH TIME</span><button aria-label="Open satellite comparison" onClick={()=>navigate("satellite")}><ArrowUpRight size={18}/></button></div><SatelliteComparison place={place}/><div className="discovery-card-bottom"><h3>Same place. Different chapter.</h3><button onClick={()=>navigate("satellite")}>Compare satellite images <ArrowRight size={15}/></button></div></article><article className="discovery-card future-teaser"><div className="discovery-card-title"><span><FlaskConical size={16}/> THE POSSIBILITIES AHEAD</span><span className="tiny-badge">SCENARIO LAB</span></div><div className="future-number"><span>What if it gets</span><strong>+{warming.toFixed(1)}<em>°C</em></strong><span>warmer by 2050?</span></div><div className="future-lines"><i/><i/><i/><i/></div><div className="discovery-card-bottom"><h3>The next chapter is unwritten.</h3><button onClick={()=>navigate("future")}>Explore future scenarios <ArrowRight size={15}/></button></div></article><article className="discovery-card action-teaser"><div className="discovery-card-title"><span><Leaf size={16}/> SMALL STEPS. REAL IMPACT.</span><ArrowUpRight size={17}/></div><div className="action-list"><div><span><Sprout size={19}/></span><p>Make room for green<small>Shade today. Resilience tomorrow.</small></p></div><div><span><Waves size={19}/></span><p>Work with water<small>Protect natural drainage.</small></p></div><div><span><ShieldCheck size={19}/></span><p>Stay one step ahead<small>Connect with local early warnings.</small></p></div></div><button className="text-link" onClick={()=>{setStoryOpen(true);}}>Your adaptation guide <ArrowRight size={15}/></button></article></div></>}
    {view==="disasters"&&<DisasterMap place={place}/>}
    {view==="atlas"&&<ClimateAtlas onOpenPlace={p=>{selectPlace(p);navigate("explore");}}/>}
    {view==="satellite"&&<section className="content-panel"><div className="section-heading"><div><span className="eyebrow">THE EARTH REMEMBERS</span><h2>{place.name}, then and now.</h2><p>Measured change from NASA satellites: land cover, vegetation and like-for-like imagery from the same season.</p></div><span className="source-pill"><Radar size={14}/> NASA GIBS · Landsat · Sentinel-2 · MODIS</span></div><SatelliteComparison place={place} large/></section>}
    {view==="future"&&<section className="scenario-grid"><div className="content-panel scenario-controls"><span className="eyebrow">BUILD YOUR WHAT-IF</span><h2>A possible {year}.</h2><p>Explore simple changes relative to the latest complete observation in 2025.</p><div className="scenario-presets">{[{label:"Lower change",t:1,r:0},{label:"Moderate",t:1.5,r:-10},{label:"Higher change",t:3,r:-20}].map(p=><button key={p.label} className={warming===p.t&&rainChange===p.r?"selected":""} onClick={()=>{setWarming(p.t);setRainChange(p.r);}}>{p.label}</button>)}</div><div className="scenario-control"><label><Thermometer size={17}/> Warming by 2050 <strong>+{warming.toFixed(1)}°C</strong></label><Slider aria-label="Warming by 2050" min={0} max={4} step={.1} value={[warming]} onValueChange={v=>setWarming(v[0])}/><div><span>No additional warming</span><span>+4°C</span></div></div><div className="scenario-control"><label><CloudRain size={17}/> Rainfall change by 2050 <strong>{signed(rainChange,0)}%</strong></label><Slider aria-label="Rainfall change by 2050" min={-40} max={40} step={1} value={[rainChange]} onValueChange={v=>setRainChange(v[0])}/><div><span>−40% · Drier</span><span>+40% · Wetter</span></div></div><div className="scenario-control"><label><History size={17}/> Explore year <strong>{Math.max(2026,year)}</strong></label><Slider aria-label="Scenario year" min={2026} max={2050} step={1} value={[Math.max(2026,year)]} onValueChange={v=>setYear(v[0])}/><div><span>2026</span><span>2050</span></div></div><p className="data-note"><CircleHelp size={17}/> An educational sensitivity experiment, not a CMIP6 projection or a local risk assessment.</p></div><div className="scenario-results content-panel"><span className="small-pill">YOUR SCENARIO</span><h2>{place.name} in {year}</h2><div className="scenario-result"><Thermometer size={25}/><div><strong>{current.temperature.toFixed(1)}<em>°C</em></strong><span>Annual mean temperature</span></div></div><div className="scenario-result"><CloudRain size={25}/><div><strong>{Math.round(current.rainfall).toLocaleString()}<em>mm</em></strong><span>Annual precipitation</span></div></div><div className="scenario-explainer"><Sparkles size={18}/><p>{warming>=2?"Higher temperatures can increase heat stress and water demand. The size of the local impact depends on humidity, infrastructure, and people’s exposure.":"Even smaller temperature changes can affect daily life. Protecting shade and green spaces is a practical place to start."} {rainChange<0?"Lower rainfall could add pressure to water supply; annual totals do not describe drought duration.":"Higher annual rainfall does not directly translate to flooding; timing and drainage matter."}</p></div><button className="lime-button" onClick={saveReport} disabled={exporting}>Save this scenario <Download size={16}/></button></div></section>}
    {view==="compare"&&<section className="content-panel"><div className="section-heading"><div><span className="eyebrow">SIDE BY SIDE</span><h2>Two places. Two perspectives.</h2><p>Comparing the same NASA variables and time period.</p></div><PlacePicker place={comparisonPlace} onChange={setComparisonPlace} label="Choose a comparison city"/></div><div className="compare-grid">{[{p:place,d:data},{p:comparisonPlace,d:comparisonData}].map(({p,d},i)=><article className="compare-city" key={i}><span className="comparison-index">0{i+1}</span><MapPin size={22}/><h2>{p.name}</h2><p>{p.country}</p>{d?<><div className="compare-value"><span>{RECORD_END} annual temperature</span><strong>{observation(d,RECORD_END).temperature.toFixed(1)}°C</strong></div><div className="compare-value"><span>{RECORD_END} precipitation</span><strong>{Math.round(observation(d,RECORD_END).rainfall).toLocaleString()} mm</strong></div><div className="compare-value"><span>Temperature trend {calculateTrend(d.annual).years.join("–")}</span><strong className={calculateTrend(d.annual).tempSignificant?"lime-text":"muted-text"} title={trendSummary(calculateTrend(d.annual))}>{calculateTrend(d.annual).tempEnough?`${signed(calculateTrend(d.annual).tempSlopePerDecade, 2)}°C/dec`:"—"} · {trendVerdict(calculateTrend(d.annual)).replace("Significant ","")}</strong></div><div className="compare-value"><span>Change {periodLabels(d).base||"first decade"} → {periodLabels(d).recent||"last decade"}</span><strong className="warm-text">{periodDelta(d).temperature===null?"—":`${signed(periodDelta(d).temperature!,2)}°C`}</strong></div><Sparkline values={d.annual.map(v=>v.temperature)} fill color={i?"#8ab9d4":"#32a6ff"}/><small>{d.source} · {d.annual[0]?.year}–{d.annual.at(-1)?.year}{homogeneity(d.annual).tempBreak?` · data break ${homogeneity(d.annual).tempBreak!.year}`:""}</small></>:<div className="compare-loading">{comparisonError?<><CircleHelp/>NASA data is temporarily unavailable.<button className="outline-button" onClick={()=>setComparisonPlace({...comparisonPlace})}>Retry</button></>:<><LoaderCircle className="spin"/>Loading NASA observations…</>}</div>}</article>)}</div>
    {data && comparisonData && <ComparativeTrendChart place1={place} data1={data} place2={comparisonPlace} data2={comparisonData} />}
    <p className="data-note"><CircleHelp size={15}/> Warmer does not automatically mean more vulnerable. Climate risk depends on local exposure, infrastructure, and adaptive capacity.</p></section>}
    {view==="reports"&&<section className="content-panel reports-panel"><div className="section-heading"><div><span className="eyebrow">YOUR PERSONAL FIELD NOTES</span><h2>Saved climate reports <span className="count">{reports.length}</span></h2><p>Full climate reports (English or বাংলা, for citizens, students or planners), stored on this device. Open one to preview, save as PDF, download its data or share a link.</p></div><button className="lime-button" onClick={saveReport} disabled={exporting}><Plus size={16}/> Create current report</button></div>{reports.length?<div className="reports-list">{reports.map(r=><article key={r.id}><div className="report-icon"><FileText size={23}/></div><div><h3>{r.place.name} · {r.year}</h3><p>{r.year>RECORD_END?"Future scenario":"Climate history"} · {new Date(r.created).toLocaleDateString("en-GB")} · {r.inputs?`${r.lang==="bn"?"বাংলা":"English"} · ${r.audience??"citizen"} edition`:r.data.source}</p></div><div className="report-actions"><button className="outline-button" disabled={exporting} onClick={()=>exportReport(r)}><FileText size={15}/> Open</button><button className="report-delete" aria-label={`Delete report for ${r.place.name}`} onClick={()=>deleteReport(r.id)}><Trash2 size={15}/></button></div></article>)}</div>:<div className="empty-reports"><FileText size={42} strokeWidth={1}/><h3>Your next discovery belongs here.</h3><p>Explore a place and export its climate report.<br/>You can return to your saved reports anytime in this browser.</p><button className="outline-button" onClick={()=>navigate("explore")}>Start exploring <ArrowRight size={16}/></button></div>}</section>}
    <footer className="workspace-footer"><span><Globe2 size={13}/> A changing planet. An informed you.</span><button onClick={()=>setDataOpen(true)}>Data sources & methodology <ArrowUpRight size={13}/></button><span>Made for Earth’s next chapter.</span></footer></main></div>
    <button className="ask-earth" onClick={()=>setChatOpen(true)}><Sparkles size={17}/><span>Ask Earth</span><span className="ask-shortcut">↗</span></button>
    <Dialog open={dataOpen} onOpenChange={setDataOpen}><DialogContent className="info-dialog"><DialogHeader><span className="eyebrow">BUILT ON EARTH SCIENCE</span><DialogTitle>The story behind the data.</DialogTitle><DialogDescription>Know what you’re looking at, and what it can tell you.</DialogDescription></DialogHeader><div className="source-list"><a href="https://power.larc.nasa.gov/docs/methodology/" target="_blank" rel="noreferrer"><Thermometer/><div><strong>NASA POWER / MERRA-2</strong><p>Annual temperature at 2 meters and precipitation, {RECORD_START}–{RECORD_END}. Gridded reanalysis estimates (about 50 km cells), not city weather stations. Each series is tested for abrupt non-climatic steps — reanalyses jump when the observations they assimilate change — and years before a step are excluded.</p></div><ExternalLink size={16}/></a><a href="https://nasa-gibs.github.io/gibs-api-docs/" target="_blank" rel="noreferrer"><Layers3/><div><strong>NASA GIBS / Terra MODIS</strong><p>True-color imagery and NDVI vegetation composites. The 3D globe uses NASA Blue Marble (shaded relief and bathymetry), VIIRS Black Marble city lights and real NOAA-20 VIIRS clouds for one recent day.</p></div><ExternalLink size={16}/></a><a href="https://eonet.gsfc.nasa.gov/" target="_blank" rel="noreferrer"><Siren/><div><strong>Live disasters: NASA EONET · GDACS · USGS</strong><p>Open natural events from NASA EONET, alert levels from GDACS (UN / European Commission) and M4.5+ earthquakes from USGS, refreshed every 5 minutes. VIIRS active fires and GPM IMERG rain are NASA GIBS overlays. Impact zones are simple distance estimates, and “safer places” are OpenStreetMap shelters, hospitals and assembly points outside those zones. Not an official warning system.</p></div><ExternalLink size={16}/></a><a href="https://www.geoboundaries.org/" target="_blank" rel="noreferrer"><Earth/><div><strong>Climate atlas: NASA POWER grid + boundaries</strong><p>State and district values average every NASA POWER MERRA-2 grid cell (0.5° × 0.625°) inside the boundary, weighted by latitude. Country values average up to 8 sample points. Boundaries: Natural Earth and geoBoundaries.</p></div><ExternalLink size={16}/></a><div><TrendingUp/><div><strong>Honest trend statistics</strong><p>Trends are least-squares slopes with 95% confidence intervals and an autocorrelation-corrected t-test (Santer et al. 2000). A change is called “warming” or “cooling” only when p &lt; 0.05; otherwise Terra says there is no clear trend yet.</p></div></div><div><FlaskConical/><div><strong>Transparent scenarios</strong><p>User-selected changes are applied linearly from {RECORD_END} to {SCENARIO_END}. These are educational scenarios, not CMIP6 output; the globe&apos;s years after {RECORD_END} extend observed trends and are flagged as such. Layer colors are illustrative themes; no vegetation-loss measurement or flood-risk score is inferred.</p></div></div><div><Sparkles/><div><strong>Ask Earth & climate stories</strong><p>Data-grounded, rule-based explanations. No generative AI model is connected. Answers summarize the current record and general adaptation principles, with no causal attribution from these variables alone.</p></div></div></div></DialogContent></Dialog>
    <Dialog open={storyOpen} onOpenChange={setStoryOpen}><DialogContent className="story-dialog"><DialogHeader><span className="eyebrow">YOUR CLIMATE STORY · {year}</span><DialogTitle>{place.name}. A story still unfolding.</DialogTitle><DialogDescription>{data.source} · {year>RECORD_END?"User-defined scenario":`${data.annual[0]?.year}–${data.annual.at(-1)?.year} annual climate record`}</DialogDescription></DialogHeader><div className="story-image">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl(place,"2025-01-20")} alt={`Satellite view of ${place.name}, 20 January 2025`}/><span>{place.name}, from a different perspective.</span></div><p className="story-body">{story}</p><h3>A more resilient next chapter</h3><div className="adaptation-grid"><div><Sprout/><strong>Make room for green</strong><p>Protect mature trees and prioritize shade around homes, schools, and walking routes.</p></div><div><Waves/><strong>Work with water</strong><p>Keep drainage clear, protect wetlands, and follow locally informed water planning.</p></div><div><ShieldCheck/><strong>Prepare together</strong><p>Use local early warnings and identify people who may need extra support during extremes.</p></div></div><button className="lime-button" onClick={saveReport} disabled={exporting}>Keep this story <Download size={16}/></button></DialogContent></Dialog>
    <AskEarth open={chatOpen} onOpenChange={setChatOpen} place={place} data={data} year={year} warming={warming} rainChange={rainChange}/>
    {reportReq && <ClimateReport request={reportReq} onClose={()=>setReportReq(null)} onSave={persistReport}/>}
    <Toaster position="bottom-center" theme="dark" richColors/>
  </SidebarProvider>;
}

function ComparativeTrendChart({ place1, data1, place2, data2 }: { place1: Place; data1: ClimateData; place2: Place; data2: ClimateData }) {
  const series = [{ place: place1, data: data1, color: "#32a6ff" }, { place: place2, data: data2, color: "#8ab9d4" }].map(s => {
    const trend = calculateTrend(s.data.annual), from = trend.years[0];
    // Anomalies relative to each place's own first consistent decade; inconsistent years are not drawn.
    const pts = calculateAnomalies(s.data.annual).filter(a => a.year >= from).map(a => ({ year: a.year, v: a.tempAnomaly }));
    return { ...s, trend, pts };
  });
  const allYears = series.flatMap(s => s.pts.map(p => p.year)), all = series.flatMap(s => s.pts.map(p => p.v));
  if (!allYears.length) return null;
  const y0 = Math.min(...allYears), y1 = Math.max(...allYears);
  const min = Math.min(...all, -0.4), max = Math.max(...all, 0.4), range = max - min || 1;
  const X = (y: number) => ((y - y0) / Math.max(1, y1 - y0)) * 500, Y = (v: number) => 125 - ((v - min) / range) * 105;
  const zeroY = Y(0);
  const sig = series.filter(s => s.trend.tempSignificant);
  const diagnosis = sig.length === 2
    ? (() => { const [a, b] = [...sig].sort((p, q) => Math.abs(q.trend.tempSlopePerDecade) - Math.abs(p.trend.tempSlopePerDecade)); const overlap = a.trend.tempCi95[0] <= b.trend.tempCi95[1] && b.trend.tempCi95[0] <= a.trend.tempCi95[1]; return overlap ? <>Both places show significant trends, and their 95% confidence intervals overlap — the difference in rates is <strong>not statistically clear</strong>.</> : <><strong>{a.place.name}</strong> is changing faster than {b.place.name}; their 95% confidence intervals do not overlap.</>; })()
    : sig.length === 1 ? <>Only <strong>{sig[0].place.name}</strong> shows a statistically significant trend over its consistent record.</>
    : <>Neither place shows a statistically clear temperature trend over its consistent record.</>;
  const ticks = Array.from(new Set([y0, ...[1990, 2000, 2010, 2020].filter(y => y > y0 + 2 && y < y1 - 2), y1]));

  return (
    <div style={{ background: "#060d1b", border: "1px solid #ffffff14", borderRadius: "10px", padding: "20px 22px", marginTop: "22px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "14px" }}>
        <div>
          <span style={{ fontSize: "9px", letterSpacing: "1px", color: "#718cb2", fontWeight: 600 }}>TREND DETECTIVE · SIDE BY SIDE</span>
          <h3 style={{ fontSize: "17px", margin: "4px 0 0", color: "#dae2ec" }}>Temperature anomaly, {y0}–{y1}</h3>
          <p style={{ fontSize: "12px", color: "#7087a6", marginTop: "4px" }}>{diagnosis}</p>
        </div>
        <div style={{ display: "flex", gap: "14px", fontSize: "12px", alignItems: "center", flexWrap: "wrap" }}>
          {series.map(s => <span key={s.place.id} title={trendSummary(s.trend)} style={{ color: s.color, display: "flex", alignItems: "center", gap: "6px" }}><i style={{ width: "8px", height: "8px", borderRadius: "50%", background: s.color, display: "inline-block" }}/> {s.place.name} ({s.trend.tempEnough ? `${signed(s.trend.tempSlopePerDecade, 2)}°C/dec${s.trend.tempSignificant ? "" : ", n.s."}` : "too short"})</span>)}
        </div>
      </div>
      <svg viewBox="0 0 500 145" style={{ width: "100%", height: "120px", overflow: "visible" }} role="img" aria-label="Comparative temperature anomaly time series">
        <line x1="0" y1={zeroY} x2="500" y2={zeroY} stroke="#ffffff25" strokeDasharray="3 3"/>
        <text x="4" y={Math.max(12, zeroY - 4)} fill="#6981a3" fontSize="9">0 °C = each place&apos;s first consistent decade</text>
        {series.map(s => <polyline key={s.place.id} points={s.pts.map(p => `${X(p.year)},${Y(p.v)}`).join(" ")} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round"/>)}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", color: "#556b8a", fontSize: "10px", marginTop: "5px" }}>
        {ticks.map(t => <span key={t}>{t}</span>)}
      </div>
      <p style={{ fontSize: "10.5px", color: "#556b8a", marginTop: "8px" }}>n.s. = not statistically significant (p ≥ 0.05, autocorrelation-corrected). Years before a detected data break are excluded.</p>
    </div>
  );
}

/**
 * History chart. Years before a detected data break are shaded and excluded from the trend line;
 * the trend line is solid only when statistically significant.
 */
function ChartPath({ data, metric = "temperature", mode = "absolute" }: { data: ClimateData; metric?: "temperature" | "rainfall"; mode?: "absolute" | "anomaly" }) {
  const annual = data.annual;
  if (annual.length < 2) return null;
  const trend = calculateTrend(annual), h = trend.homogeneity;
  const from = metric === "temperature" ? h.tempFrom : h.rainFrom;
  const values = mode === "anomaly"
    ? calculateAnomalies(annual).map(a => (metric === "temperature" ? a.tempAnomaly : a.rainAnomalyPct))
    : annual.map(a => (metric === "temperature" ? a.temperature : a.rainfall));
  const color = mode === "anomaly" ? (metric === "temperature" ? "#f4ad7e" : "#87b6d5") : (metric === "temperature" ? "#32a6ff" : "#87b6d5");
  const lo = Math.min(...values, ...(mode === "anomaly" ? [0] : [])), hi = Math.max(...values, ...(mode === "anomaly" ? [0] : []));
  const pad = (hi - lo || 1) * 0.08, min = lo - pad, max = hi + pad;
  const X = (i: number) => (i / (annual.length - 1)) * 260, Y = (v: number) => 86 - ((v - min) / (max - min)) * 72;
  const points = values.map((v, i) => `${X(i)},${Y(v)}`).join(" ");
  const firstIdx = Math.max(0, annual.findIndex(a => a.year >= from));
  // Trend over the consistent segment only (same data the significance test used).
  const seg = values.slice(firstIdx), n = seg.length;
  let line: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (n >= 3) {
    const xm = (n - 1) / 2, ym = seg.reduce((s, v) => s + v, 0) / n;
    let sxx = 0, sxy = 0;
    seg.forEach((v, i) => { sxx += (i - xm) ** 2; sxy += (i - xm) * (v - ym); });
    const b = sxx ? sxy / sxx : 0;
    line = { x1: X(firstIdx), y1: Y(ym - b * xm), x2: X(annual.length - 1), y2: Y(ym + b * xm) };
  }
  const significant = metric === "temperature" ? trend.tempSignificant : trend.rainSignificant;
  return <>
    {firstIdx > 0 && <><rect x="0" y="0" width={X(firstIdx)} height="100" fill="#ffffff08"/><line x1={X(firstIdx)} x2={X(firstIdx)} y1="0" y2="100" stroke="#ffa34777" strokeDasharray="2 3"/></>}
    {mode === "anomaly" && <line x1="0" y1={Y(0)} x2="260" y2={Y(0)} stroke="#ffffff30" strokeDasharray="3 3"/>}
    <polygon points={`0,100 ${points} 260,100`} fill="url(#chart-fill)"/>
    <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" opacity={firstIdx > 0 ? 0.9 : 1}/>
    {line && <line {...line} stroke={color} strokeWidth="1.5" strokeDasharray={significant ? "0" : "4 4"} opacity={significant ? 0.85 : 0.45}/>}
    <circle cx="260" cy={Y(values.at(-1)!)} r="3.5" fill={color}/>
  </>;
}
