"use client";
// The Future, Compare and Reports pages.
import { ArrowRight, CircleHelp, CloudRain, Download, FileText, History, LoaderCircle, MapPin, Plus, Sparkles, Thermometer, Trash2 } from "lucide-react";
import { RangeControl as Slider } from "@/components/range-control";
import { RECORD_END, calculateTrend, homogeneity, observation, periodDelta, periodLabels, signed, trendSummary, trendVerdict, type ClimateData, type Place } from "@/lib/climate";
import type { Audience, Lang, ReportInputs } from "@/lib/report/model";
import { useI18n } from "@/lib/i18n";
import { ComparativeTrendChart, Sparkline } from "./charts";
import { SeaLevelPanel } from "./lazy";
import { PlacePicker } from "./place-picker";

export type Report = { id: string; place: Place; year: number; warming: number; rainChange: number; created: string; data: ClimateData; inputs?: ReportInputs; lang?: Lang; audience?: Audience };

const useSigned = () => {
  const { n } = useI18n();
  return (v: number, d = 1) => { const s = signed(v, d); return s.startsWith("+") ? `+${n(Number(s.slice(1)), d)}` : n(Number(s), d); };
};

export function FutureView({ place, data, year, setYear, warming, setWarming, rainChange, setRainChange, onSave, busy }: {
  place: Place; data: ClimateData; year: number; setYear: (y: number) => void; warming: number; setWarming: (v: number) => void;
  rainChange: number; setRainChange: (v: number) => void; onSave: () => void; busy: boolean;
}) {
  const { t, n, y } = useI18n();
  const sg = useSigned();
  const current = observation(data, year, warming, rainChange);
  const presets = [{ label: "Lower change", tt: 1, r: 0 }, { label: "Moderate", tt: 1.5, r: -10 }, { label: "Higher change", tt: 3, r: -20 }];
  return <>
    <section className="scenario-grid">
      <div className="content-panel scenario-controls">
        <span className="eyebrow">{t("BUILD YOUR WHAT-IF")}</span><h2>{t("A possible {year}.", { year: y(year) })}</h2>
        <p>{t("Explore simple changes relative to the latest complete observation in {year}.", { year: y(RECORD_END) })}</p>
        <div className="scenario-presets">{presets.map(p => <button key={p.label} className={warming === p.tt && rainChange === p.r ? "selected" : ""} onClick={() => { setWarming(p.tt); setRainChange(p.r); }}>{t(p.label)}</button>)}</div>
        <div className="scenario-control"><label><Thermometer size={17}/> {t("Warming by 2050")} <strong>+{n(warming, 1)}°C</strong></label><Slider aria-label={t("Warming by 2050")} min={0} max={4} step={.1} value={[warming]} onValueChange={v => setWarming(v[0])}/><div><span>{t("No additional warming")}</span><span>+{n(4)}°C</span></div></div>
        <div className="scenario-control"><label><CloudRain size={17}/> {t("Rainfall change by 2050")} <strong>{sg(rainChange, 0)}%</strong></label><Slider aria-label={t("Rainfall change by 2050")} min={-40} max={40} step={1} value={[rainChange]} onValueChange={v => setRainChange(v[0])}/><div><span>−{n(40)}% · {t("Drier")}</span><span>+{n(40)}% · {t("Wetter")}</span></div></div>
        <div className="scenario-control"><label><History size={17}/> {t("Explore year")} <strong>{y(Math.max(2026, year))}</strong></label><Slider aria-label={t("Scenario year")} min={2026} max={2050} step={1} value={[Math.max(2026, year)]} onValueChange={v => setYear(v[0])}/><div><span>{y(2026)}</span><span>{y(2050)}</span></div></div>
        <p className="data-note"><CircleHelp size={17}/> {t("An educational sensitivity experiment, not a CMIP6 projection or a local risk assessment.")}</p>
      </div>
      <div className="scenario-results content-panel">
        <span className="small-pill">{t("YOUR SCENARIO")}</span><h2>{t("{place} in {year}", { place: place.name, year: y(year) })}</h2>
        <div className="scenario-result"><Thermometer size={25}/><div><strong>{n(current.temperature, 1)}<em>°C</em></strong><span>{t("Annual mean temperature")}</span></div></div>
        <div className="scenario-result"><CloudRain size={25}/><div><strong>{n(Math.round(current.rainfall))}<em>{t("mm")}</em></strong><span>{t("Annual precipitation")}</span></div></div>
        <div className="scenario-explainer"><Sparkles size={18}/><p>{warming >= 2 ? t("Higher temperatures can increase heat stress and water demand. The size of the local impact depends on humidity, infrastructure, and people’s exposure.") : t("Even smaller temperature changes can affect daily life. Protecting shade and green spaces is a practical place to start.")} {rainChange < 0 ? t("Lower rainfall could add pressure to water supply; annual totals do not describe drought duration.") : t("Higher annual rainfall does not directly translate to flooding; timing and drainage matter.")}</p></div>
        <button className="lime-button" onClick={onSave} disabled={busy}>{t("Save this scenario")} <Download size={16}/></button>
      </div>
    </section>
    <SeaLevelPanel place={place}/>
  </>;
}

