"use client";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { ChevronRight, CircleHelp, Download, Globe2, LoaderCircle, MapPin, Radar, Sparkles, ArrowUpRight, Languages } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Toaster, toast } from "sonner";
import { PLACES, RECORD_END, RECORD_START, SCENARIO_END, demoClimate, parsePower, type ClimateData, type Layer, type Place } from "@/lib/climate";
import dhakaPower from "@/lib/dhaka-power.json";
import type { ReportRequest } from "@/components/climate-report";
import type { Audience, Lang, ReportInputs } from "@/lib/report/model";
import { parseShare, type SharedReport } from "@/lib/report/share";
import { LangProvider, useI18n } from "@/lib/i18n";
import { installErrorReporting, reportError } from "@/lib/telemetry";
import { FeatureBoundary } from "./error-boundary";
import { AppNav, HEADINGS, NAV, VIEW_PATH, viewFromPath, type View } from "./nav";
import { HeroSky, Headline } from "./hero";
import { PlacePicker } from "./place-picker";
import { ExploreView } from "./explore";
import { CompareView, FutureView, ReportsView, type Report } from "./views";
import { DataDialog, StoryDialog } from "./dialogs";
import { AskEarth, ClimateAtlas, ClimateReport, DisasterMap, SatelliteComparison } from "./lazy";

const INITIAL = parsePower(dhakaPower);
const CACHE = new Map<string, ClimateData>([["dhaka", INITIAL]]);
const REPORTS_KEY = "terra-reports"; // kept from the original name so saved reports survive the rename

/**
 * Scrolls to the top once no dialog/drawer holds the page's scroll lock. The mobile menu (a Radix
 * sheet) restores the old scroll position when it finishes closing, so scrolling earlier would be undone.
 */
function scrollToTopWhenUnlocked(deadline = Date.now() + 1200) {
  const locked = document.body.hasAttribute("data-scroll-locked") || document.querySelector("[data-slot=sheet-content][data-state]");
  if (locked && Date.now() < deadline) { requestAnimationFrame(() => scrollToTopWhenUnlocked(deadline)); return; }
  window.scrollTo({ top: 0, behavior: locked ? "auto" : "smooth" });
}

function useClimate(place: Place, retry: number) {
  const [state, setState] = useState<{ data: ClimateData; loading: boolean; error: boolean }>({ data: INITIAL, loading: false, error: false });
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const cached = CACHE.get(place.id);
    if (cached && retry === 0) { queueMicrotask(() => active && setState({ data: cached, loading: false, error: false })); return () => { active = false; }; }
    queueMicrotask(() => active && setState({ data: demoClimate(place), loading: true, error: false }));
    fetch(`/api/climate?lat=${place.lat}&lon=${place.lon}`, { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(`climate ${r.status}`); return r.json() as Promise<ClimateData>; })
      .then(d => { if (!active) return; CACHE.set(place.id, d); setState({ data: d, loading: false, error: false }); })
      .catch(e => { if (active && !controller.signal.aborted) { setState(s => ({ ...s, loading: false, error: true })); reportError(e, "climate-fetch"); } });
    return () => { active = false; controller.abort(); };
  }, [place, retry]);
  return state;
}

function LanguageSwitch() {
  const { lang, setLang, t } = useI18n();
  return <div className="lang-switch" role="group" aria-label={t("Language")}><Languages size={14}/>
    <button className={lang === "en" ? "on" : ""} aria-pressed={lang === "en"} onClick={() => setLang("en")}>EN</button>
    <button className={lang === "bn" ? "on" : ""} aria-pressed={lang === "bn"} onClick={() => setLang("bn")} lang="bn">বাংলা</button>
  </div>;
}

