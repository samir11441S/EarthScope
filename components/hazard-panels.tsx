"use client";
import { useEffect, useRef, useState } from "react";
import { ExternalLink, LoaderCircle, Thermometer, Users, Waves } from "lucide-react";
import { BMD_LABEL, heatAlert, HEAT_META, type HeatDay, type HeatOutlook } from "@/lib/heat";
import { useI18n, makeI18n } from "@/lib/i18n";

// ---------- Event impact: people exposed + storm surge (on demand per event) ----------

interface EventImpactData {
  people: { value: number; label: string; method: string; source: string }[];
  surge?: { models: { model: string; maxHeightM: number; maxRainMm?: number }[]; rangeM: [number, number]; level: string; mapUrl?: string; source: string };
  note?: string;
}
const impactCache = new Map<string, EventImpactData | { error: string }>();

export const fmtPeople = (n: number, t = makeI18n("en").t) => (n >= 1e6 ? t("{n} million", { n: (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) }) : n >= 1e5 ? t("{n} thousand", { n: Math.round(n / 1e3).toLocaleString("en-US") }) : (n >= 1000 ? Math.round(n / 10) * 10 : n).toLocaleString("en-US"));

export function EventImpact({ id }: { id: string }) {
  const { t } = useI18n();
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; });
  const [state, setState] = useState<EventImpactData | { error: string } | null>(() => impactCache.get(id) ?? null);
  const [shownId, setShownId] = useState(id);
  if (shownId !== id) { setShownId(id); setState(impactCache.get(id) ?? null); }
  useEffect(() => {
    if (impactCache.has(id)) return;
    let active = true;
    fetch(`/api/event-impact?id=${encodeURIComponent(id)}`)
      .then(async r => { const j = (await r.json()) as EventImpactData & { error?: string }; if (!r.ok) throw new Error(j.error); return j; })
      .then(j => { impactCache.set(id, j); if (active) setState(j); })
      .catch(e => { const v = { error: e instanceof Error && e.message ? e.message : tRef.current("Impact estimate unavailable.") }; if (active) setState(v); });
    return () => { active = false; };
  }, [id]);

  if (!state) return <div className="impact-box"><LoaderCircle className="spin" size={14} /> {t("Estimating people exposed…")}</div>;
  if ("error" in state) return <div className="impact-box muted">{state.error}</div>;
  return (
    <div className="impact-box">
      {state.people.map(p => (
        <div key={p.label} className="impact-row" title={`${p.method} — ${p.source}`}>
          <Users size={15} /><span><strong>≈ {t("{n} people", { n: fmtPeople(p.value, t) })}</strong> {t(p.label)}</span>
        </div>
      ))}
      {!state.people.length && state.note && <p className="muted">{state.note}</p>}
      {state.surge && (
        <div className={`impact-row surge ${state.surge.rangeM[1] >= 1 ? "danger" : ""}`} title={state.surge.source}>
          <Waves size={15} />
          <span>
            <strong>{t("Storm surge")} {state.surge.rangeM[0] === state.surge.rangeM[1] ? `${state.surge.rangeM[1].toFixed(1)} m` : `${state.surge.rangeM[0].toFixed(1)}–${state.surge.rangeM[1].toFixed(1)} m`}</strong> {t("peak")} ({state.surge.models.map(m => m.model).join(", ")}) — {t(state.surge.level)}
            {state.surge.mapUrl && <> · <a href={state.surge.mapUrl} target="_blank" rel="noreferrer">{t("surge map")} <ExternalLink size={10} /></a></>}
          </span>
        </div>
      )}
      <p className="impact-source">{[...new Set([...state.people.map(p => p.source), ...(state.surge ? [state.surge.source] : [])])].join(" · ")}{state.people.some(p => p.method.includes("radius")) ? ` · ${t("radius figures are upper-bound screening estimates")}` : ""}</p>
    </div>
  );
}

// ---------- Heat ----------

const dayName = (d: string, lang = "en") => new Date(d + "T12:00:00").toLocaleDateString(lang === "bn" ? "bn-BD" : [], { weekday: "short" });

