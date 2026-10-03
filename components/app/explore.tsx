"use client";
import { useState } from "react";
import { ArrowRight, ArrowUpRight, CloudRain, FlaskConical, Globe2, History, Layers3, Leaf, Maximize2, Pause, Play, ShieldCheck, Sparkles, Sprout, Thermometer, TrendingUp, Waves } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RangeControl as Slider } from "@/components/range-control";
import { RECORD_END, RECORD_START, SCENARIO_END, calculateTrend, homogeneity, observation, periodDelta, periodLabels, signed, trendSummary, trendVerdict, type ClimateData, type Layer, type Place } from "@/lib/climate";
import { useI18n } from "@/lib/i18n";
import { ChartPath, Sparkline } from "./charts";
import { EarthGlobe, SatelliteComparison } from "./lazy";
import type { View } from "./nav";
import { CrossCheckNote } from "./crosscheck";

/* i18n */const LAYERS: Layer[] = ["Natural color", "Temperature", "Rainfall", "Vegetation", "Flood exposure"];/* /i18n */

function MetricCards({ data, year, warming, rainChange }: { data: ClimateData; year: number; warming: number; rainChange: number }) {
  const { t, n, y } = useI18n();
  const last = data.annual.at(-1)!, current = observation(data, year, warming, rainChange), delta = periodDelta(data), p = periodLabels(data), scenario = year > last.year;
  const trend = calculateTrend(data.annual);
  const tempChange = scenario ? current.temperature - last.temperature : delta.temperature;
  const rainChangePct = scenario ? (current.rainfall / last.rainfall - 1) * 100 : delta.rainfall;
  const halfCi = (trend.tempCi95[1] - trend.tempCi95[0]) / 2;
  const sn = (v: number, d = 1) => { const s = signed(v, d); return s.startsWith("+") ? `+${n(Number(s.slice(1)), d)}` : n(Number(s), d); };
  const pval = y(trendSummary(trend).match(/p [<=] [\d.]+/)?.[0] ?? "");
  const fewYears = <span className="muted-text">{t("Too few consistent years for a decade comparison")}</span>;
  return <div className="metrics-grid">
    <article className="metric-card"><div className="metric-label"><Thermometer size={16}/><span>{t("Mean temperature")}</span><span className="metric-year">{y(year)}</span></div><div className="metric-main"><strong>{n(current.temperature, 1)}<em>°C</em></strong><Sparkline values={data.annual.map(a => a.temperature)} color="#38c8ff" fill label={t("Annual temperature sparkline")}/></div><p>{tempChange === null ? fewYears : <><span className="warm-text">{sn(tempChange)}°C</span> {scenario ? t("relative to {year}", { year: y(last.year) }) : t("{a} vs {b}", { a: y(p.recent), b: y(p.base) })}</>}</p></article>
    <article className="metric-card"><div className="metric-label"><CloudRain size={16}/><span>{t("Annual precipitation")}</span><span className="metric-year">{y(year)}</span></div><div className="metric-main"><strong>{n(Math.round(current.rainfall))}<em>{t("mm")}</em></strong><Sparkline values={data.annual.map(a => a.rainfall)} color="#4f9dff" fill label={t("Annual rainfall sparkline")}/></div><p>{rainChangePct === null ? fewYears : <><span className="blue-text">{sn(rainChangePct)}%</span> {scenario ? t("relative to {year}", { year: y(last.year) }) : t("{a} vs {b}", { a: y(p.rainRecent), b: y(p.rainBase) })}</>}</p></article>
    <article className="metric-card"><div className="metric-label"><TrendingUp size={16}/><span>{t("Trend detective")}</span><span className="metric-year">{y(trend.years[0])}–{y(String(trend.years[1]).slice(2))}</span></div><div className="metric-main"><strong>{trend.tempEnough ? sn(trend.tempSlopePerDecade, 2) : "—"}<em>°C/{t("dec")}</em></strong><Sparkline values={data.annual.filter(a => a.year >= trend.years[0]).map(a => a.temperature)} color={trend.tempSignificant ? "#32a6ff" : "#5f86c4"} label={t("Consistent-record temperature sparkline")}/></div><p title={trendSummary(trend)}><span className={trend.tempSignificant ? "lime-text" : "muted-text"}>{t(trendVerdict(trend))}</span> {trend.tempEnough ? `±${n(halfCi, 2)} (${t("95% CI")}) · ${pval}` : ""}</p></article>
    <article className="metric-card"><div className="metric-label"><History size={16}/><span>{t("Climate record")}</span><ShieldCheck size={14}/></div><div className="metric-main"><strong>{n(data.annual.length)}<em>{t("years")}</em></strong><div className="record-bars">{[30, 44, 35, 52, 43, 58, 50, 65, 56, 74, 69, 83].map((v, i) => <i key={i} style={{ height: `${v}%` }}/>)}</div></div><p><span className="lime-text">{y(data.annual[0].year)}–{y(last.year)}</span> {data.source === "NASA POWER" ? (p.breakNote ? t("consistent from {year}", { year: y(trend.years[0]) }) : t("NASA POWER observations")) : t("Illustrative example data")}</p></article>
  </div>;
}

