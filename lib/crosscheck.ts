// Independent cross-check of the NASA POWER record against ECMWF ERA5.
//
// ERA5 (Copernicus / ECMWF, 0.25°) is built from a different model and a different assimilation system
// than MERRA-2 (behind NASA POWER), so where the two agree the signal is robust, and a step that shows up
// in the POWER − ERA5 difference series is an artefact of one dataset rather than a real climate shift
// (the "reference series" principle of relative homogenisation).
import { detectBreak, MIN_TEMP_STEP, type BreakResult } from "./homogeneity";
import { linearTrend } from "./stats";

export interface AnnualSeries { years: number[]; temperature: number[]; rainfall: number[] }

/** Calendar-year means (temperature) and totals (rainfall) from daily values; incomplete years are dropped. */
export function annualFromDaily(time: string[], temperature: (number | null)[], rainfall: (number | null)[]): AnnualSeries {
  const acc = new Map<number, { t: number; tn: number; p: number; pn: number; days: number }>();
  time.forEach((d, i) => {
    const y = +d.slice(0, 4), a = acc.get(y) ?? { t: 0, tn: 0, p: 0, pn: 0, days: 0 };
    a.days++;
    if (temperature[i] != null) { a.t += temperature[i]!; a.tn++; }
    if (rainfall[i] != null) { a.p += rainfall[i]!; a.pn++; }
    acc.set(y, a);
  });
  const out: AnnualSeries = { years: [], temperature: [], rainfall: [] };
  for (const [y, a] of [...acc].sort((x, z) => x[0] - z[0])) {
    if (a.tn < 360 || a.pn < 360) continue;
    out.years.push(y); out.temperature.push(a.t / a.tn); out.rainfall.push((a.p / a.pn) * a.days);
  }
  return out;
}

export function pearson(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) return NaN;
  const mx = x.slice(0, n).reduce((s, v) => s + v, 0) / n, my = y.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
}

export interface CrossCheck {
  years: [number, number]; // overlap used for agreement statistics (POWER's consistent temperature period)
  tempR: number; // year-to-year correlation of annual mean temperature
  tempBias: number; // mean POWER − ERA5, °C
  rainR: number;
  rainRatio: number; // POWER / ERA5 annual rainfall
  powerTrend: number | null; era5Trend: number | null; // °C / decade over `years`
  era5FullTrend: { perDecade: number; from: number; to: number } | null; // ERA5 over the whole overlap
  /** A step in POWER − ERA5: confirms that a break in POWER is a dataset artefact. */
  diffBreak: BreakResult | null;
  /** A step in ERA5 itself (then its long-term trend is not trustworthy either). */
  era5Break: BreakResult | null;
  verdict: "agree" | "partly" | "differ";
}

export function crossCheck(power: { year: number; temperature: number; rainfall: number }[], era5: AnnualSeries, consistentFrom: number): CrossCheck | null {
  const e = new Map(era5.years.map((y, i) => [y, i]));
  const all = power.filter(p => e.has(p.year));
  const overlap = all.filter(p => p.year >= consistentFrom);
  if (overlap.length < 10) return null;
  const pT = overlap.map(p => p.temperature), eT = overlap.map(p => era5.temperature[e.get(p.year)!]);
  const pR = overlap.map(p => p.rainfall), eR = overlap.map(p => era5.rainfall[e.get(p.year)!]);
  const yrs = overlap.map(p => p.year);
  const trend = (v: number[]) => { const t = linearTrend(yrs, v); return t ? t.slope * 10 : null; };
  const allYears = all.map(p => p.year), eAll = all.map(p => era5.temperature[e.get(p.year)!]);
  const full = linearTrend(allYears, eAll);
  const diffBreak = detectBreak(allYears, all.map((p, i) => p.temperature - eAll[i]), MIN_TEMP_STEP);
  const tempR = pearson(pT, eT), powerTrend = trend(pT), era5Trend = trend(eT);
  const trendGap = powerTrend !== null && era5Trend !== null ? Math.abs(powerTrend - era5Trend) : Infinity;
  const verdict = tempR >= 0.7 && trendGap <= 0.1 ? "agree" : tempR >= 0.5 && trendGap <= 0.2 ? "partly" : "differ";
  return {
    years: [yrs[0], yrs[yrs.length - 1]],
    tempR, tempBias: pT.reduce((s, v, i) => s + v - eT[i], 0) / pT.length,
    rainR: pearson(pR, eR), rainRatio: pR.reduce((s, v) => s + v, 0) / Math.max(1, eR.reduce((s, v) => s + v, 0)),
    powerTrend, era5Trend,
    era5FullTrend: full ? { perDecade: full.slope * 10, from: allYears[0], to: allYears[allYears.length - 1] } : null,
    diffBreak, era5Break: detectBreak(allYears, eAll, MIN_TEMP_STEP), verdict,
  };
}
