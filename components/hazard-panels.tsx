"use client";
import { useEffect, useState } from "react";
import { ExternalLink, LoaderCircle, Thermometer, Users, Waves } from "lucide-react";
import { BMD_LABEL, heatAlert, HEAT_META, type HeatDay, type HeatOutlook } from "@/lib/heat";

// ---------- Event impact: people exposed + storm surge (on demand per event) ----------

interface EventImpactData {
  people: { value: number; label: string; method: string; source: string }[];
  surge?: { models: { model: string; maxHeightM: number; maxRainMm?: number }[]; rangeM: [number, number]; level: string; mapUrl?: string; source: string };
  note?: string;
}
const impactCache = new Map<string, EventImpactData | { error: string }>();

export const fmtPeople = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} million` : n >= 1e5 ? `${Math.round(n / 1e3).toLocaleString("en-US")} thousand` : (n >= 1000 ? Math.round(n / 10) * 10 : n).toLocaleString("en-US"));

export function EventImpact({ id }: { id: string }) {
  const [state, setState] = useState<EventImpactData | { error: string } | null>(() => impactCache.get(id) ?? null);
  const [shownId, setShownId] = useState(id);
  if (shownId !== id) { setShownId(id); setState(impactCache.get(id) ?? null); }
  useEffect(() => {
    if (impactCache.has(id)) return;
    let active = true;
    fetch(`/api/event-impact?id=${encodeURIComponent(id)}`)
      .then(async r => { const j = (await r.json()) as EventImpactData & { error?: string }; if (!r.ok) throw new Error(j.error); return j; })
      .then(j => { impactCache.set(id, j); if (active) setState(j); })
      .catch(e => { const v = { error: e instanceof Error && e.message ? e.message : "Impact estimate unavailable." }; if (active) setState(v); });
    return () => { active = false; };
  }, [id]);

  if (!state) return <div className="impact-box"><LoaderCircle className="spin" size={14} /> Estimating people exposed…</div>;
  if ("error" in state) return <div className="impact-box muted">{state.error}</div>;
  return (
    <div className="impact-box">
      {state.people.map(p => (
        <div key={p.label} className="impact-row" title={`${p.method} — ${p.source}`}>
          <Users size={15} /><span><strong>≈ {fmtPeople(p.value)} people</strong> {p.label}</span>
        </div>
      ))}
      {!state.people.length && state.note && <p className="muted">{state.note}</p>}
      {state.surge && (
        <div className={`impact-row surge ${state.surge.rangeM[1] >= 1 ? "danger" : ""}`} title={state.surge.source}>
          <Waves size={15} />
          <span>
            <strong>Storm surge {state.surge.rangeM[0] === state.surge.rangeM[1] ? `${state.surge.rangeM[1].toFixed(1)} m` : `${state.surge.rangeM[0].toFixed(1)}–${state.surge.rangeM[1].toFixed(1)} m`}</strong> peak ({state.surge.models.map(m => m.model).join(", ")}) — {state.surge.level}
            {state.surge.mapUrl && <> · <a href={state.surge.mapUrl} target="_blank" rel="noreferrer">surge map <ExternalLink size={10} /></a></>}
          </span>
        </div>
      )}
      <p className="impact-source">{[...new Set([...state.people.map(p => p.source), ...(state.surge ? [state.surge.source] : [])])].join(" · ")}{state.people.some(p => p.method.includes("radius")) ? " · radius figures are upper-bound screening estimates" : ""}</p>
    </div>
  );
}

// ---------- Heat ----------

const dayName = (d: string) => new Date(d + "T12:00:00").toLocaleDateString([], { weekday: "short" });

/** 7-day heat strip for one point. */
export function HeatStrip({ outlook, compact = false }: { outlook: HeatOutlook; compact?: boolean }) {
  return (
    <div className={`heat-strip${compact ? " compact" : ""}`}>
      {outlook.days.map(d => (
        <div key={d.date} className="heat-day" style={{ "--c": HEAT_META[d.level].color } as React.CSSProperties} title={`${d.date}: max ${d.tmax.toFixed(1)} °C, heat index ${d.heatIndexMax.toFixed(0)} °C — ${HEAT_META[d.level].label}${d.bmd !== "none" ? `, ${BMD_LABEL[d.bmd]}` : ""}`}>
          <span>{dayName(d.date)}</span>
          <strong>{Math.round(d.heatIndexMax)}°</strong>
          {!compact && <small>{Math.round(d.tmax)}°</small>}
        </div>
      ))}
    </div>
  );
}

export const HEAT_GUIDANCE = [
  "Avoid outdoor work and travel between 11:00 and 16:00; rest in shade often.",
  "Drink water regularly even if not thirsty; oral saline helps when sweating heavily.",
  "Check on older people, young children, pregnant women and people with illness.",
  "Heat stroke (confusion, hot dry skin, fainting) is an emergency — cool the person and call 999.",
];

export function worstHeat(o: HeatOutlook, days = 3): HeatDay {
  return o.days.slice(0, days).reduce((a, b) => (b.heatIndexMax > a.heatIndexMax ? b : a), o.days[0]);
}

/** Heat outlook for the user's chosen location (fetched on demand). */
export function HeatOutlookCard({ lat, lon, label, onAlert }: { lat: number; lon: number; label: string; onAlert?: (alert: boolean, summary: string) => void }) {
  const [o, setO] = useState<HeatOutlook | null>(null), [err, setErr] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(`/api/heat?points=${lat.toFixed(3)},${lon.toFixed(3)}`)
      .then(r => r.json() as Promise<{ outlooks?: HeatOutlook[] }>)
      .then(j => {
        if (!active) return;
        const v = j.outlooks?.[0] ?? null;
        setO(v); setErr(!v);
        if (v) { const w = worstHeat(v); onAlert?.(heatAlert(w), `${HEAT_META[w.level].label}, heat index up to ${Math.round(w.heatIndexMax)} °C in the next 3 days${w.bmd !== "none" ? ` (${BMD_LABEL[w.bmd]})` : ""}`); }
      })
      .catch(() => active && setErr(true));
    return () => { active = false; };
    // onAlert is a notification callback; re-fetch only when the point changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon]);
  if (err) return null;
  if (!o) return <div className="heat-card muted"><LoaderCircle className="spin" size={14} /> Loading heat outlook…</div>;
  const worst = worstHeat(o), alert = heatAlert(worst);
  return (
    <div className={`heat-card${alert ? " alert" : ""}`}>
      <h4><Thermometer size={14} /> Heat outlook — {label} <small>heat index · next 7 days</small></h4>
      <HeatStrip outlook={o} />
      <p className="heat-verdict" style={{ color: HEAT_META[worst.level].color }}>
        Next 3 days: <strong>{HEAT_META[worst.level].label}</strong> (heat index up to {Math.round(worst.heatIndexMax)} °C){worst.bmd !== "none" ? ` · ${BMD_LABEL[worst.bmd]}` : ""}
      </p>
      {(alert || HEAT_META[worst.level].rank >= 2) && <ul>{HEAT_GUIDANCE.slice(0, alert ? 4 : 2).map(g => <li key={g}>{g}</li>)}</ul>}
      <p className="impact-source">Open-Meteo forecast · NOAA NWS heat index · BMD heatwave classes</p>
    </div>
  );
}

// ---------- Official Bangladesh sources ----------

export const inBangladeshRegion = (lat: number, lon: number) => lat >= 20 && lat <= 27 && lon >= 87.5 && lon <= 93;

export function BangladeshOfficial() {
  return (
    <div className="bd-official">
      <strong>Official warnings (Bangladesh)</strong>
      <a href="https://bmd.gov.bd/" target="_blank" rel="noreferrer">BMD — cyclone signals &amp; heatwave <ExternalLink size={10} /></a>
      <a href="https://www.ffwc.gov.bd/" target="_blank" rel="noreferrer">FFWC — river flood forecasts <ExternalLink size={10} /></a>
      <a href="https://ddm.gov.bd/" target="_blank" rel="noreferrer">DDM — disaster management <ExternalLink size={10} /></a>
      <span>Emergency 999 · Disaster helpline 1090</span>
    </div>
  );
}
