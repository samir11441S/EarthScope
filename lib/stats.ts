// Trend statistics for annual climate series.
//
// Ordinary least squares slope with a two-sided Student-t test. Annual climate values are
// serially correlated, which makes a naive t-test over-confident, so the sample size is
// reduced to an effective n from the lag-1 autocorrelation of the residuals
// (Santer et al., 2000, J. Geophys. Res. 105(D6): n_eff = n (1 − r1) / (1 + r1)).

export interface LinearTrend {
  slope: number; // units per x-unit (per year for annual series)
  intercept: number;
  stdError: number; // autocorrelation-adjusted standard error of the slope
  ci95: [number, number]; // 95 % confidence interval of the slope
  pValue: number; // two-sided
  rSquared: number;
  n: number;
  nEff: number;
  lag1: number; // lag-1 autocorrelation of residuals
  significant: boolean; // p < 0.05
}

/** Natural log of the gamma function (Lanczos approximation). */
function lnGamma(z: number): number {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  const x = z;
  let y = z, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const c of g) ser += c / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Continued fraction for the incomplete beta function (Numerical Recipes, betacf). */
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200, EPS = 3e-14, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Two-sided p-value of a Student-t statistic with df degrees of freedom. */
export function tTestPValue(t: number, df: number): number {
  if (!Number.isFinite(t)) return 0;
  return incompleteBeta(df / (df + t * t), df / 2, 0.5);
}

/** Critical t for a two-sided test at level alpha (bisection on the CDF). */
export function tCritical(df: number, alpha = 0.05): number {
  let lo = 0, hi = 1000;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (tTestPValue(mid, df) > alpha) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export function linearTrend(xs: number[], ys: number[]): LinearTrend | null {
  const pts = xs.map((x, i) => [x, ys[i]] as const).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const n = pts.length;
  if (n < 4) return null;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); syy += (y - my) ** 2; }
  if (sxx === 0) return null;
  const slope = sxy / sxx, intercept = my - slope * mx;
  const resid = pts.map(([x, y]) => y - (intercept + slope * x));
  const sse = resid.reduce((s, e) => s + e * e, 0);
  // Lag-1 autocorrelation of residuals; negative values are not used to inflate n.
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { den += resid[i] ** 2; if (i > 0) num += resid[i] * resid[i - 1]; }
  const lag1 = den > 0 ? Math.max(-0.99, Math.min(0.99, num / den)) : 0;
  const r = Math.max(0, lag1);
  const nEff = Math.max(3, Math.min(n, (n * (1 - r)) / (1 + r)));
  const df = Math.max(1, nEff - 2);
  const s2 = sse / (n - 2);
  const stdError = Math.sqrt(s2 / sxx) * Math.sqrt((n - 2) / df);
  const pValue = stdError > 0 ? tTestPValue(slope / stdError, df) : 0;
  const half = tCritical(df) * stdError;
  return {
    slope, intercept, stdError, ci95: [slope - half, slope + half], pValue,
    rSquared: syy > 0 ? (sxy * sxy) / (sxx * syy) : 0, n, nEff, lag1, significant: pValue < 0.05,
  };
}

export const formatP = (p: number) => (p < 0.001 ? "p < 0.001" : `p = ${p < 0.01 ? p.toFixed(3) : p.toFixed(2)}`);