function DataQualityNote({ data }: { data: ClimateData }) {
  const { t, n, y } = useI18n();
  const h = homogeneity(data.annual);
  if (data.source !== "NASA POWER" || (!h.tempBreak && !h.rainBreak)) return null;
  const end = data.annual.at(-1)!.year;
  const sn = (v: number, d: number) => `${v >= 0 ? "+" : "−"}${n(Math.abs(v), d)}`;
  const rain = data.annual.filter(a => a.year >= h.rainFrom), rainMean = rain.reduce((s, a) => s + a.rainfall, 0) / Math.max(1, rain.length);
  const parts = [
    h.tempBreak && t("a {step} °C temperature step in {year}", { step: sn(h.tempBreak.step, 1), year: y(h.tempBreak.year) }),
    h.rainBreak && t("a {pct}% rainfall step in {year}", { pct: sn((h.rainBreak.step / Math.max(1, rainMean)) * 100, 0), year: y(h.rainBreak.year) }),
  ].filter(Boolean).join(t(" and "));
  const used = h.rainFrom !== h.tempFrom
    ? t("so only {a}–{end} is used for temperature and {b}–{end} for rainfall.", { a: y(h.tempFrom), b: y(h.rainFrom), end: y(end) })
    : t("so only {a}–{end} is used.", { a: y(h.tempFrom), end: y(end) });
  return <div className="data-quality-note" role="note"><ShieldCheck size={16}/><p><strong>{t("Data quality check:")}</strong> {t("The NASA POWER record here has {parts} — abrupt, non-climatic jumps typical of a change in the observations the MERRA-2 reanalysis assimilates —", { parts })} {used} {t("Detected automatically with a two-phase regression break test (Lund & Reeves 2002, 99% level).")}</p></div>;
}