export function CompareView({ place, data, other, setOther, otherData, otherError }: { place: Place; data: ClimateData; other: Place; setOther: (p: Place) => void; otherData: ClimateData | null; otherError: boolean }) {
  const { t, n, y } = useI18n();
  const sg = useSigned();
  return <section className="content-panel">
    <div className="section-heading"><div><span className="eyebrow">{t("SIDE BY SIDE")}</span><h2>{t("Two places. Two perspectives.")}</h2><p>{t("Comparing the same NASA variables and time period.")}</p></div><PlacePicker place={other} onChange={setOther} label="Choose a comparison city"/></div>
    <div className="compare-grid">{[{ p: place, d: data }, { p: other, d: otherData }].map(({ p, d }, i) => {
      const tr = d ? calculateTrend(d.annual) : null, pl = d ? periodLabels(d) : null, dl = d ? periodDelta(d) : null, brk = d ? homogeneity(d.annual).tempBreak : null;
      return <article className="compare-city" key={i}><span className="comparison-index">{y(`0${i + 1}`)}</span><MapPin size={22}/><h2>{p.name}</h2><p>{p.country}</p>
        {d && tr && pl && dl ? <>
          <div className="compare-value"><span>{t("{year} annual temperature", { year: y(RECORD_END) })}</span><strong>{n(observation(d, RECORD_END).temperature, 1)}°C</strong></div>
          <div className="compare-value"><span>{t("{year} precipitation", { year: y(RECORD_END) })}</span><strong>{n(Math.round(observation(d, RECORD_END).rainfall))} {t("mm")}</strong></div>
          <div className="compare-value"><span>{t("Temperature trend {a}–{b}", { a: y(tr.years[0]), b: y(tr.years[1]) })}</span><strong className={tr.tempSignificant ? "lime-text" : "muted-text"} title={trendSummary(tr)}>{tr.tempEnough ? `${sg(tr.tempSlopePerDecade, 2)}°C/${t("dec")}` : "—"} · {t(trendVerdict(tr).replace("Significant ", "").replace(/^./, c => c.toUpperCase()))}</strong></div>
          <div className="compare-value"><span>{t("Change {a} → {b}", { a: y(pl.base) || t("first decade"), b: y(pl.recent) || t("last decade") })}</span><strong className="warm-text">{dl.temperature === null ? "—" : `${sg(dl.temperature, 2)}°C`}</strong></div>
          <Sparkline values={d.annual.map(v => v.temperature)} fill color={i ? "#8ab9d4" : "#32a6ff"}/>
          <small>{d.source} · {y(d.annual[0]?.year)}–{y(d.annual.at(-1)!.year)}{brk ? ` · ${t("data break {year}", { year: y(brk.year) })}` : ""}</small>
        </> : <div className="compare-loading">{otherError ? <><CircleHelp/>{t("NASA data is temporarily unavailable.")}<button className="outline-button" onClick={() => setOther({ ...other })}>{t("Retry")}</button></> : <><LoaderCircle className="spin"/>{t("Loading NASA observations…")}</>}</div>}
      </article>;
    })}</div>
    {otherData && <ComparativeTrendChart place1={place} data1={data} place2={other} data2={otherData}/>}
    <p className="data-note"><CircleHelp size={15}/> {t("Warmer does not automatically mean more vulnerable. Climate risk depends on local exposure, infrastructure, and adaptive capacity.")}</p>
  </section>;
}

export function ReportsView({ reports, onCreate, onOpen, onDelete, onExplore, busy }: { reports: Report[]; onCreate: () => void; onOpen: (r: Report) => void; onDelete: (id: string) => void; onExplore: () => void; busy: boolean }) {
  const { t, n, y, lang } = useI18n();
  const edition = (a?: Audience) => t(a === "student" ? "Student edition" : a === "planner" ? "Planner edition" : "Citizen edition");
  return <section className="content-panel reports-panel">
    <div className="section-heading"><div><span className="eyebrow">{t("YOUR PERSONAL FIELD NOTES")}</span><h2>{t("Saved climate reports")} <span className="count">{n(reports.length)}</span></h2><p>{t("Full climate reports (English or বাংলা, for citizens, students or planners), stored on this device. Open one to preview, save as PDF, download its data or share a link.")}</p></div><button className="lime-button" onClick={onCreate} disabled={busy}><Plus size={16}/> {t("Create current report")}</button></div>
    {reports.length ? <div className="reports-list">{reports.map(r => <article key={r.id}>
      <div className="report-icon"><FileText size={23}/></div>
      <div><h3>{r.place.name} · {y(r.year)}</h3><p>{r.year > RECORD_END ? t("Future scenario") : t("Climate history")} · {new Date(r.created).toLocaleDateString(lang === "bn" ? "bn-BD" : "en-GB")} · {r.inputs ? `${r.lang === "bn" ? "বাংলা" : "English"} · ${edition(r.audience)}` : r.data.source}</p></div>
      <div className="report-actions"><button className="outline-button" disabled={busy} onClick={() => onOpen(r)}><FileText size={15}/> {t("Open")}</button><button className="report-delete" aria-label={t("Delete report for {place}", { place: r.place.name })} onClick={() => onDelete(r.id)}><Trash2 size={15}/></button></div>
    </article>)}</div>
      : <div className="empty-reports"><FileText size={42} strokeWidth={1}/><h3>{t("Your next discovery belongs here.")}</h3><p>{t("Explore a place and export its climate report. You can return to your saved reports anytime in this browser.")}</p><button className="outline-button" onClick={onExplore}>{t("Start exploring")} <ArrowRight size={16}/></button></div>}
  </section>;
}
