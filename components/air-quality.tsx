"use client";
import { useEffect, useState } from "react";
import { LoaderCircle, Wind } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { aqiCategory, WHO_PM25_24H, type AirQuality } from "@/lib/air-quality";

/** Air quality now + 5-day outlook for a point, with EPA category, WHO comparison and health advice. */
export function AirQualityCard({ lat, lon, onData }: { lat: number; lon: number; onData?: (a: AirQuality | null) => void }) {
  const { t, n, lang } = useI18n();
  const [state, setState] = useState<{ data: AirQuality | null; error: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    fetch(`/api/air?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`)
      .then(r => (r.ok ? (r.json() as Promise<AirQuality>) : Promise.reject()))
      .then(d => { if (active) { setState({ data: d, error: false }); onData?.(d); } })
      .catch(() => { if (active) { setState({ data: null, error: true }); onData?.(null); } });
    return () => { active = false; };
    // onData is a state setter from the parent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon]);
  if (!state) return <div className="aq-card"><LoaderCircle className="spin" size={14}/> {t("Checking air quality…")}</div>;
  if (!state.data) return <div className="aq-card muted">{t("Air-quality forecast unavailable right now.")}</div>;
  const a = state.data, cat = aqiCategory(a.current.aqi), peak = aqiCategory(a.peakAqi), whoX = a.current.pm25 / WHO_PM25_24H;
  const day = (d: string) => new Date(d + "T00:00:00").toLocaleDateString(lang === "bn" ? "bn-BD" : "en-GB", { weekday: "short" });
  return <div className="aq-card" style={{ "--aq": cat.color } as React.CSSProperties}>
    <div className="aq-head"><Wind size={15}/><strong>{t("Air quality")}</strong><span className="aq-badge">{t(cat.label)}</span></div>
    <div className="aq-now">
      <div><b>{n(a.current.aqi)}</b><small>{t("US AQI now")}</small></div>
      <div><b>{n(a.current.pm25, 0)}</b><small>PM2.5 µg/m³</small></div>
      <div><b>{n(whoX, 1)}×</b><small>{t("WHO daily guideline")}</small></div>
    </div>
    <div className="aq-days">{a.days.slice(0, 5).map(d => { const c = aqiCategory(d.maxAqi); return <span key={d.date} style={{ background: c.color }} title={`${t(c.label)} · ${n(d.maxAqi)}`}><em>{day(d.date)}</em>{n(d.maxAqi)}</span>; })}</div>
    <p className="aq-advice">{t(peak.rank > cat.rank ? peak.advice : cat.advice)}{peak.rank > cat.rank ? ` ${t("(worse air forecast in the next 3 days)")}` : ""}</p>
    <small className="impact-source">{t("Copernicus CAMS forecast via Open-Meteo · US EPA AQI · WHO 2021 PM2.5 guideline")}</small>
  </div>;
}
