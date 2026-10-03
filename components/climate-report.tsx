"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { AlertTriangle, BookOpen, Check, CircleCheck, Download, FileDown, Globe2, Languages, Link2, LoaderCircle, RefreshCw, Save, ShieldAlert, Users, X } from "lucide-react";
import type { ClimateData, Place } from "@/lib/climate";
import { compareLandCover, COVER_META, type CoverGroup } from "@/lib/earth-change";
import { INDEX_META, type IndexKey, type IndexStat } from "@/lib/extremes";
import { HEAT_META } from "@/lib/heat";
import { aqiCategory, WHO_PM25_24H } from "@/lib/air-quality";
import { makeI18n } from "@/lib/i18n";
import { crossCheck } from "@/lib/crosscheck";
import { linearTrend } from "@/lib/stats";
import { buildModel, reportCsv, type Audience, type Lang, type ReportInputs, type ReportModel, type Risk } from "@/lib/report/model";
import { gatherReport, landcoverUrl, REPORT_SPAN, type Step } from "@/lib/report/gather";
import { dateText, DICT, isBangladesh, num, sgn, yr, type Dict } from "@/lib/report/i18n";
import { shareUrl } from "@/lib/report/share";
import { pixels } from "./satellite-compare";

export interface ReportRequest {
  base: { place: Place; year: number; warming: number; rainChange: number; climate: ClimateData };
  inputs?: ReportInputs; // saved snapshot
  savedId?: string;
  lang?: Lang;
  audience?: Audience;
}

const ORDER: CoverGroup[] = ["built", "cropland", "forest", "shrubGrass", "wetland", "water", "barren"];
const PRIORITY: IndexKey[] = ["humidHeatDays", "warmNights", "hotDays", "heavyRainDays", "rx1day", "cdd", "txx", "frostDays"];
const STEPS: Step[] = ["climate", "extremes", "land", "vegetation", "live"];