/** 7-day heat strip for one point. */
export function HeatStrip({ outlook, compact = false }: { outlook: HeatOutlook; compact?: boolean }) {
  const { t, n, lang } = useI18n();
  return (
    <div className={`heat-strip${compact ? " compact" : ""}`}>
      {outlook.days.map(d => (
        <div key={d.date} className="heat-day" style={{ "--c": HEAT_META[d.level].color } as React.CSSProperties} title={`${d.date}: ${t("max {v} °C, heat index {h} °C", { v: d.tmax.toFixed(1), h: d.heatIndexMax.toFixed(0) })} — ${t(HEAT_META[d.level].label)}${d.bmd !== "none" ? `, ${t(BMD_LABEL[d.bmd])}` : ""}`}>
          <span>{dayName(d.date, lang)}</span>
          <strong>{n(Math.round(d.heatIndexMax))}°</strong>
          {!compact && <small>{n(Math.round(d.tmax))}°</small>}
        </div>
      ))}
    </div>
  );
}

/* i18n */export const HEAT_GUIDANCE = [
  "Avoid outdoor work and travel between 11:00 and 16:00; rest in shade often.",
  "Drink water regularly even if not thirsty; oral saline helps when sweating heavily.",
  "Check on older people, young children, pregnant women and people with illness.",
  "Heat stroke (confusion, hot dry skin, fainting) is an emergency — cool the person and call 999.",
];/* /i18n */

export function worstHeat(o: HeatOutlook, days = 3): HeatDay {
  return o.days.slice(0, days).reduce((a, b) => (b.heatIndexMax > a.heatIndexMax ? b : a), o.days[0]);
}

/** Heat outlook for the user's chosen location (fetched on demand). */
export function HeatOutlookCard({ lat, lon, label, onAlert }: { lat: number; lon: number; label: string; onAlert?: (alert: boolean, summary: string) => void }) {
  const { t, n } = useI18n();
  const [o, setO] = useState<HeatOutlook | null>(null), [err, setErr] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(`/api/heat?points=${lat.toFixed(3)},${lon.toFixed(3)}`)
      .then(r => r.json() as Promise<{ outlooks?: HeatOutlook[] }>)
      .then(j => {
        if (!active) return;
        const v = j.outlooks?.[0] ?? null;
        setO(v); setErr(!v);
        if (v) { const w = worstHeat(v); onAlert?.(heatAlert(w), `${t(HEAT_META[w.level].label)}, ${t("heat index up to {v} °C in the next 3 days", { v: Math.round(w.heatIndexMax) })}${w.bmd !== "none" ? ` (${t(BMD_LABEL[w.bmd])})` : ""}`); }
      })
      .catch(() => active && setErr(true));
    return () => { active = false; };
    // onAlert is a notification callback; re-fetch only when the point changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon]);
  if (err) return null;
  if (!o) return <div className="heat-card muted"><LoaderCircle className="spin" size={14} /> {t("Loading heat outlook…")}</div>;
  const worst = worstHeat(o), alert = heatAlert(worst);
  return (
    <div className={`heat-card${alert ? " alert" : ""}`}>
      <h4><Thermometer size={14} /> {t("Heat outlook")} — {label} <small>{t("heat index · next 7 days")}</small></h4>
      <HeatStrip outlook={o} />
      <p className="heat-verdict" style={{ color: HEAT_META[worst.level].color }}>
        {t("Next 3 days:")} <strong>{t(HEAT_META[worst.level].label)}</strong> ({t("heat index up to {v} °C", { v: n(Math.round(worst.heatIndexMax)) })}){worst.bmd !== "none" ? ` · ${t(BMD_LABEL[worst.bmd])}` : ""}
      </p>
      {(alert || HEAT_META[worst.level].rank >= 2) && <ul>{HEAT_GUIDANCE.slice(0, alert ? 4 : 2).map(g => <li key={g}>{t(g)}</li>)}</ul>}
      <p className="impact-source">{t("Open-Meteo forecast · NOAA NWS heat index · BMD heatwave classes")}</p>
    </div>
  );
}

// ---------- Official Bangladesh sources ----------

export const inBangladeshRegion = (lat: number, lon: number) => lat >= 20 && lat <= 27 && lon >= 87.5 && lon <= 93;

export function BangladeshOfficial() {
  const { t } = useI18n();
  return (
    <div className="bd-official">
      <strong>{t("Official warnings (Bangladesh)")}</strong>
      <a href="https://bmd.gov.bd/" target="_blank" rel="noreferrer">{t("BMD — cyclone signals & heatwave")} <ExternalLink size={10} /></a>
      <a href="https://www.ffwc.gov.bd/" target="_blank" rel="noreferrer">{t("FFWC — river flood forecasts")} <ExternalLink size={10} /></a>
      <a href="https://ddm.gov.bd/" target="_blank" rel="noreferrer">{t("DDM — disaster management")} <ExternalLink size={10} /></a>
      <span>{t("Emergency 999 · Disaster helpline 1090")}</span>
    </div>
  );
}