export function ExploreView({ place, data, year, setYear, playing, setPlaying, layer, setLayer, warming, rainChange, onSelect, navigate, openStory }: {
  place: Place; data: ClimateData; year: number; setYear: (y: number) => void; playing: boolean; setPlaying: (f: (v: boolean) => boolean) => void;
  layer: Layer; setLayer: (l: Layer) => void; warming: number; rainChange: number; onSelect: (p: Place) => void; navigate: (v: View) => void; openStory: () => void;
}) {
  const { t, n, y } = useI18n();
  const [chartMetric, setChartMetric] = useState<"temperature" | "rainfall">("temperature");
  const [chartMode, setChartMode] = useState<"absolute" | "anomaly">("absolute");
  const delta = periodDelta(data), periods = periodLabels(data), trend = calculateTrend(data.annual), h = homogeneity(data.annual);
  const pval = y(trendSummary(trend).match(/p [<=] [\d.]+/)?.[0] ?? "");
  const fullscreen = () => {
    const el = document.querySelector(".earth-panel");
    if (document.fullscreenElement) document.exitFullscreen();
    else el?.requestFullscreen?.().catch(() => toast.info(t("Fullscreen is not available in this browser.")));
  };
  const pick = (cls: string, on: boolean) => `chart-toggle ${cls}${on ? " on" : ""}`;
  return <>
    <MetricCards data={data} year={year} warming={warming} rainChange={rainChange}/>
    <DataQualityNote data={data}/>
    <CrossCheckNote place={place} data={data}/>
    <div className="explorer-grid">
      <section className="earth-panel">
        <div className="earth-panel-top"><span><Globe2 size={15}/> {t("Planet view")}</span><div><span className="map-mode">{t("3D EARTH")}</span><button aria-label={t("Expand planet view")} onClick={fullscreen}><Maximize2 size={15}/></button></div></div>
        <div className="map-caption"><span className="caption-line"/><span>{t("YOUR WINDOW INTO")}<br/><strong>{t("A changing world.")}</strong></span></div>
        <div className="map-year">{y(year)}<span>{year > RECORD_END ? t("A POSSIBLE FUTURE") : t("A MOMENT IN TIME")}</span></div>
        <EarthGlobe place={place} layer={layer} year={year} onSelect={onSelect}/>
        <div className="map-layer"><Layers3 size={15}/><Select value={layer} onValueChange={v => setLayer(v as Layer)}><SelectTrigger aria-label={t("Earth visualization layer")}><SelectValue>{t(layer)}</SelectValue></SelectTrigger><SelectContent>{LAYERS.map(l => <SelectItem key={l} value={l}>{t(l)}</SelectItem>)}</SelectContent></Select></div>
        <span className="map-credit">{layer === "Natural color" ? t("NASA Blue Marble · Black Marble · VIIRS clouds") : t("Conceptual color theme · not a measured risk map")}</span>
        <div className="timeline">
          <div className="timeline-header"><span><History size={14}/> {t("THE TIME MACHINE")}</span><Tabs value={year <= RECORD_END ? "history" : "future"} onValueChange={v => setYear(v === "history" ? RECORD_END : SCENARIO_END)}><TabsList><TabsTrigger value="history">{t("Historical")}</TabsTrigger><TabsTrigger value="future">{t("Future")}</TabsTrigger></TabsList></Tabs></div>
          <div className="timeline-control">
            <button className={playing ? "play active" : "play"} aria-label={playing ? t("Pause timeline") : t("Play timeline")} onClick={() => { if (year >= SCENARIO_END) setYear(RECORD_START); setPlaying(v => !v); }}>{playing ? <Pause size={15} fill="currentColor"/> : <Play size={15} fill="currentColor"/>}</button>
            <div className="year-track"><Slider aria-label={t("Climate year")} min={RECORD_START} max={SCENARIO_END} step={1} value={[year]} onValueChange={v => { setYear(v[0]); setPlaying(() => false); }}/><div className="year-ticks">{[RECORD_START, 1990, 2000, 2010, 2025, 2040, SCENARIO_END].map(v => <button key={v} className={year === v ? "selected" : ""} style={{ left: `${((v - RECORD_START) / (SCENARIO_END - RECORD_START)) * 100}%` }} onClick={() => { setYear(v); setPlaying(() => false); }}>{y(v)}</button>)}</div></div>
            <span className="year-value">{y(year)}</span>
          </div>
        </div>
      </section>
      <aside className="insight-panel">
        <div className="insight-top"><span className="insight-icon"><Sparkles size={18}/></span><span>{t("THE CLIMATE, EXPLAINED")}</span><span className="small-pill">{t("INSIGHT")}</span></div>
        <h2>{t("A small shift.")}<br/>{t("A bigger story.")}</h2>
        <p>
          {delta.temperature === null ? t("There are not enough consistent years in this record for a decade-to-decade comparison.") : <>{t("In {place}, {recent} averaged", { place: place.name, recent: y(periods.recent) })} <strong>{n(Math.abs(delta.temperature), 2)}°C {delta.temperature >= 0 ? t("warmer") : t("cooler")}</strong> {t("than {base}.", { base: y(periods.base) })}</>}{" "}
          {trend.tempEnough ? (trend.tempSignificant
            ? <>{t("The {a}–{b} trend is", { a: y(trend.years[0]), b: y(trend.years[1]) })} <strong>{n(Number(signed(trend.tempSlopePerDecade, 2)), 2)}°C / {t("decade")}</strong> {t("and statistically significant ({p}).", { p: pval })}</>
            : <>{t("Over {a}–{b} there is", { a: y(trend.years[0]), b: y(trend.years[1]) })} <strong>{t("no statistically clear trend yet")}</strong> {t("— natural year-to-year swings are larger than any steady change.")}</>) : null}
        </p>
        <div className="insight-chart">
          <div className="chart-toggles">
            <div><button className={pick("temp", chartMetric === "temperature")} onClick={() => setChartMetric("temperature")}>{t("Temp (°C)")}</button><span>|</span><button className={pick("rain", chartMetric === "rainfall")} onClick={() => setChartMetric("rainfall")}>{t("Rain (mm)")}</button></div>
            <div><button className={pick("abs", chartMode === "absolute")} onClick={() => setChartMode("absolute")}>{t("Absolute")}</button><span>|</span><button className={pick("anom", chartMode === "anomaly")} onClick={() => setChartMode("anomaly")}>{t("Anomaly")}</button></div>
          </div>
          <svg viewBox="0 0 260 100" role="img" aria-label={t("Climate history from {a} to {b}", { a: y(data.annual[0]?.year), b: y(data.annual.at(-1)!.year) })}><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop stopColor={chartMetric === "temperature" ? (chartMode === "anomaly" ? "#f4ad7e" : "#36a8ff") : "#87b6d5"} stopOpacity=".25"/><stop offset="1" stopColor={chartMetric === "temperature" ? (chartMode === "anomaly" ? "#f4ad7e" : "#36a8ff") : "#87b6d5"} stopOpacity="0"/></linearGradient></defs>{[20, 50, 80].map(v => <line key={v} x1="0" x2="260" y1={v} y2={v} stroke="#ffffff0c" strokeDasharray="3 5"/>)}<ChartPath data={data} metric={chartMetric} mode={chartMode}/></svg>
          <div className="chart-labels"><span>{y(data.annual[0]?.year)}</span><span>{y(data.annual[Math.floor(data.annual.length / 2)]?.year)}</span><span>{y(data.annual.at(-1)!.year)}</span></div>
          {h.tempBreak && <div className="chart-note">{t("Shaded: years before the {year} data break (not used)", { year: y(h.tempBreak.year) })}</div>}
        </div>
        <div className="insight-takeaway"><Sprout size={17}/><p>{t("Trend detectives examine multidecadal slope alongside natural variability to uncover clear climate signals.")}</p></div>
        <button className="lime-button" onClick={openStory}>{t("Read your climate story")} <ArrowUpRight size={17}/></button>
        <span className="insight-footnote">{data.source} · {y(data.annual[0]?.year)}–{y(data.annual.at(-1)!.year)}<br/>{t("Trend {a}–{b}:", { a: y(trend.years[0]), b: y(trend.years[1]) })} {trendSummary(trend)}<br/>{t("Autocorrelation-corrected t-test (effective n = {n})", { n: n(trend.nEff) })}</span>
      </aside>
    </div>
    <div className="discovery-heading"><h2>{t("Go a little deeper")}</h2><span>{t("Big questions. New perspectives.")}</span></div>
    <div className="discovery-grid">
      <article className="discovery-card"><div className="discovery-card-title"><span><Layers3 size={16}/> {t("A VIEW THROUGH TIME")}</span><button aria-label={t("Open satellite comparison")} onClick={() => navigate("satellite")}><ArrowUpRight size={18}/></button></div><SatelliteComparison place={place}/><div className="discovery-card-bottom"><h3>{t("Same place. Different chapter.")}</h3><button onClick={() => navigate("satellite")}>{t("Compare satellite images")} <ArrowRight size={15}/></button></div></article>
      <article className="discovery-card future-teaser"><div className="discovery-card-title"><span><FlaskConical size={16}/> {t("THE POSSIBILITIES AHEAD")}</span><span className="tiny-badge">{t("SCENARIO LAB")}</span></div><div className="future-number"><span>{t("What if it gets")}</span><strong>+{n(warming, 1)}<em>°C</em></strong><span>{t("warmer by 2050?")}</span></div><div className="future-lines"><i/><i/><i/><i/></div><div className="discovery-card-bottom"><h3>{t("The next chapter is unwritten.")}</h3><button onClick={() => navigate("future")}>{t("Explore future scenarios")} <ArrowRight size={15}/></button></div></article>
      <article className="discovery-card action-teaser"><div className="discovery-card-title"><span><Leaf size={16}/> {t("SMALL STEPS. REAL IMPACT.")}</span><ArrowUpRight size={17}/></div><div className="action-list"><div><span><Sprout size={19}/></span><p>{t("Make room for green")}<small>{t("Shade today. Resilience tomorrow.")}</small></p></div><div><span><Waves size={19}/></span><p>{t("Work with water")}<small>{t("Protect natural drainage.")}</small></p></div><div><span><ShieldCheck size={19}/></span><p>{t("Stay one step ahead")}<small>{t("Connect with local early warnings.")}</small></p></div></div><button className="text-link" onClick={openStory}>{t("Your adaptation guide")} <ArrowRight size={15}/></button></article>
    </div>
  </>;
}