function App({ initialView }: { initialView: View }) {
  const { t, lang } = useI18n();
  const [view, setView] = useState<View>(initialView);
  const [place, setPlace] = useState(PLACES[0]), [year, setYear] = useState(2025), [playing, setPlaying] = useState(false), [layer, setLayer] = useState<Layer>("Natural color");
  const [warming, setWarming] = useState(1.5), [rainChange, setRainChange] = useState(-10);
  const [dataOpen, setDataOpen] = useState(false), [storyOpen, setStoryOpen] = useState(false), [chatOpen, setChatOpen] = useState(false), [chatMounted, setChatMounted] = useState(false);
  const [retry, setRetry] = useState(0), [reportReq, setReportReq] = useState<ReportRequest | null>(null), [pendingShare, setPendingShare] = useState<SharedReport | null>(null);
  const [reports, setReports] = useState<Report[]>(() => {
    if (typeof window === "undefined") return [];
    try { const saved = JSON.parse(localStorage.getItem(REPORTS_KEY) || "[]"); return Array.isArray(saved) ? saved.filter(r => r?.place?.id && Array.isArray(r?.data?.annual) && r.data.annual.length) : []; } catch { return []; }
  });
  const [other, setOther] = useState(PLACES[3]);
  const { data, loading, error } = useClimate(place, retry);
  const [otherState, setOtherState] = useState<{ id: string; data: ClimateData | null; error: boolean }>({ id: "", data: null, error: false });

  // ---- Page addresses: pushState on navigation, follow the back/forward buttons. ----
  const navigate = useCallback((v: View) => {
    setView(v); if (v === "future") setYear(SCENARIO_END); setPlaying(false);
    if (window.location.pathname !== VIEW_PATH[v]) window.history.pushState({ view: v }, "", VIEW_PATH[v]);
    scrollToTopWhenUnlocked();
  }, []);
  useEffect(() => {
    const onPop = () => { const v = viewFromPath(window.location.pathname); setView(v); setPlaying(false); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => { document.title = view === "explore" ? "EarthScope — Climate Time Machine" : `${t(NAV.find(n => n.id === view)!.title)} · EarthScope`; }, [view, t]);

  const selectPlace = useCallback((p: Place) => { setPlace(p); setPlaying(false); }, []);

  useEffect(() => { installErrorReporting(); }, []);
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => { /* the app works without it */ });
  }, []);

  useEffect(() => { if (!playing) return; const timer = setInterval(() => setYear(v => { if (v >= SCENARIO_END) { setPlaying(false); return SCENARIO_END; } return v + 1; }), 650); return () => clearInterval(timer); }, [playing]);

  // Comparison place (Compare page only).
  useEffect(() => {
    if (view !== "compare") return;
    const controller = new AbortController();
    let active = true;
    const cached = CACHE.get(other.id);
    queueMicrotask(() => active && setOtherState({ id: other.id, data: cached ?? null, error: false }));
    if (!cached) fetch(`/api/climate?lat=${other.lat}&lon=${other.lon}`, { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(); return r.json() as Promise<ClimateData>; })
      .then(d => { if (!active) return; CACHE.set(other.id, d); setOtherState({ id: other.id, data: d, error: false }); })
      .catch(() => { if (active && !controller.signal.aborted) setOtherState({ id: other.id, data: null, error: true }); });
    return () => { active = false; controller.abort(); };
  }, [other, view]);

  // ---- Reports ----
  const busy = !!reportReq;
  const saveReport = () => setReportReq({ base: { place, year, warming, rainChange, climate: data }, lang });
  const openReport = (r: Report) => setReportReq({ base: { place: r.place, year: r.year, warming: r.warming, rainChange: r.rainChange, climate: r.data }, inputs: r.inputs, savedId: r.id, lang: r.lang, audience: r.audience });
  const persistReport = useCallback((inputs: ReportInputs, l: Lang, audience: Audience, id?: string) => {
    const rid = id ?? crypto.randomUUID();
    setReports(prev => {
      const entry: Report = { id: rid, place: inputs.place, year: inputs.year, warming: inputs.warming, rainChange: inputs.rainChange, created: inputs.created, data: inputs.climate, inputs, lang: l, audience };
      const next = [entry, ...prev.filter(x => x.id !== rid)].slice(0, 30);
      try { localStorage.setItem(REPORTS_KEY, JSON.stringify(next)); }
      catch { try { localStorage.setItem(REPORTS_KEY, JSON.stringify(next.slice(0, 10))); } catch { toast.error(t("This browser could not save the report. You can still save it as PDF.")); } }
      return next;
    });
    if (!id) toast.success(t("Report saved to My climate reports"));
    return rid;
  }, [t]);
  const deleteReport = (id: string) => setReports(prev => { const next = prev.filter(r => r.id !== id); try { localStorage.setItem(REPORTS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ } return next; });

  // Share links (?report=…) reopen a report for the same place, year and scenario.
  useEffect(() => {
    const shared = parseShare(new URLSearchParams(window.location.search).get("report"));
    if (!shared) return;
    window.history.replaceState(null, "", VIEW_PATH.reports);
    queueMicrotask(() => { setPlace(shared.place); setYear(shared.year); setWarming(shared.warming); setRainChange(shared.rainChange); setView("reports"); setPendingShare(shared); });
  }, []);
  useEffect(() => {
    if (!pendingShare || loading || data.source !== "NASA POWER" || place.id !== pendingShare.place.id) return;
    queueMicrotask(() => { setReportReq({ base: { place, year: pendingShare.year, warming: pendingShare.warming, rainChange: pendingShare.rainChange, climate: data }, lang: pendingShare.lang, audience: pendingShare.audience }); setPendingShare(null); });
  }, [pendingShare, loading, data, place]);

  // Browser agents (WebMCP): let an assistant select a place and year in the visible explorer.
  useEffect(() => {
    const ctx = (document as unknown as { modelContext?: { registerTool: (tool: unknown, options: { signal: AbortSignal }) => void } }).modelContext;
    if (!ctx?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      ctx.registerTool({
        name: "explore_climate", description: "Select a featured place and year in the visible EarthScope climate explorer.",
        inputSchema: { type: "object", properties: { placeId: { type: "string", enum: PLACES.map(p => p.id) }, year: { type: "integer", minimum: RECORD_START, maximum: SCENARIO_END } }, required: ["placeId", "year"], additionalProperties: false },
        annotations: { readOnlyHint: false },
        execute: async (input: unknown) => {
          const v = input as { placeId: string; year: number }, p = PLACES.find(q => q.id === v.placeId);
          if (!p || !Number.isInteger(v.year) || v.year < RECORD_START || v.year > SCENARIO_END) throw new Error(`Choose a featured place and a year from ${RECORD_START} to ${SCENARIO_END}.`);
          selectPlace(p); setYear(v.year); navigate("explore");
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          return { place: p.name, year: v.year, mode: v.year > RECORD_END ? "scenario" : "historical" };
        },
      }, { signal: lifecycle.signal });
    } catch { /* not supported */ }
    return () => lifecycle.abort();
  }, [selectPlace, navigate]);

  const [title, subtitle] = HEADINGS[view];
  const openChat = () => { setChatMounted(true); setChatOpen(true); };

  return <SidebarProvider style={{ "--sidebar-width": "228px" } as CSSProperties}>
    <AppNav view={view} navigate={navigate} onData={() => setDataOpen(true)}/>
    <div className="app-main">
      <header className="topbar">
        <div className="breadcrumb"><SidebarTrigger className="mobile-nav-trigger"/><span>{t("Workspace")}</span><ChevronRight size={13}/><strong>{t(NAV.find(n => n.id === view)!.title)}</strong></div>
        <div className="topbar-right"><span className="science-badge"><span/> {t("Earth science, made personal")}</span><LanguageSwitch/><button className="help-button" onClick={() => setDataOpen(true)} aria-label={t("Data information")}><CircleHelp size={18}/></button></div>
      </header>
      <main className="workspace">
        <HeroSky view={view} lang={lang}/>
        <div className="page-heading">
          <div><div className="eyebrow"><span/> {t("A LITTLE CURIOSITY. A WORLD OF DISCOVERY.")}</div><Headline text={t(title)}/><p>{t(subtitle)}</p></div>
          <button className="outline-button report-top" disabled={busy || loading} onClick={saveReport}>{busy ? <LoaderCircle className="spin" size={16}/> : <Download size={16}/>} {t("Export report")}</button>
        </div>
        <div className="location-bar">
          <div className="selected-location"><span className="location-symbol"><MapPin size={19}/></span><div><strong>{place.name}<span>, {place.country}</span></strong><small>{Math.abs(place.lat).toFixed(4)}° {place.lat >= 0 ? "N" : "S"}<i/>{Math.abs(place.lon).toFixed(4)}° {place.lon >= 0 ? "E" : "W"}</small></div><span className="location-tag">{year > RECORD_END ? t("FUTURE SCENARIO") : t("YOUR CLIMATE JOURNEY")}</span></div>
          <PlacePicker place={place} onChange={selectPlace}/>
        </div>
        {(loading || error || data.source !== "NASA POWER") && <div className="connection-banner" role="status">{loading ? <LoaderCircle size={14} className="spin"/> : <CircleHelp size={14}/>} {loading ? t("Fetching NASA observations. Values shown while loading are illustrative.") : t("NASA observations are unavailable. Displaying illustrative example data.")}{error && <button onClick={() => setRetry(v => v + 1)}>{t("Retry")}</button>}</div>}

        <FeatureBoundary key={view} name={view} retryLabel={t("Try again")} message={t("This part of EarthScope hit a problem. The rest of the app still works.")}>
        {view === "explore" && <ExploreView place={place} data={data} year={year} setYear={setYear} playing={playing} setPlaying={setPlaying} layer={layer} setLayer={setLayer} warming={warming} rainChange={rainChange} onSelect={selectPlace} navigate={navigate} openStory={() => setStoryOpen(true)}/>}
        {view === "disasters" && <DisasterMap place={place}/>}
        {view === "atlas" && <ClimateAtlas onOpenPlace={p => { selectPlace(p); navigate("explore"); }}/>}
        {view === "satellite" && <section className="content-panel"><div className="section-heading"><div><span className="eyebrow">{t("THE EARTH REMEMBERS")}</span><h2>{t("{place}, then and now.", { place: place.name })}</h2><p>{t("Measured change from NASA satellites: land cover, vegetation, surface heat and like-for-like imagery from the same season.")}</p></div><span className="source-pill"><Radar size={14}/> NASA GIBS · Landsat · Sentinel-2 · MODIS</span></div><SatelliteComparison place={place} large/></section>}
        {view === "future" && <FutureView place={place} data={data} year={year} setYear={setYear} warming={warming} setWarming={setWarming} rainChange={rainChange} setRainChange={setRainChange} onSave={saveReport} busy={busy}/>}
        {view === "compare" && <CompareView place={place} data={data} other={other} setOther={setOther} otherData={otherState.id === other.id ? otherState.data : null} otherError={otherState.id === other.id && otherState.error}/>}
        {view === "reports" && <ReportsView reports={reports} onCreate={saveReport} onOpen={openReport} onDelete={deleteReport} onExplore={() => navigate("explore")} busy={busy}/>}

        </FeatureBoundary>
        <footer className="workspace-footer"><span><Globe2 size={13}/> {t("A changing planet. An informed you.")}</span><button onClick={() => setDataOpen(true)}>{t("Data sources & methodology")} <ArrowUpRight size={13}/></button><span>{t("Made for Earth’s next chapter.")}</span></footer>
      </main>
    </div>
    <button className="ask-earth" onClick={openChat}><Sparkles size={17}/><span>{t("Ask Earth")}</span><span className="ask-shortcut">↗</span></button>
    <DataDialog open={dataOpen} onOpenChange={setDataOpen}/>
    <StoryDialog open={storyOpen} onOpenChange={setStoryOpen} place={place} data={data} year={year} warming={warming} rainChange={rainChange} onSave={saveReport} busy={busy}/>
    {chatMounted && <AskEarth open={chatOpen} onOpenChange={setChatOpen} place={place} data={data} year={year} warming={warming} rainChange={rainChange}/>}
    {reportReq && <ClimateReport request={reportReq} onClose={() => setReportReq(null)} onSave={persistReport}/>}
    <Toaster position="bottom-center" theme="dark" richColors/>
  </SidebarProvider>;
}

export default function ClimateApp({ initialView = "explore" }: { initialView?: View }) {
  return <LangProvider><App initialView={initialView}/></LangProvider>;
}
