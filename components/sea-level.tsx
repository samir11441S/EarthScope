"use client";
import { useEffect, useState } from "react";
import { LoaderCircle, Mountain, ShieldAlert, Waves } from "lucide-react";
import type { Place } from "@/lib/climate";
import { useI18n } from "@/lib/i18n";
import { AR6_GMSL, OBSERVED_GMSL, SHOWN_SSPS, elevationBand, inBengalDelta, type Ssp } from "@/lib/sea-level";

const SSP_LABEL: Record<Ssp, string> = { "SSP1-1.9": "Very low emissions", "SSP1-2.6": "Low emissions", "SSP2-4.5": "Intermediate emissions", "SSP3-7.0": "High emissions", "SSP5-8.5": "Very high emissions" };
const SSP_COLOR: Record<Ssp, string> = { "SSP1-1.9": "#5fd4ff", "SSP1-2.6": "#38b6ff", "SSP2-4.5": "#f2b84b", "SSP3-7.0": "#ff8a5c", "SSP5-8.5": "#ff5a4f" };

export default function SeaLevelPanel({ place }: { place: Place }) {
  const { t, n, y } = useI18n();
  const [elev, setElev] = useState<{ key: string; m: number | null } | null>(null);
  const key = `${place.lat},${place.lon}`;
  useEffect(() => {
    let active = true;
    fetch(`/api/elevation?lat=${place.lat}&lon=${place.lon}`).then(r => (r.ok ? (r.json() as Promise<{ elevation?: number }>) : null)).then(j => active && setElev({ key, m: typeof j?.elevation === "number" ? j.elevation : null })).catch(() => active && setElev({ key, m: null }));
    return () => { active = false; };
  }, [place.lat, place.lon, key]);
  const m = elev?.key === key ? elev.m : undefined;
  const delta = inBengalDelta(place.lat, place.lon);
  const band = typeof m === "number" ? elevationBand(m) : null;
  const max = 1.1, W = 560, rowH = 34, L = 150, R = W - 20, x = (v: number) => L + (v / max) * (R - L);
  const rows = SHOWN_SSPS.flatMap(s => [{ s, yr: 2050 as const }, { s, yr: 2100 as const }]);
  const H = rows.length * rowH + 30;
  return <section className="content-panel sea-panel">
    <div className="section-heading">
      <div><span className="eyebrow">{t("IPCC AR6 · SEA LEVEL")}</span><h2>{t("How high could the sea rise?")}</h2><p>{t("Global mean sea-level rise assessed by the IPCC, next to the ground height of {place}.", { place: place.name })}</p></div>
      <span className="source-pill"><Waves size={14}/> IPCC AR6 WGI · Copernicus DEM</span>
    </div>
    <div className="sea-grid">
      <div className="sea-chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("Projected global mean sea-level rise by scenario")}>
          {[0, 0.25, 0.5, 0.75, 1].map(v => <g key={v}><line x1={x(v)} x2={x(v)} y1="4" y2={H - 22} className="sea-grid-line"/><text x={x(v)} y={H - 6} textAnchor="middle" className="sea-axis">{n(v, 2)} m</text></g>)}
          {rows.map((r, i) => {
            const p = AR6_GMSL[r.s][r.yr], cy = 14 + i * rowH;
            return <g key={`${r.s}-${r.yr}`}>
              <text x={L - 10} y={cy + 4} textAnchor="end" className="sea-label">{y(r.yr)} · {t(SSP_LABEL[r.s])}</text>
              <rect x={x(p.likely[0])} y={cy - 7} width={x(p.likely[1]) - x(p.likely[0])} height="14" rx="4" fill={SSP_COLOR[r.s]} opacity={r.yr === 2050 ? 0.35 : 0.55}/>
              <line x1={x(p.median)} x2={x(p.median)} y1={cy - 10} y2={cy + 10} stroke={SSP_COLOR[r.s]} strokeWidth="3"/>
              <text x={x(p.likely[1]) + 6} y={cy + 4} className="sea-val">{n(p.median, 2)} m</text>
            </g>;
          })}
        </svg>
        <p className="sea-note">{t("Bars: likely range (17–83%); line: median. Relative to 1995–2014. The sea has already risen about {rise} m since 1901 and is rising about {rate} mm a year.", { rise: n(OBSERVED_GMSL.since1901, 2), rate: n(OBSERVED_GMSL.rate2006_2018, 1) })}</p>
      </div>
      <div className="sea-place">
        <div className="sea-elev"><Mountain size={20}/>
          {m === undefined ? <span><LoaderCircle className="spin" size={14}/> {t("Measuring ground height…")}</span>
            : m === null ? <span>{t("Ground height unavailable right now.")}</span>
            : <div><small>{t("Ground height at {place}", { place: place.name })}</small><strong>{n(m, 0)} m</strong><span>{t("above mean sea level (90 m elevation model)")}</span></div>}
        </div>
        {band && <p className={`sea-verdict ${band}`}>{t({
          "very-low": "Very low-lying: even 0.5 m of sea-level rise makes storm surges and high tides reach much further inland. Embankments and drainage matter most here.",
          low: "Low-lying: higher seas push storm surges, tidal flooding and salt water further inland, and slow river drainage during floods.",
          moderate: "Moderately elevated: direct flooding from the sea is unlikely, but river backwater, waterlogging and salt in water supplies can still reach here.",
          high: "Well above sea level: sea-level rise is not a direct flooding threat here; it matters through coastal supply chains and migration.",
        }[band])}</p>}
        {delta && <p className="sea-delta"><ShieldAlert size={15}/> {t("In the Ganges–Brahmaputra–Meghna delta the land itself is sinking in many places (often several mm a year), so the local rise relative to the land is larger than the global numbers (Becker et al., 2020).")}</p>}
        <p className="sea-small">{t("These are global averages. Local sea level also depends on land movement, ocean currents and tides. Treat the numbers as a guide, not a flood map.")}</p>
      </div>
    </div>
  </section>;
}
