// Climate-extremes indices from NASA POWER daily data (MERRA-2), after the ETCCDI conventions
// (Expert Team on Climate Change Detection and Indices, WMO/WCRP), with fixed physical thresholds
// so the numbers are easy to read anywhere in the world.
import { linearTrend, type LinearTrend } from "./stats";

export interface ExtremeYear {
  year: number;
  hotDays: number; // days with Tmax ≥ 35 °C (ETCCDI SU35-style)
  warmNights: number; // nights with Tmin ≥ 25 °C (tropical nights, TR25)
  humidHeatDays: number; // days with daily-mean wet-bulb temperature ≥ 27 °C (humid-heat stress)
  frostDays: number; // days with Tmin < 0 °C (FD)
  txx: number; // hottest day of the year, °C (TXx)
  heavyRainDays: number; // days with ≥ 50 mm rain (R50mm)
  rx1day: number; // wettest day of the year, mm (Rx1day)
  cdd: number; // longest run of dry days (< 1 mm) within the year (CDD)
}
export type IndexKey = Exclude<keyof ExtremeYear, "year">;

export const INDEX_META: Record<IndexKey, { kind: "temp" | "rain"; unit: "days" | "°C" | "mm"; decimals: number; worse: "up" | "down"; etccdi: string }> = {
  hotDays: { kind: "temp", unit: "days", decimals: 0, worse: "up", etccdi: "SU35" },
  warmNights: { kind: "temp", unit: "days", decimals: 0, worse: "up", etccdi: "TR25" },
  humidHeatDays: { kind: "temp", unit: "days", decimals: 0, worse: "up", etccdi: "Tw ≥ 27 °C" },
  frostDays: { kind: "temp", unit: "days", decimals: 0, worse: "up", etccdi: "FD" },
  txx: { kind: "temp", unit: "°C", decimals: 1, worse: "up", etccdi: "TXx" },
  heavyRainDays: { kind: "rain", unit: "days", decimals: 1, worse: "up", etccdi: "R50mm" },
  rx1day: { kind: "rain", unit: "mm", decimals: 0, worse: "up", etccdi: "Rx1day" },
  cdd: { kind: "rain", unit: "days", decimals: 0, worse: "up", etccdi: "CDD" },
};
export const INDEX_KEYS = Object.keys(INDEX_META) as IndexKey[];

export interface DailyPower { T2M_MAX: Record<string, number>; T2M_MIN: Record<string, number>; T2MWET: Record<string, number>; PRECTOTCORR: Record<string, number> }

const ok = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v) && v !== -999;

/** Annual indices for every year with at least 360 valid days. */
export function computeExtremes(p: DailyPower): ExtremeYear[] {
  const byYear = new Map<number, { days: number; acc: ExtremeYear; run: number }>();
  for (const key of Object.keys(p.T2M_MAX).sort()) {
    const year = Number(key.slice(0, 4));
    const tx = p.T2M_MAX[key], tn = p.T2M_MIN[key], tw = p.T2MWET[key], pr = p.PRECTOTCORR[key];
    if (!ok(tx) || !ok(tn) || !ok(tw) || !ok(pr)) continue;
    let y = byYear.get(year);
    if (!y) { y = { days: 0, run: 0, acc: { year, hotDays: 0, warmNights: 0, humidHeatDays: 0, frostDays: 0, txx: -99, heavyRainDays: 0, rx1day: 0, cdd: 0 } }; byYear.set(year, y); }
    const a = y.acc;
    y.days++;
    if (tx >= 35) a.hotDays++;
    if (tn >= 25) a.warmNights++;
    if (tw >= 27) a.humidHeatDays++;
    if (tn < 0) a.frostDays++;
    if (tx > a.txx) a.txx = tx;
    if (pr >= 50) a.heavyRainDays++;
    if (pr > a.rx1day) a.rx1day = pr;
    if (pr < 1) { y.run++; if (y.run > a.cdd) a.cdd = y.run; } else y.run = 0;
  }
  return [...byYear.values()].filter(y => y.days >= 360).map(y => ({ ...y.acc, txx: +y.acc.txx.toFixed(1), rx1day: Math.round(y.acc.rx1day) })).sort((a, b) => a.year - b.year);
}

export interface IndexStat {
  key: IndexKey;
  from: number; to: number; n: number;
  firstMean: number | null; lastMean: number | null; // first / last decade of the consistent record
  firstLabel: string; lastLabel: string;
  latest: number; mean: number;
  trend: (LinearTrend & { perDecade: number; ci95Decade: [number, number] }) | null;
  relevant: boolean; // the index actually happens here (e.g. no frost days in the tropics)
}

const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);

/**
 * Summaries over the consistent part of the record: temperature indices from `tempFrom`, rainfall
 * indices from `rainFrom` (the same break-tested periods used for the annual means).
 */
export function summarizeExtremes(years: ExtremeYear[], tempFrom: number, rainFrom: number): IndexStat[] {
  return INDEX_KEYS.map(key => {
    const meta = INDEX_META[key], from = meta.kind === "temp" ? tempFrom : rainFrom;
    const rows = years.filter(y => y.year >= from), vals = rows.map(r => r[key]);
    const n = rows.length, compare = n >= 20;
    const t = n >= 15 ? linearTrend(rows.map(r => r.year), vals) : null;
    const mean = avg(vals);
    const relevant = key === "frostDays" ? mean >= 1 : key === "txx" || key === "rx1day" || key === "cdd" ? true : mean >= 0.5 || Math.max(0, ...vals) >= 3;
    const lbl = (rs: ExtremeYear[]) => (rs.length ? `${rs[0].year}–${rs[rs.length - 1].year}` : "");
    return {
      key, from: rows[0]?.year ?? from, to: rows[n - 1]?.year ?? from, n,
      firstMean: compare ? avg(vals.slice(0, 10)) : null, lastMean: compare ? avg(vals.slice(-10)) : null,
      firstLabel: compare ? lbl(rows.slice(0, 10)) : "", lastLabel: compare ? lbl(rows.slice(-10)) : "",
      latest: vals[n - 1] ?? 0, mean,
      trend: t ? { ...t, perDecade: t.slope * 10, ci95Decade: [t.ci95[0] * 10, t.ci95[1] * 10] } : null,
      relevant,
    };
  });
}

export const EXTREMES_SOURCE = "NASA POWER daily (MERRA-2), indices after ETCCDI";
