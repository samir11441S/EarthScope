"use client";
import { useEffect, useState } from "react";
import { ChevronDown, Scale } from "lucide-react";
import { homogeneity, type ClimateData, type Place } from "@/lib/climate";
import { crossCheck, type AnnualSeries } from "@/lib/crosscheck";
import { useI18n } from "@/lib/i18n";

const cache = new Map<string, AnnualSeries | null>();

/** NASA POWER vs ECMWF ERA5: agreement, bias, trends, and whether a POWER data break is confirmed. */
export function CrossCheckNote({ place, data }: { place: Place; data: ClimateData }) {
  const { t, n, y } = useI18n();
  const key = `${place.lat.toFixed(3)},${place.lon.toFixed(3)}`;
  const [era5, setEra5] = useState<{ key: string; series: AnnualSeries | null } | null>(() => (cache.has(key) ? { key, series: cache.get(key)! } : null));
  useEffect(() => {
    if (data.source !== "NASA POWER" || cache.has(key)) return;
    let active = true;
    fetch(`/api/crosscheck?lat=${place.lat.toFixed(3)}&lon=${place.lon.toFixed(3)}`)
      .then(r => (r.ok ? (r.json() as Promise<AnnualSeries>) : null))
      .catch(() => null)
      .then(series => { cache.set(key, series); if (active) setEra5({ key, series }); });
    return () => { active = false; };
  }, [key, place.lat, place.lon, data.source]);

  const series = era5?.key === key ? era5.series : cache.get(key);
  if (data.source !== "NASA POWER" || !series) return null;
  const h = homogeneity(data.annual), c = crossCheck(data.annual, series, h.tempFrom);
  if (!c) return null;
  const sn = (v: number, d: number) => { const r = Number(v.toFixed(d)); return `${r > 0 ? "+" : r < 0 ? "−" : ""}${n(Math.abs(r), d)}`; };
  const verdict = { agree: t("NASA POWER and ERA5 agree"), partly: t("NASA POWER and ERA5 broadly agree"), differ: t("NASA POWER and ERA5 differ here") }[c.verdict];
  const breakConfirmed = h.tempBreak && c.diffBreak && Math.abs(c.diffBreak.year - h.tempBreak.year) <= 2;
  return (
    <details className={`crosscheck-note ${c.verdict}`}>
      <summary><Scale size={15} /><span><strong>{t("Independent cross-check:")}</strong> {verdict} · r = {n(c.tempR, 2)}</span><ChevronDown size={14} className="chev" /></summary>
      <div className="crosscheck-grid">
        <div><span>{t("Year-to-year agreement (temperature)")}</span><b>r = {n(c.tempR, 2)}</b></div>
        <div><span>{t("Average difference, POWER − ERA5")}</span><b>{sn(c.tempBias, 1)} °C</b></div>
        <div><span>{t("Warming trend {a}–{b}", { a: y(c.years[0]), b: y(c.years[1]) })}</span><b>POWER {c.powerTrend === null ? "—" : sn(c.powerTrend, 2)} · ERA5 {c.era5Trend === null ? "—" : sn(c.era5Trend, 2)} °C/{t("dec")}</b></div>
        <div><span>{t("Rainfall: agreement and ratio")}</span><b>r = {n(c.rainR, 2)} · ×{n(c.rainRatio, 2)}</b></div>
      </div>
      {breakConfirmed && <p>{t("The POWER − ERA5 difference itself jumps by {step} °C in {year}, which confirms that the {break} step in NASA POWER is a dataset artefact — so excluding the earlier years is right.", { step: sn(c.diffBreak!.step, 1), year: y(c.diffBreak!.year), break: y(h.tempBreak!.year) })}</p>}
      {c.era5FullTrend && h.tempBreak && !c.era5Break && <p>{t("ERA5 has no break here, so it gives the longer view: {trend} °C/decade over {a}–{b}.", { trend: sn(c.era5FullTrend.perDecade, 2), a: y(c.era5FullTrend.from), b: y(c.era5FullTrend.to) })}</p>}
      <p className="crosscheck-source">{t("ECMWF ERA5 reanalysis (Copernicus, 0.25°) via Open-Meteo. A different model and assimilation system from MERRA-2, so agreement means the signal does not depend on one dataset.")}</p>
    </details>
  );
}
