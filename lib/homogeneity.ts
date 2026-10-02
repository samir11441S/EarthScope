// Detects an abrupt step ("breakpoint") in an annual series.
//
// Gridded reanalyses such as MERRA-2 (behind NASA POWER) change when the observing system they
// assimilate changes. Over the Bengal delta, for example, NASA POWER shows a ≈1 °C drop and a
// ≈70 % rainfall jump in 1997 — an artefact, not a climate shift. Trends across such a step are
// meaningless, so we test for one before computing them.
//
// Method: two-phase regression with a common slope (Lund & Reeves 2002, J. Climate 15:2547):
//   H0: y = a + b·t        H1: y = a + b·t + d·[t ≥ k]
// F = (SSE0 − SSE1) / (SSE1 / (n − 3)), maximised over k with ≥ MIN_SEGMENT years on each side.
// Critical values of max-F at the 99 % level were obtained by Monte Carlo (20 000 white-noise
// series per length; scripts in the project history) and agree with the published tables.

export const MIN_SEGMENT = 8;
const CRIT_99: [number, number][] = [[20, 13.0], [25, 14.3], [30, 14.5], [35, 14.5], [40, 14.5], [45, 14.6], [50, 14.6]];

function critical(n: number) {
  if (n <= CRIT_99[0][0]) return CRIT_99[0][1];
  for (let i = 1; i < CRIT_99.length; i++) {
    const [n1, c1] = CRIT_99[i];
    if (n <= n1) { const [n0, c0] = CRIT_99[i - 1]; return c0 + ((c1 - c0) * (n - n0)) / (n1 - n0); }
  }
  return CRIT_99[CRIT_99.length - 1][1];
}

function sseLinear(y: number[]) {
  const n = y.length, mx = (n - 1) / 2, my = y.reduce((s, v) => s + v, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (i - mx) ** 2; sxy += (i - mx) * (y[i] - my); }
  const b = sxy / sxx;
  let s = 0;
  for (let i = 0; i < n; i++) s += (y[i] - my - b * (i - mx)) ** 2;
  return s;
}

/** OLS fit of y on [1, t, step(k)]; returns residual sum of squares and the step size. */
function fitStep(y: number[], k: number) {
  const n = y.length;
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], c = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = [1, i, i >= k ? 1 : 0];
    for (let a = 0; a < 3; a++) { c[a] += x[a] * y[i]; for (let b = 0; b < 3; b++) A[a][b] += x[a] * x[b]; }
  }
  const M = A.map((r, i) => [...r, c[i]]);
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    if (Math.abs(M[i][i]) < 1e-12) return null;
    for (let r = 0; r < 3; r++) if (r !== i) { const f = M[r][i] / M[i][i]; for (let cc = i; cc < 4; cc++) M[r][cc] -= f * M[i][cc]; }
  }
  const beta = M.map((r, i) => r[3] / r[i]);
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (y[i] - (beta[0] + beta[1] * i + (i >= k ? beta[2] : 0))) ** 2;
  return { sse, step: beta[2] };
}

export interface BreakResult { year: number; step: number; f: number }

/**
 * Returns the most likely break year when a step is statistically significant (99 %) AND large
 * enough to matter (|step| ≥ minStep, in the series' units), otherwise null.
 */
export function detectBreak(years: number[], values: (number | null)[], minStep: number): BreakResult | null {
  const pts = years.map((y, i) => [y, values[i]] as const).filter((p): p is readonly [number, number] => p[1] !== null && Number.isFinite(p[1]));
  const n = pts.length;
  if (n < 2 * MIN_SEGMENT + 2) return null;
  const y = pts.map(p => p[1]);
  const sse0 = sseLinear(y);
  let best: BreakResult | null = null;
  for (let k = MIN_SEGMENT; k <= n - MIN_SEGMENT; k++) {
    const fit = fitStep(y, k);
    if (!fit || fit.sse <= 0) continue;
    const f = (sse0 - fit.sse) / (fit.sse / (n - 3));
    if (!best || f > best.f) best = { year: pts[k][0], step: fit.step, f };
  }
  if (!best || best.f < critical(n) || Math.abs(best.step) < minStep) return null;
  return best;
}

/** Practical thresholds: steps smaller than these are not worth flagging even if "significant". */
export const MIN_TEMP_STEP = 0.3; // °C
export const MIN_RAIN_STEP_FRACTION = 0.15; // of the series mean
