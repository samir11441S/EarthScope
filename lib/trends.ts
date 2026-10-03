// Trend detection for many series at once (maps of grid cells or satellite pixels).
//
// • Mann–Kendall test: is there a monotonic trend? Rank-based, so robust to outliers and skewed data
//   such as rainfall; with the tie correction of Kendall (1975).
// • Serial correlation: climate series are autocorrelated, which inflates significance. We use the
//   trend-free pre-whitening of Yue et al. (2002): remove Sen's slope, estimate lag-1 autocorrelation,
//   remove it, add the slope back, then test.
// • Sen's slope (Sen 1968): the median of all pairwise slopes — the standard "how much" partner of MK.
// • Field significance: testing hundreds of cells, ~5% look "significant" by chance. The Benjamini–
//   Hochberg false-discovery-rate procedure with α_FDR = 0.10 (Wilks 2016, BAMS) controls that.

export interface MkResult {
  n: number;
  s: number; // Mann–Kendall S
  z: number; // standard normal score
  p: number; // two-sided p-value
  slope: number; // Sen's slope, units per time step (per year for annual series)
  tau: number; // Kendall's tau
}

/** Standard normal cumulative distribution (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7). */
export function normCdf(z: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Sen's slope of y against x (missing values skipped). */
export function senSlope(x: number[], y: number[]) {
  const s: number[] = [];
  for (let i = 0; i < x.length; i++) for (let j = i + 1; j < x.length; j++) if (x[j] !== x[i]) s.push((y[j] - y[i]) / (x[j] - x[i]));
  if (!s.length) return NaN;
  s.sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mkCore(y: number[]) {
  const n = y.length;
  let s = 0;
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) s += Math.sign(y[j] - y[i]);
  // Tie correction.
  const counts = new Map<number, number>();
  for (const v of y) { const k = Math.round(v * 1e6) / 1e6; counts.set(k, (counts.get(k) ?? 0) + 1); }
  let ties = 0;
  for (const t of counts.values()) if (t > 1) ties += t * (t - 1) * (2 * t + 5);
  const variance = (n * (n - 1) * (2 * n + 5) - ties) / 18;
  const z = variance > 0 ? (s > 0 ? (s - 1) / Math.sqrt(variance) : s < 0 ? (s + 1) / Math.sqrt(variance) : 0) : 0;
  return { s, z, tau: s / ((n * (n - 1)) / 2) };
}

/** Mann–Kendall trend test with trend-free pre-whitening, on (x, y) pairs; nulls are skipped. */
export function mannKendall(xs: number[], ys: (number | null)[]): MkResult | null {
  const x: number[] = [], y: number[] = [];
  xs.forEach((v, i) => { const w = ys[i]; if (w !== null && Number.isFinite(w)) { x.push(v); y.push(w); } });
  const n = y.length;
  if (n < 10) return null;
  const slope = senSlope(x, y);
  // Trend-free pre-whitening (Yue et al. 2002).
  const detr = y.map((v, i) => v - slope * x[i]);
  const m = detr.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { den += (detr[i] - m) ** 2; if (i) num += (detr[i] - m) * (detr[i - 1] - m); }
  const r1 = den > 0 ? num / den : 0;
  // Only significant positive autocorrelation is removed (95% bound ≈ 1.96/√n).
  const series = r1 > 1.96 / Math.sqrt(n)
    ? detr.slice(1).map((v, i) => v - r1 * detr[i] + slope * x[i + 1])
    : y;
  const { s, z, tau } = mkCore(series);
  return { n, s, z, p: 2 * (1 - normCdf(Math.abs(z))), slope, tau };
}

/**
 * Benjamini–Hochberg: which of these p-values are significant while keeping the expected share of
 * false discoveries ≤ alpha. Returns the p-value threshold, or −1 when nothing passes (p can be exactly 0).
 */
export function fdrThreshold(ps: number[], alpha = 0.1) {
  const sorted = ps.filter(Number.isFinite).sort((a, b) => a - b), m = sorted.length;
  let cut = -1;
  sorted.forEach((p, i) => { if (p <= ((i + 1) / m) * alpha) cut = p; });
  return cut;
}
