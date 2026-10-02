"use client";
import { calculateAnomalies, calculateTrend, signed, trendSummary, type ClimateData, type Place } from "@/lib/climate";
import { useI18n } from "@/lib/i18n";

export function Sparkline({ values, color = "#38c8ff", fill = false, label = "Annual variation sparkline" }: { values: number[]; color?: string; fill?: boolean; label?: string }) {
  const low = Math.min(...values), high = Math.max(...values), range = high - low || 1;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 160},${42 - ((v - low) / range) * 32}`).join(" ");
  return <svg viewBox="0 0 160 48" className="sparkline" aria-label={label} role="img">
    {fill && <polygon points={`0,48 ${points} 160,48`} fill={color} opacity=".10"/>}
    <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
  </svg>;
}

/**
 * History chart. Years before a detected data break are shaded and excluded from the trend line;
 * the trend line is solid only when statistically significant.
 */
export function ChartPath({ data, metric = "temperature", mode = "absolute" }: { data: ClimateData; metric?: "temperature" | "rainfall"; mode?: "absolute" | "anomaly" }) {
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

export function ComparativeTrendChart({ place1, data1, place2, data2 }: { place1: Place; data1: ClimateData; place2: Place; data2: ClimateData }) {
  const { t, n, y } = useI18n();
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
  const X = (yr: number) => ((yr - y0) / Math.max(1, y1 - y0)) * 500, Y = (v: number) => 125 - ((v - min) / range) * 105;
  const zeroY = Y(0);
  const sig = series.filter(s => s.trend.tempSignificant);
  let diagnosis: string;
  if (sig.length === 2) {
    const [a, b] = [...sig].sort((p, q) => Math.abs(q.trend.tempSlopePerDecade) - Math.abs(p.trend.tempSlopePerDecade));
    const overlap = a.trend.tempCi95[0] <= b.trend.tempCi95[1] && b.trend.tempCi95[0] <= a.trend.tempCi95[1];
    diagnosis = overlap ? t("Both places show significant trends, and their 95% confidence intervals overlap — the difference in rates is not statistically clear.") : t("{a} is changing faster than {b}; their 95% confidence intervals do not overlap.", { a: a.place.name, b: b.place.name });
  } else diagnosis = sig.length === 1 ? t("Only {a} shows a statistically significant trend over its consistent record.", { a: sig[0].place.name }) : t("Neither place shows a statistically clear temperature trend over its consistent record.");
  const ticks = Array.from(new Set([y0, ...[1990, 2000, 2010, 2020].filter(v => v > y0 + 2 && v < y1 - 2), y1]));
  return <div className="compare-chart">
    <div className="compare-chart-head">
      <div>
        <span className="compare-chart-kicker">{t("TREND DETECTIVE · SIDE BY SIDE")}</span>
        <h3>{t("Temperature anomaly, {from}–{to}", { from: y(y0), to: y(y1) })}</h3>
        <p>{diagnosis}</p>
      </div>
      <div className="compare-chart-legend">
        {series.map(s => <span key={s.place.id} title={trendSummary(s.trend)} style={{ color: s.color }}><i style={{ background: s.color }}/> {s.place.name} ({s.trend.tempEnough ? `${n(Number(signed(s.trend.tempSlopePerDecade, 2)), 2)}°C/${t("dec")}${s.trend.tempSignificant ? "" : ", n.s."}` : t("too short")})</span>)}
      </div>
    </div>
    <svg viewBox="0 0 500 145" className="compare-chart-svg" role="img" aria-label={t("Comparative temperature anomaly time series")}>
      <line x1="0" y1={zeroY} x2="500" y2={zeroY} stroke="#ffffff25" strokeDasharray="3 3"/>
      <text x="4" y={Math.max(12, zeroY - 4)} fill="#6981a3" fontSize="9">{t("0 °C = each place's first consistent decade")}</text>
      {series.map(s => <polyline key={s.place.id} points={s.pts.map(p => `${X(p.year)},${Y(p.v)}`).join(" ")} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round"/>)}
    </svg>
    <div className="compare-chart-ticks">{ticks.map(v => <span key={v}>{y(v)}</span>)}</div>
    <p className="compare-chart-note">{t("n.s. = not statistically significant (p ≥ 0.05, autocorrelation-corrected). Years before a detected data break are excluded.")}</p>
  </div>;
}