export default function ClimateReport({ request, onClose, onSave }: {
  request: ReportRequest;
  onClose: () => void;
  onSave: (inputs: ReportInputs, lang: Lang, audience: Audience, id?: string) => string;
}) {
  const [lang, setLang] = useState<Lang>(request.lang ?? "en");
  const [audience, setAudience] = useState<Audience>(request.audience ?? "citizen");
  const [inputs, setInputs] = useState<ReportInputs | null>(request.inputs?.version === 2 ? request.inputs : null);
  const [savedId, setSavedId] = useState<string | undefined>(request.savedId);
  const [steps, setSteps] = useState<Partial<Record<Step, "run" | "done">>>({});
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const [run, setRun] = useState(request.inputs?.version === 2 ? 0 : 1);
  const [safeLoading, setSafeLoading] = useState(false);
  const t = DICT[lang];
  const savedRef = useRef(request.savedId), prefsRef = useRef({ lang, audience });
  useEffect(() => { prefsRef.current = { lang, audience }; }, [lang, audience]);

  // Build (or rebuild) the report from live NASA data.
  useEffect(() => {
    if (!run) return;
    let active = true;
    (async () => {
      setError(false);
      setSteps({});
      try {
        let climate = request.base.climate;
        if (run > 1 || climate.source !== "NASA POWER") {
          const r = await fetch(`/api/climate?lat=${request.base.place.lat}&lon=${request.base.place.lon}`);
          if (r.ok) climate = await r.json();
        }
        const { inputs: next, safeLater } = await gatherReport({ ...request.base, climate }, (s, done) => active && setSteps(p => ({ ...p, [s]: done ? "done" : "run" })));
        if (!active) return;
        setInputs(next);
        const id = onSave(next, lang, audience, savedRef.current);
        savedRef.current = id;
        setSavedId(id);
        setSafeLoading(!!safeLater);
        safeLater?.then(safePlaces => {
          if (!active) return;
          setSafeLoading(false);
          const patched = { ...next, safePlaces };
          setInputs(cur => (cur?.created === next.created ? patched : cur));
          onSave(patched, prefsRef.current.lang, prefsRef.current.audience, savedRef.current);
        });
      } catch {
        if (active) setError(true);
      }
    })();
    return () => { active = false; };
    // lang/audience are saved with the report but must not trigger a rebuild
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", key); };
  }, [onClose]);

  const model = useMemo(() => (inputs ? buildModel(inputs) : null), [inputs]);
  const link = useMemo(() => (typeof window === "undefined" || !inputs ? "" : shareUrl(window.location.origin, { place: inputs.place, year: inputs.year, warming: inputs.warming, rainChange: inputs.rainChange, lang, audience })), [inputs, lang, audience]);

  // Fit A4 pages to the screen width.
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const fit = () => setZoom(Math.min(1, (window.innerWidth - 24) / 820));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const csv = () => {
    if (!model) return;
    const blob = new Blob([reportCsv(model)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `EarthScope-${model.inputs.place.name.replace(/[^a-z0-9]+/gi, "-")}-data.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ } };
  const print = () => {
    const title = document.title;
    if (model) document.title = `EarthScope-${model.inputs.place.name.replace(/[^a-z0-9]+/gi, "-")}-climate-report`;
    window.print();
    document.title = title;
  };
  const changePrefs = (l: Lang, a: Audience) => { setLang(l); setAudience(a); if (inputs && savedId) onSave(inputs, l, a, savedId); };

  return createPortal(
    <div className="rp-overlay" role="dialog" aria-modal="true" aria-label={t.ui.title} lang={lang === "bn" ? "bn" : "en"}>
      <div className="rp-toolbar">
        <div className="rp-tb-title"><Globe2 size={18} /><strong>{t.ui.title}</strong>{model && <span>{model.inputs.place.name}</span>}</div>
        <div className="rp-tb-group" role="group" aria-label={t.ui.language}><Languages size={14} />
          <button className={lang === "en" ? "on" : ""} onClick={() => changePrefs("en", audience)}>English</button>
          <button className={lang === "bn" ? "on" : ""} onClick={() => changePrefs("bn", audience)}>বাংলা</button>
        </div>
        <div className="rp-tb-group" role="group" aria-label={t.ui.audience}><Users size={14} />
          {(["citizen", "student", "planner"] as Audience[]).map(a => <button key={a} className={audience === a ? "on" : ""} title={t.ui[`${a}Hint`]} onClick={() => changePrefs(lang, a)}>{t.ui[a]}</button>)}
        </div>
        <div className="rp-tb-actions">
          <button className="rp-primary" onClick={print} disabled={!model} title={t.ui.printTip}><FileDown size={15} /> {t.ui.pdf}</button>
          <button onClick={csv} disabled={!model}><Download size={15} /> {t.ui.csv}</button>
          <button onClick={copy} disabled={!model}>{copied ? <Check size={15} /> : <Link2 size={15} />} {copied ? t.ui.copied : t.ui.share}</button>
          <button onClick={() => setRun(r => r + 1)} disabled={!model && !error} title={t.ui.refresh}><RefreshCw size={15} /><span className="rp-hide-sm"> {t.ui.refresh}</span></button>
          {savedId && <span className="rp-saved"><Save size={13} /> {t.ui.saved}</span>}
          <button className="rp-close" onClick={onClose} aria-label={t.ui.close}><X size={18} /></button>
        </div>
      </div>
      {model && <p className="rp-tip">{t.ui.printTip} · {t.ui.snapshot} {dateText(lang, model.inputs.created, true)}</p>}

      <div className="rp-scroll">
        {!model ? (
          <div className="rp-progress">
            {error ? <><AlertTriangle size={28} /><p>{t.ui.failed}</p><button onClick={() => setRun(r => r + 1)}><RefreshCw size={15} /> {t.ui.refresh}</button></> : <>
              <LoaderCircle className="spin" size={30} />
              <h3>{t.ui.generating}</h3>
              <ul>{STEPS.map(s => <li key={s} className={steps[s] ?? ""}>{steps[s] === "done" ? <CircleCheck size={15} /> : steps[s] === "run" ? <LoaderCircle className="spin" size={15} /> : <span className="rp-dot" />}{t.ui.steps[s]}</li>)}</ul>
              {request.inputs && request.inputs.version !== 2 && <p className="rp-muted">{t.ui.legacy}</p>}
            </>}
          </div>
        ) : (
          <div className="rp-pages" style={{ zoom }}>
            <Report m={model} t={t} lang={lang} audience={audience} link={link} safeLoading={safeLoading} />
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ============================== The report ============================== */

function Report({ m, t, lang, audience, link, safeLoading }: { m: ReportModel; t: Dict; lang: Lang; audience: Audience; link: string; safeLoading: boolean }) {
  const p = m.inputs.place;
  const pages: { key: string; node: ReactNode }[] = [];
  const citizen = audience === "citizen", student = audience === "student", planner = audience === "planner";
  const n = (v: number, d = 0) => num(lang, v, d), s = (v: number, d = 1) => sgn(lang, v, d), Y = (v: number | string) => yr(lang, v);

  // ---- Findings (shared by cover and summary) ----
  const tr = m.trend, lik = t.lik[m.tempConfidence.likelihood];
  const findings: string[] = [];
  if (!tr.tempEnough) findings.push(t.findings.tooShort({ n: n(m.rank.of) }));
  else if (tr.direction === "warming" || tr.direction === "cooling") findings.push(t.findings[tr.direction]({ lik, place: p.name, from: Y(tr.years[0]), rate: s(tr.tempSlopePerDecade, 2), lo: s(tr.tempCi95[0], 2), hi: s(tr.tempCi95[1], 2) }));
  else findings.push(t.findings.noTrend({ from: Y(tr.years[0]), to: Y(tr.years[1]) }));
  if (m.global && tr.tempEnough) findings.push(t.findings.global({ g: s(m.global.global, 2), ratio: tr.direction === "warming" && m.global.ratio && m.global.ratio >= 1.05 ? n(m.global.ratio, 1) : "" }));
  if (m.rank.temp && m.rank.of >= 10) findings.push(t.findings.rank({ year: Y(m.latest.year), rank: t.ordinal(m.rank.temp), n: n(m.rank.of) }));
  const exPick = (m.extremes ?? []).filter(e => e.relevant && e.firstMean !== null && e.lastMean !== null).sort((a, b) => PRIORITY.indexOf(a.key) - PRIORITY.indexOf(b.key));
  for (const e of exPick.slice(0, citizen ? 1 : 2)) findings.push(t.findings.extreme({ name: t.index.name[e.key], a: n(e.firstMean!, INDEX_META[e.key].decimals), pa: Y(e.firstLabel), b: n(e.lastMean!, INDEX_META[e.key].decimals), pb: Y(e.lastLabel), d: `${s(e.lastMean! - e.firstMean!, INDEX_META[e.key].decimals)} ${t.index.unit[INDEX_META[e.key].unit]}` }));
  if (m.inputs.land && Math.abs(m.inputs.land.b.built - m.inputs.land.a.built) >= 0.5) { const L = m.inputs.land; findings.push(t.findings.land({ a: n(L.a.built, 1), b: n(L.b.built, 1), y0: Y(L.years[0]), y1: Y(L.years[1]), km2: n(Math.round(((L.b.built - L.a.built) / 100) * L.areaKm2)) })); }

  const evText = (key: string, v: Record<string, string | number>) => {
    const f = t.ev[key.replace("ev.", "")];
    if (!f) return "";
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === "index") { out[k] = t.index.name[val as IndexKey] ?? String(val); continue; }
      if (typeof val === "number") out[k] = ["y0", "y1", "from", "to"].includes(k) ? Y(val) : k === "rate" ? s(val, Number.isInteger(val) ? 0 : 1) : k === "change" ? s(val, 0) : n(val, Number.isInteger(val) || Math.abs(val) >= 100 ? 0 : Math.abs(val) < 1 ? 2 : 1);
      else out[k] = k === "period" ? Y(val) : val;
    }
    if (key === "ev.drier") out.rate = n(Math.abs(Number(v.rate)), 0);
    if (key === "ev.trendUp") { const k = v.index as IndexKey; out.rate = `${s(Number(v.rate), 1)} ${t.index.unit[INDEX_META[k]?.unit ?? "days"]}`; }
    return f(out);
  };

  const risks = citizen ? m.risks.slice(0, 4) : m.risks;
  const head = { place: p.name };

  // ---- Page 1: cover ----
  pages.push({ key: "cover", node: <Cover m={m} t={t} lang={lang} audience={audience} findings={findings} /> });

  // ---- Page 2: key findings ----
  pages.push({ key: "findings", node: <>
    <SecHead n={1} title={t.sec.findings} />
    <ul className="rp-findings">{findings.map((f, i) => <li key={i}>{f}</li>)}</ul>
    {m.isScenario && <div className="rp-callout scenario">{t.scenario({ year: Y(m.inputs.year), t: n(m.shown.temperature, 1), r: n(Math.round(m.shown.rainfall)), w: s(m.inputs.warming, 1), rc: s(m.inputs.rainChange, 0) })}</div>}
    <div className="rp-two">
      <div className="rp-glance">
        <h4>{t.glance.title}</h4>
        <dl>
          <dt>{t.glance.meanT} {Y(m.latest.year)}</dt><dd>{n(m.latest.temperature, 1)} °{lang === "bn" ? "সে" : "C"}</dd>
          <dt>{t.glance.rain} {Y(m.latest.year)}</dt><dd>{n(Math.round(m.latest.rainfall))} {t.index.unit.mm}</dd>
          <dt>{t.glance.trend}</dt><dd>{tr.tempEnough ? `${s(tr.tempSlopePerDecade, 2)} ${t.record.perDecade}` : "—"}</dd>
          <dt>{t.glance.confidence}</dt><dd>{tr.tempEnough ? t.lik[m.tempConfidence.likelihood] : "—"}</dd>
          {m.rank.temp && <><dt>{t.glance.rank}</dt><dd>{t.ordinal(m.rank.temp)} / {n(m.rank.of)}</dd></>}
          {m.global?.ratio && tr.direction === "warming" && <><dt>{t.glance.vsGlobal}</dt><dd>{n(m.global.ratio, 1)}×</dd></>}
          <dt>{t.glance.period}</dt><dd>{Y(m.consistentFrom.temp)}–{Y(m.latest.year)}</dd>
        </dl>
      </div>
      <div className="rp-toprisks">
        <h4>{t.findings.topRisks}</h4>
        {m.risks.length ? m.risks.slice(0, 4).map(r => <div key={r.id} className={`rp-riskchip ${r.level}`}><b>{t.risk.level[r.level]}</b>{t.risk.name[r.id]}</div>) : <p className="rp-muted">{t.findings.noRisks}</p>}
      </div>
    </div>
    <Quality m={m} t={t} lang={lang} />
  </> });

  // ---- Page 3: the climate record ----
  pages.push({ key: "record", node: <>
    <SecHead n={2} title={t.sec.record} />
    <Figure title={`${t.record.tempTitle} (°${lang === "bn" ? "সে" : "C"})`} note={m.delta.temperature !== null ? t.record.decade({ a: n(avg(m.annual.filter(a => a.year >= m.consistentFrom.temp).slice(0, 10).map(a => a.temperature)), 2), pa: Y(m.periods.base), b: n(avg(m.annual.slice(-10).map(a => a.temperature)), 2), pb: Y(m.periods.recent), d: `${s(m.delta.temperature, 2)} °${lang === "bn" ? "সে" : "C"}` }) : undefined}>
      <RecordChart m={m} t={t} lang={lang} kind="temperature" />
    </Figure>
    {student && <How t={t}>{t.record.howTemp}</How>}
    {!citizen && <Figure title={`${t.record.rainTitle} (${t.index.unit.mm})`} note={m.delta.rainfall !== null ? t.record.decade({ a: n(Math.round(avg(m.annual.filter(a => a.year >= m.consistentFrom.rain).slice(0, 10).map(a => a.rainfall)))), pa: Y(m.periods.rainBase), b: n(Math.round(avg(m.annual.slice(-10).map(a => a.rainfall)))), pb: Y(m.periods.rainRecent), d: `${s(m.delta.rainfall, 0)}%` }) : undefined}>
      <RecordChart m={m} t={t} lang={lang} kind="rainfall" />
    </Figure>}
    {m.global && <Figure title={`${t.record.globalTitle} (${t.record.perDecade}, ${Y(m.global.from)}–${Y(m.global.to)})`}><RateChart m={m} t={t} lang={lang} /></Figure>}
    {student && m.global && <How t={t}>{t.record.howGlobal}</How>}
    {planner && <StatsTable m={m} t={t} lang={lang} />}
  </> });

  // ---- Page 4: extremes ----
  const exShown = (m.extremes ?? []).filter(e => e.relevant).sort((a, b) => PRIORITY.indexOf(a.key) - PRIORITY.indexOf(b.key)).slice(0, citizen ? 4 : 6);
  pages.push({ key: "extremes", node: <>
    <SecHead n={3} title={t.sec.extremes} />
    <p className="rp-lead">{t.ex.intro}</p>
    {m.extremes ? <>
      <div className="rp-exgrid">{exShown.map(e => <ExtremeCard key={e.key} e={e} m={m} t={t} lang={lang} student={student} />)}</div>
      {student && <How t={t}>{t.ex.how}</How>}
      {planner && <ExtremesTable m={m} t={t} lang={lang} />}
      <p className="rp-note">{t.ex.caveat}</p>
    </> : <p className="rp-muted">{t.ex.unavailable}</p>}
  </> });

  // ---- Page 5: land change ----
  pages.push({ key: "land", node: <>
    <SecHead n={4} title={t.sec.land} />
    {m.inputs.land ? <LandSection m={m} t={t} lang={lang} student={student} /> : <p className="rp-muted">{t.land.unavailable}</p>}
  </> });

  // ---- Page 6: risks & actions ----
  pages.push({ key: "risks", node: <>
    <SecHead n={5} title={t.sec.risks} />
    {risks.length ? risks.map(r => <RiskCard key={r.id} r={r} t={t} audience={audience} evText={evText} />) : <p className="rp-muted">{t.risk.none}</p>}
  </> });

  // ---- Page 7: right now ----
  pages.push({ key: "now", node: <>
    <SecHead n={6} title={t.sec.now} />
    <NowSection m={m} t={t} lang={lang} safeLoading={safeLoading} />
  </> });

  // ---- Page 8: methods, sources, share ----
  pages.push({ key: "methods", node: <>
    <SecHead n={7} title={t.sec.methods} />
    <MethodsSection m={m} t={t} lang={lang} audience={audience} link={link} />
  </> });

  return <>{pages.map((pg, i) => (
    <section key={pg.key} className={`rp-page ${pg.key === "cover" ? "rp-cover-page" : ""} ${lang === "bn" ? "rp-bn" : ""}`}>
      {pg.key === "cover" ? pg.node : <div className="rp-body">{pg.node}</div>}
      {pg.key !== "cover" && <footer className="rp-foot"><span>{t.footer(head)}</span><span>{t.page} {Y(i + 1)} / {Y(pages.length)}</span></footer>}
    </section>
  ))}</>;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

function SecHead({ n, title }: { n: number; title: string }) {
  return <header className="rp-sechead"><span>{String(n).padStart(2, "0")}</span><h2>{title}</h2></header>;
}
function Figure({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return <figure className="rp-figure"><figcaption>{title}</figcaption>{children}{note && <p className="rp-fignote">{note}</p>}</figure>;
}
function How({ t, children }: { t: Dict; children: ReactNode }) {
  return <aside className="rp-how"><BookOpen size={14} /><div><b>{t.sec.howToRead}</b><p>{children}</p></div></aside>;
}

/* ------------------------------ Cover ------------------------------ */
function Cover({ m, t, lang, audience, findings }: { m: ReportModel; t: Dict; lang: Lang; audience: Audience; findings: string[] }) {
  const p = m.inputs.place, c = m.inputs.cover;
  const src = c ? `/api/imagery?lat=${p.lat}&lon=${p.lon}&date=${c.date}&layer=hls&sensor=${c.sensor}&span=${REPORT_SPAN}&size=1200` : null;
  const sensor = c?.sensor === "S30" ? "Sentinel-2" : "Landsat 8/9";
  return <div className="rp-cover">
    <div className="rp-cover-top">
      <div className="rp-logo"><span className="rp-logo-mark"><Globe2 size={18} /></span><span>Earth<b>Scope</b></span></div>
      <span className="rp-edition">{t.cover.edition[audience]}</span>
    </div>
    <div className="rp-cover-hero">
      <div>
        <span className="rp-kicker">{t.cover.kicker}</span>
        <h1>{p.name}</h1>
        <p className="rp-cover-place">{p.country} · {Math.abs(p.lat).toFixed(3)}°{p.lat >= 0 ? "N" : "S"}, {Math.abs(p.lon).toFixed(3)}°{p.lon >= 0 ? "E" : "W"}</p>
        <p className="rp-cover-sub">{t.cover.sub}</p>
      </div>
      <div className="rp-cover-img">
        {src ? <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={t.cover.scene(sensor, c!.date)} />
          <span>{t.cover.scene(sensor, dateText(lang, c!.date + "T00:00:00Z"))}</span>
        </> : <div className="rp-cover-ph"><Globe2 size={64} strokeWidth={1} /></div>}
      </div>
    </div>
    <div className="rp-cover-stats">
      <div><small>{t.glance.meanT} {yr(lang, m.latest.year)}</small><strong>{num(lang, m.latest.temperature, 1)}°</strong></div>
      <div><small>{t.glance.trend}</small><strong>{m.trend.tempEnough ? sgn(lang, m.trend.tempSlopePerDecade, 2) : "—"}<em>{m.trend.tempEnough ? t.record.perDecade : ""}</em></strong></div>
      <div><small>{t.findings.topRisks}</small><strong className="rp-cover-risk">{m.risks[0] ? t.risk.name[m.risks[0].id] : "—"}</strong></div>
    </div>
    <p className="rp-cover-lead">{findings[0]}</p>
    {m.isScenario && <p className="rp-cover-scn">{t.cover.scenario} {yr(lang, m.inputs.year)}</p>}
    <div className="rp-cover-foot"><span>{t.cover.prepared}: {dateText(lang, m.inputs.created)}</span><span>NASA POWER · MODIS · HLS · GISTEMP</span></div>
  </div>;
}

/* --------------------------- Data quality --------------------------- */
function Quality({ m, t, lang }: { m: ReportModel; t: Dict; lang: Lang }) {
  if (m.demo) return <div className="rp-callout warn"><ShieldAlert size={15} /> {t.quality.demo}</div>;
  const h = m.trend.homogeneity, parts: string[] = [];
  if (h.tempBreak) parts.push(t.quality.tStep({ step: sgn(lang, h.tempBreak.step, 1), year: yr(lang, h.tempBreak.year) }));
  if (h.rainBreak) {
    const rows = m.annual.filter(a => a.year >= h.rainFrom), mean = avg(rows.map(r => r.rainfall));
    parts.push(t.quality.rStep({ step: sgn(lang, (h.rainBreak.step / Math.max(1, mean)) * 100, 0), year: yr(lang, h.rainBreak.year) }));
  }
  const and = lang === "bn" ? " এবং " : " and ";
  const c = m.inputs.era5 ? crossCheck(m.annual, m.inputs.era5, h.tempFrom) : null;
  const ft = (v: number | null) => (v === null ? "—" : sgn(lang, v, 2));
  const era5 = c ? t.quality.era5({ r: num(lang, c.tempR, 2), from: yr(lang, c.years[0]), to: yr(lang, c.years[1]), p: ft(c.powerTrend), e: ft(c.era5Trend), full: h.tempBreak && !c.era5Break && c.era5FullTrend ? ft(c.era5FullTrend.perDecade) : "", start: c.era5FullTrend ? yr(lang, c.era5FullTrend.from) : "" }) : "";
  return <div className="rp-callout quality"><b>{t.quality.title}</b> {parts.length ? t.quality.step({ parts: parts.join(and), from: yr(lang, h.tempFrom), to: yr(lang, m.latest.year), rain: h.rainFrom !== h.tempFrom ? yr(lang, h.rainFrom) : "" }) : t.quality.none}{era5 && <> {era5}</>}</div>;
}

/* ------------------------------ Charts ------------------------------ */
const W = 640, H = 200, PAD = { l: 44, r: 12, t: 12, b: 26 };

function RecordChart({ m, t, lang, kind }: { m: ReportModel; t: Dict; lang: Lang; kind: "temperature" | "rainfall" }) {
  const rows = m.annual, from = kind === "temperature" ? m.consistentFrom.temp : m.consistentFrom.rain;
  const vals = rows.map(r => r[kind]);
  const lo = Math.min(...vals), hi = Math.max(...vals), padv = (hi - lo) * 0.12 || 1;
  const y0 = kind === "rainfall" ? 0 : lo - padv, y1 = hi + padv;
  const x = (yv: number) => PAD.l + ((yv - rows[0].year) / Math.max(1, rows[rows.length - 1].year - rows[0].year)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);
  const cons = rows.filter(r => r.year >= from);
  const lt = cons.length >= 15 ? linearTrend(cons.map(r => r.year), cons.map(r => r[kind])) : null;
  const ticks = niceTicks(y0, y1, 4);
  const xTicks = rows.filter(r => r.year % 5 === 0).map(r => r.year);
  const bw = Math.max(2, (W - PAD.l - PAD.r) / rows.length - 3);
  let band = "";
  if (lt) {
    const xm = avg(cons.map(r => r.year)), ym = avg(cons.map(r => r[kind])), a = cons[0].year, b = cons[cons.length - 1].year;
    const f = (yy: number, sl: number) => ym + sl * (yy - xm);
    // Bow-tie: every line through the mean point whose slope lies within the 95% range.
    band =`${x(a)},${y(f(a, lt.ci95[1]))} ${x(xm)},${y(ym)} ${x(b)},${y(f(b, lt.ci95[1]))} ${x(b)},${y(f(b, lt.ci95[0]))} ${x(xm)},${y(ym)} ${x(a)},${y(f(a, lt.ci95[0]))}`;
  }
  return <svg viewBox={`0 0 ${W} ${H}`} className="rp-chart" role="img" aria-label={kind === "temperature" ? t.record.tempTitle : t.record.rainTitle}>
    {ticks.map(v => <g key={v}><line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="grid" /><text x={PAD.l - 6} y={y(v) + 3} className="ax" textAnchor="end">{num(lang, v, kind === "temperature" && (ticks[1] - ticks[0]) < 1 ? 1 : 0)}</text></g>)}
    {xTicks.map(v => <text key={v} x={x(v)} y={H - 8} className="ax" textAnchor="middle">{yr(lang, v)}</text>)}
    {from > rows[0].year && <g><rect x={PAD.l} y={PAD.t} width={x(from) - PAD.l - (kind === "rainfall" ? bw / 2 : 0)} height={H - PAD.t - PAD.b} className="excl" /><line x1={x(from) - (kind === "rainfall" ? bw / 2 + 1 : 4)} x2={x(from) - (kind === "rainfall" ? bw / 2 + 1 : 4)} y1={PAD.t} y2={H - PAD.b} className="brk" /></g>}
    {kind === "rainfall"
      ? rows.map(r => <rect key={r.year} x={x(r.year) - bw / 2} y={y(r.rainfall)} width={bw} height={y(0) - y(r.rainfall)} className={r.year >= from ? "bar" : "bar off"} />)
      : <>
          {band && <polygon points={band} className="band" />}
          <polyline points={cons.map(r => `${x(r.year)},${y(r.temperature)}`).join(" ")} className="line" />
          {rows.map(r => <circle key={r.year} cx={x(r.year)} cy={y(r.temperature)} r={3} className={r.year >= from ? "dot" : "dot off"} />)}
        </>}
    {lt && <line x1={x(cons[0].year)} x2={x(cons[cons.length - 1].year)} y1={y(lt.intercept + lt.slope * cons[0].year)} y2={y(lt.intercept + lt.slope * cons[cons.length - 1].year)} className={lt.significant ? "trend" : "trend weak"} />}
    <g className="legend" transform={`translate(${PAD.l + 6}, ${PAD.t + 10})`}>
      {from > rows[0].year && <><rect width="10" height="8" className="excl-key" /><text x="14" y="8">{t.record.excluded}</text></>}
      <g transform={`translate(${from > rows[0].year ? 190 : 0},0)`}><line x1="0" x2="16" y1="4" y2="4" className="trend" /><text x="20" y="8">{t.record.trendLine}{kind === "temperature" && band ? ` · ${t.record.band}` : ""}</text></g>
    </g>
  </svg>;
}

function RateChart({ m, t, lang }: { m: ReportModel; t: Dict; lang: Lang }) {
  const g = m.global!;
  const items = [{ label: t.record.local, v: g.local, ci: g.localCi, cls: "local" }, { label: t.record.globalBar, v: g.global, ci: g.globalCi, cls: "global" }, { label: t.record.arctic, v: g.arctic, ci: null, cls: "arctic" }];
  const max = Math.max(0.1, ...items.map(i => Math.abs(i.ci ? Math.max(Math.abs(i.ci[0]), Math.abs(i.ci[1])) : i.v))) * 1.1;
  const min = Math.min(0, ...items.map(i => (i.ci ? i.ci[0] : i.v))) * 1.1;
  const L = 150, R = W - 60, x = (v: number) => L + ((v - min) / (max - min)) * (R - L);
  return <svg viewBox={`0 0 ${W} 120`} className="rp-chart" role="img" aria-label={t.record.globalTitle}>
    <line x1={x(0)} x2={x(0)} y1="6" y2="112" className="zero" />
    {items.map((it, i) => { const yy = 18 + i * 34; return <g key={it.cls}>
      <text x={L - 10} y={yy + 5} textAnchor="end" className="lbl">{it.label}</text>
      <rect x={Math.min(x(0), x(it.v))} y={yy - 9} width={Math.abs(x(it.v) - x(0))} height="18" rx="3" className={`rate ${it.cls}`} />
      {it.ci && <><line x1={x(it.ci[0])} x2={x(it.ci[1])} y1={yy} y2={yy} className="whisk" /><line x1={x(it.ci[0])} x2={x(it.ci[0])} y1={yy - 5} y2={yy + 5} className="whisk" /><line x1={x(it.ci[1])} x2={x(it.ci[1])} y1={yy - 5} y2={yy + 5} className="whisk" /></>}
      <text x={Math.max(x(it.v), it.ci ? x(it.ci[1]) : 0) + 6} y={yy + 4} className="val">{sgn(lang, it.v, 2)}</text>
    </g>; })}
  </svg>;
}

function niceTicks(a: number, b: number, n: number) {
  const step0 = (b - a) / n, mag = 10 ** Math.floor(Math.log10(step0)), step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(k => k >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

/* ----------------------------- Extremes ----------------------------- */
function ExtremeCard({ e, m, t, lang, student }: { e: IndexStat; m: ReportModel; t: Dict; lang: Lang; student: boolean }) {
  const meta = INDEX_META[e.key], years = m.inputs.extremes!.years;
  const vals = years.map(y => y[e.key]), max = Math.max(1, ...vals), min = e.key === "txx" ? Math.min(...vals) - 1 : 0;
  const w = 300, h = 96, l = 4, r = 4, top = 6, bot = 14, bw = (w - l - r) / years.length;
  const y = (v: number) => top + (1 - (v - min) / (max - min)) * (h - top - bot);
  const c = m.extremeConfidence[e.key], unit = t.index.unit[meta.unit], d = meta.decimals;
  const change = e.firstMean !== null && e.lastMean !== null ? e.lastMean - e.firstMean : null;
  return <div className="rp-excard">
    <h5>{t.index.name[e.key]}</h5>
    {student && <p className="rp-exexp">{t.index.explain[e.key]}</p>}
    <svg viewBox={`0 0 ${w} ${h}`} className="rp-chart mini" role="img" aria-label={t.index.name[e.key]}>
      {years.map((yv, i) => <rect key={yv.year} x={l + i * bw + 0.5} y={y(vals[i])} width={Math.max(1, bw - 1)} height={Math.max(0, y(min) - y(vals[i]))} className={yv.year >= e.from ? "bar" : "bar off"} />)}
      {e.firstMean !== null && <line x1={l} x2={w - r} y1={y(e.firstMean)} y2={y(e.firstMean)} className="dec first" />}
      {e.lastMean !== null && <line x1={l} x2={w - r} y1={y(e.lastMean)} y2={y(e.lastMean)} className="dec last" />}
      <text x={l} y={h - 2} className="ax">{yr(lang, years[0].year)}</text><text x={w - r} y={h - 2} className="ax" textAnchor="end">{yr(lang, years[years.length - 1].year)}</text>
    </svg>
    {change !== null ? <div className="rp-exnums">
      <span><small>{t.ex.first}</small>{num(lang, e.firstMean!, d)}</span>
      <span><small>{t.ex.last}</small><b>{num(lang, e.lastMean!, d)}</b></span>
      <span className={change > 0 ? "up" : change < 0 ? "down" : ""}><small>{t.ex.change}</small>{sgn(lang, change, d)} {unit}</span>
    </div> : <p className="rp-muted small">{t.ex.none}</p>}
    {e.trend && c && <p className="rp-exlik">{t.ex.trend}: {sgn(lang, e.trend.perDecade, 1)} {unit} · {t.lik[c.likelihood]}</p>}
  </div>;
}

function ExtremesTable({ m, t, lang }: { m: ReportModel; t: Dict; lang: Lang }) {
  return <table className="rp-table"><thead><tr><th>ETCCDI</th><th>{t.ex.first}</th><th>{t.ex.last}</th><th>{t.record.slope}/10y</th><th>{t.record.ci}</th><th>{t.record.p}</th></tr></thead><tbody>
    {(m.extremes ?? []).filter(e => e.relevant).map(e => <tr key={e.key}><td>{INDEX_META[e.key].etccdi} · {t.index.name[e.key]}</td><td>{e.firstMean !== null ? num(lang, e.firstMean, 1) : "—"}</td><td>{e.lastMean !== null ? num(lang, e.lastMean, 1) : "—"}</td><td>{e.trend ? sgn(lang, e.trend.perDecade, 2) : "—"}</td><td>{e.trend ? `${sgn(lang, e.trend.ci95Decade[0], 2)} … ${sgn(lang, e.trend.ci95Decade[1], 2)}` : "—"}</td><td>{e.trend ? num(lang, e.trend.pValue, 3) : "—"}</td></tr>)}
  </tbody></table>;
}

function StatsTable({ m, t, lang }: { m: ReportModel; t: Dict; lang: Lang }) {
  const tr = m.trend;
  return <table className="rp-table"><caption>{t.record.stats}</caption><thead><tr><th></th><th>{t.record.slope}</th><th>{t.record.ci}</th><th>{t.record.p}</th><th>{t.record.lik}</th><th>{t.glance.period}</th></tr></thead><tbody>
    <tr><td>{t.record.tempTitle}</td><td>{sgn(lang, tr.tempSlopePerDecade, 3)} °C/10y</td><td>{sgn(lang, tr.tempCi95[0], 3)} … {sgn(lang, tr.tempCi95[1], 3)}</td><td>{num(lang, tr.tempPValue, 3)}</td><td>{t.lik[m.tempConfidence.likelihood]}</td><td>{yr(lang, tr.years[0])}–{yr(lang, tr.years[1])} (n<sub>eff</sub> {num(lang, tr.nEff, 1)}, R² {num(lang, tr.rSquared, 2)})</td></tr>
    <tr><td>{t.record.rainTitle}</td><td>{sgn(lang, tr.rainSlopePerDecade, 0)} mm/10y</td><td>{sgn(lang, tr.rainCi95[0], 0)} … {sgn(lang, tr.rainCi95[1], 0)}</td><td>{num(lang, tr.rainPValue, 3)}</td><td>{t.lik[m.rainConfidence.likelihood]}</td><td>{yr(lang, tr.rainYears[0])}–{yr(lang, tr.rainYears[1])}</td></tr>
  </tbody></table>;
}

/* ------------------------------- Land ------------------------------- */
function LandSection({ m, t, lang, student }: { m: ReportModel; t: Dict; lang: Lang; student: boolean }) {
  const L = m.inputs.land!, p = m.inputs.place, nd = m.inputs.ndvi;
  const a = landcoverUrl(p, L.years[0]), b = landcoverUrl(p, L.years[1]);
  const [overlay, setOverlay] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all([pixels(a, 512), pixels(b, 512)]).then(([A, B]) => {
      const c = compareLandCover(A, B, L.areaKm2), cv = document.createElement("canvas");
      cv.width = B.width; cv.height = B.height;
      const ctx = cv.getContext("2d")!;
      ctx.putImageData(B, 0, 0);
      ctx.fillStyle = "rgba(6,12,28,0.72)"; ctx.fillRect(0, 0, cv.width, cv.height);
      const tmp = document.createElement("canvas"); tmp.width = cv.width; tmp.height = cv.height; tmp.getContext("2d")!.putImageData(c.overlay, 0, 0);
      ctx.drawImage(tmp, 0, 0);
      if (active) setOverlay(cv.toDataURL("image/png"));
    }).catch(() => {});
    return () => { active = false; };
  }, [a, b, L.areaKm2]);
  return <>
    <p className="rp-lead">{t.land.intro({ km: num(lang, Math.round((REPORT_SPAN * 110.57) / 5) * 5), place: p.name })}</p>
    <div className="rp-maps">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <figure><img src={a} alt={`${yr(lang, L.years[0])}`} /><figcaption>{yr(lang, L.years[0])}</figcaption></figure>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <figure><img src={b} alt={`${yr(lang, L.years[1])}`} /><figcaption>{yr(lang, L.years[1])}</figcaption></figure>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <figure>{overlay ? <img src={overlay} alt={t.land.changeMap} /> : <div className="rp-mapph"><LoaderCircle className="spin" size={18} /></div>}<figcaption>{t.land.changeMap}</figcaption></figure>
    </div>
    <div className="rp-legend">
      {ORDER.filter(g => L.a[g] >= 0.3 || L.b[g] >= 0.3).map(g => <span key={g}><i style={{ background: COVER_META[g].color }} />{t.cover_groups[g]}</span>)}
      <span className="sep" />
      <span><i style={{ background: "#ff3b30" }} />{t.land.built}</span><span><i style={{ background: "#ff9500" }} />{t.land.lostVeg}</span><span><i style={{ background: "#34c759" }} />{t.land.gainedVeg}</span><span><i style={{ background: "#409cff" }} />{t.land.water}</span>
    </div>
    {student && <How t={t}>{t.land.how}</How>}
    <div className="rp-coverbars">
      {[{ y: L.years[0], s: L.a }, { y: L.years[1], s: L.b }].map(row => <div key={row.y} className="rp-cbrow"><span>{yr(lang, row.y)}</span><div className="rp-cbar">{ORDER.filter(g => row.s[g] > 0.2).map(g => <i key={g} style={{ width: `${row.s[g]}%`, background: COVER_META[g].color }} title={`${t.cover_groups[g]} ${num(lang, row.s[g], 1)}%`}>{row.s[g] >= 7 ? `${num(lang, row.s[g], 0)}%` : ""}</i>)}</div></div>)}
    </div>
    <table className="rp-table compact"><thead><tr><th></th><th>{yr(lang, L.years[0])}</th><th>{yr(lang, L.years[1])}</th><th>Δ</th></tr></thead><tbody>
      {ORDER.filter(g => L.a[g] >= 0.3 || L.b[g] >= 0.3).map(g => <tr key={g}><td><i className="sw" style={{ background: COVER_META[g].color }} />{t.cover_groups[g]}</td><td>{num(lang, L.a[g], 1)}%</td><td>{num(lang, L.b[g], 1)}%</td><td className={Math.abs(L.b[g] - L.a[g]) < 1 ? "" : L.b[g] > L.a[g] ? "up" : "down"}>{sgn(lang, L.b[g] - L.a[g], 1)}</td></tr>)}
    </tbody></table>
    <p className="rp-note">{t.land.changed({ pct: num(lang, L.changedPct, 1), built: num(lang, L.toBuiltPct, 1) })} {m.inputs.regionWaterPct !== null ? t.land.region({ pct: num(lang, m.inputs.regionWaterPct, 0) }) : ""}</p>
    {nd && <div className="rp-ndvi">
      <h4>{t.land.ndviTitle} · {t.months[nd.month - 1]} {yr(lang, nd.years[0])} → {yr(lang, nd.years[1])}</h4>
      <div className="rp-ndvigrid">
        <div><small>NDVI</small><b>{num(lang, nd.meanA, 2)} → {num(lang, nd.meanB, 2)}</b></div>
        <div><small>{t.land.dense}</small><b>{num(lang, nd.denseA, 0)}% → {num(lang, nd.denseB, 0)}%</b></div>
        <div><small>{t.land.greener}</small><b className="down">{num(lang, nd.greenerPct, 0)}%</b></div>
        <div><small>{t.land.browner}</small><b className="up">{num(lang, nd.brownerPct, 0)}%</b></div>
      </div>
    </div>}
    <p className="rp-note">{t.land.accuracy}</p>
  </>;
}

/* ------------------------------- Risks ------------------------------- */
function RiskCard({ r, t, audience, evText }: { r: Risk; t: Dict; audience: Audience; evText: (k: string, v: Record<string, string | number>) => string }) {
  const voice = audience === "planner" ? "planner" : "citizen";
  return <article className={`rp-risk ${r.level}`}>
    <header><span className="rp-level">{t.risk.level[r.level]}</span><h3>{t.risk.name[r.id]}</h3></header>
    <p className="rp-what">{t.risk.what[voice][r.id]}</p>
    <div className="rp-riskcols">
      <div><h6>{t.risk.evidence}</h6><ul>{r.evidence.map((e, i) => <li key={i}>{evText(e.key, e.values)} <cite>{e.source}</cite></li>)}</ul></div>
      <div><h6>{t.risk.actions}</h6><ol>{t.risk.act[voice][r.id].map((a, i) => <li key={i}>{a}</li>)}</ol></div>
    </div>
  </article>;
}

/* ------------------------------ Right now ------------------------------ */
function NowSection({ m, t, lang, safeLoading }: { m: ReportModel; t: Dict; lang: Lang; safeLoading: boolean }) {
  const I = m.inputs, bd = isBangladesh(I.place.country);
  if (!I.liveFetched) return <p className="rp-muted">{t.now.unavailable}</p>;
  return <>
    <p className="rp-lead">{t.now.intro({ time: dateText(lang, I.liveFetched, true) })}</p>
    <h4 className="rp-h4">{t.now.hazards}</h4>
    {I.hazards === null ? <p className="rp-muted">{t.now.unavailable}</p> : I.hazards.length ? <ul className="rp-hazards">{I.hazards.map((h, i) => <li key={i} className={h.inside ? "inside" : h.eta ? "eta" : ""}>
      <b>{t.hazard[h.type]}</b> {h.title} <span>· {num(lang, Math.round(h.distanceKm))} {t.now.km} · {t.severity[h.severity]}</span>
      {h.inside && <em>{t.now.inside}</em>}{h.eta && <em>{t.now.forecast}</em>}
    </li>)}</ul> : <p className="rp-ok"><CircleCheck size={14} /> {t.now.noHazards}</p>}
    <h4 className="rp-h4">{t.now.heat}</h4>
    {I.heat ? <div className="rp-heat">{I.heat.days.slice(0, 7).map(d => <div key={d.date} style={{ borderTopColor: HEAT_META[d.level].color }}>
      <small>{new Date(d.date + "T00:00:00Z").toLocaleDateString(lang === "bn" ? "bn-BD" : "en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" })}</small>
      <b>{num(lang, d.tmax, 0)}°</b>
      <span>{t.now.heatIndex} {num(lang, d.heatIndexMax, 0)}°</span>
      <em style={{ color: HEAT_META[d.level].color }}>{t.heatLevel[d.level]}</em>
      {d.bmd !== "none" && bd && <em>{t.bmd[d.bmd]}</em>}
    </div>)}</div> : <p className="rp-muted">{t.now.noHeat}</p>}
    <AirBlock air={I.air} t={t} lang={lang} />
    <h4 className="rp-h4">{t.now.safe}</h4>
    {safeLoading ? <p className="rp-muted rp-searching"><LoaderCircle className="spin" size={13} /> {t.now.safeLoading}</p> : I.safePlaces === null ? <p className="rp-muted">{t.now.safeFail}</p> : I.safePlaces.length ? <ul className="rp-safe">{I.safePlaces.map((s, i) => <li key={i}><b>{t.safe[s.kind]}</b> {s.name} <span>{num(lang, s.distanceKm, 1)} {t.now.km}</span></li>)}</ul> : <p className="rp-muted">{t.now.noSafe}</p>}
    <h4 className="rp-h4">{t.now.official}</h4>
    <ul className="rp-official">{t.official[bd ? "bd" : "world"].map(([n, u]) => <li key={u}><b>{n}</b> {u}</li>)}</ul>
  </>;
}

function AirBlock({ air, t, lang }: { air: ReportInputs["air"]; t: Dict; lang: Lang }) {
  if (air === undefined) return null; // report saved before air quality was added
  const tr = makeI18n(lang).t;
  if (!air) return <><h4 className="rp-h4">{t.now.air}</h4><p className="rp-muted">{t.now.noAir}</p></>;
  const cat = aqiCategory(air.aqi), peak = aqiCategory(air.peakAqi), worse = peak.rank > cat.rank;
  return <>
    <h4 className="rp-h4">{t.now.air}</h4>
    <div className="rp-air" style={{ borderLeftColor: cat.color }}>
      <div className="rp-air-now"><b>{num(lang, air.aqi, 0)}</b><span>{t.now.aqiNow}<em style={{ color: cat.color }}>{tr(cat.label)}</em></span></div>
      <p>{t.now.who({ pm: num(lang, air.pm25, 0), x: num(lang, air.pm25 / WHO_PM25_24H, 1) })}</p>
      <div className="rp-air-days">{air.days.slice(0, 5).map(d => <span key={d.date} style={{ background: aqiCategory(d.maxAqi).color, color: aqiCategory(d.maxAqi).rank >= 3 ? "#fff" : undefined }}><small>{new Date(d.date + "T00:00:00Z").toLocaleDateString(lang === "bn" ? "bn-BD" : "en-GB", { weekday: "short", timeZone: "UTC" })}</small>{num(lang, d.maxAqi, 0)}</span>)}</div>
      <p className="rp-air-advice">{tr(worse ? peak.advice : cat.advice)}</p>
    </div>
  </>;
}

/* ------------------------------ Methods ------------------------------ */
function MethodsSection({ m, t, lang, audience, link }: { m: ReportModel; t: Dict; lang: Lang; audience: Audience; link: string }) {
  const [qr, setQr] = useState("");
  const qrRef = useRef(link);
  useEffect(() => {
    qrRef.current = link;
    if (!link) return;
    QRCode.toString(link, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#071433", light: "#ffffff" } }).then(svg => { if (qrRef.current === link) setQr(svg); }).catch(() => {});
  }, [link]);
  const full = audience !== "citizen";
  const version = m.inputs.extremes?.version;
  return <>
    <div className="rp-two">
      <div>
        <h4 className="rp-h4">{t.methods.sourcesTitle}</h4>
        <ul className="rp-sources">{t.methods.sources.slice(0, full ? 7 : 4).map(([n, d]) => <li key={n}><b>{n}</b> {d}</li>)}</ul>
        {version && <p className="rp-note">NASA POWER API {version}.</p>}
      </div>
      <div className="rp-share">
        <div className="rp-qr" dangerouslySetInnerHTML={{ __html: qr }} />
        <b>{t.methods.share}</b>
        <p>{t.methods.shareNote}</p>
        <code>{link.replace(/^https?:\/\//, "").slice(0, 46)}…</code>
      </div>
    </div>
    {full && <><h4 className="rp-h4">{t.methods.methodsTitle}</h4><ul className="rp-list">{t.methods.methods.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
    <h4 className="rp-h4">{t.methods.limitsTitle}</h4>
    <ul className="rp-list">{t.methods.limits.map((x, i) => <li key={i}>{x}</li>)}</ul>
    {audience === "student" && <><h4 className="rp-h4">{t.sec.glossary}</h4><dl className="rp-glossary">{t.glossary.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></>}
    <p className="rp-cite"><b>{t.methods.cite}:</b> {t.methods.citeText({ year: yr(lang, new Date(m.inputs.created).getUTCFullYear()), place: `${m.inputs.place.name}, ${m.inputs.place.country}`, date: dateText(lang, m.inputs.created) })}</p>
    <p className="rp-disclaimer"><ShieldAlert size={13} /> {t.disclaimer}</p>
  </>;
}
