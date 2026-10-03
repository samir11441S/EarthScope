import { describe, expect, it } from "vitest";
import { formatP, linearTrend, tCritical, tTestPValue } from "@/lib/stats";

// Deterministic pseudo-random noise (no flaky tests).
const rng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) - 0.5;

describe("linearTrend", () => {
  it("recovers an exact slope", () => {
    const xs = Array.from({ length: 30 }, (_, i) => 1990 + i);
    const t = linearTrend(xs, xs.map(x => 0.02 * x + 3))!;
    expect(t.slope).toBeCloseTo(0.02, 10);
    expect(t.significant).toBe(true);
  });

  it("finds a real trend in noisy data, with a 95% interval around the truth", () => {
    const r = rng(7), xs = Array.from({ length: 45 }, (_, i) => 1981 + i);
    const t = linearTrend(xs, xs.map(x => 0.03 * (x - 1981) + r() * 0.6))!;
    expect(t.significant).toBe(true);
    expect(t.ci95[0]).toBeLessThan(0.03);
    expect(t.ci95[1]).toBeGreaterThan(0.03);
  });

  it("does not call pure noise a trend", () => {
    const r = rng(42), xs = Array.from({ length: 40 }, (_, i) => i);
    const t = linearTrend(xs, xs.map(() => r()))!;
    expect(t.pValue).toBeGreaterThan(0.05);
  });

  it("reduces the effective sample size for autocorrelated residuals", () => {
    const xs = Array.from({ length: 40 }, (_, i) => i);
    let v = 0;
    const r = rng(3);
    const t = linearTrend(xs, xs.map(() => (v = 0.8 * v + r())))!;
    expect(t.lag1).toBeGreaterThan(0.3);
    expect(t.nEff).toBeLessThan(t.n);
  });

  it("needs at least four points", () => expect(linearTrend([1, 2, 3], [1, 2, 3])).toBeNull());
});

describe("t distribution", () => {
  it("matches published tables", () => {
    expect(tCritical(1000)).toBeCloseTo(1.962, 2);
    expect(tCritical(10)).toBeCloseTo(2.228, 2);
    expect(tTestPValue(2.228, 10)).toBeCloseTo(0.05, 3);
  });
  it("formats p-values", () => {
    expect(formatP(0.0004)).toBe("p < 0.001");
    expect(formatP(0.004)).toBe("p = 0.004");
    expect(formatP(0.27)).toBe("p = 0.27");
  });
});
