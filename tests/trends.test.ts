import { describe, expect, it } from "vitest";
import { fdrThreshold, mannKendall, normCdf, senSlope } from "@/lib/trends";
import { analyseGrid, seasonal } from "@/lib/trend-lab";

const rng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) - 0.5;
const years = Array.from({ length: 45 }, (_, i) => 1981 + i);

describe("normal distribution", () => {
  it("matches tables", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normCdf(-2.576)).toBeCloseTo(0.005, 3);
  });
});

describe("Sen's slope", () => {
  it("is the median pairwise slope and ignores an outlier", () => {
    const x = [1, 2, 3, 4, 5, 6, 7], y = [2, 4, 6, 8, 10, 12, 100];
    expect(senSlope(x, y)).toBe(2);
  });
});

describe("Mann–Kendall", () => {
  it("detects a monotonic trend and recovers its slope", () => {
    const r = rng(1);
    const mk = mannKendall(years, years.map(y => 0.03 * (y - 1981) + r() * 0.3))!;
    expect(mk.p).toBeLessThan(0.001);
    expect(mk.slope).toBeCloseTo(0.03, 2);
    expect(mk.tau).toBeGreaterThan(0.5);
  });
  it("finds no trend in noise", () => {
    const r = rng(77);
    expect(mannKendall(years, years.map(() => r()))!.p).toBeGreaterThan(0.05);
  });
  it("skips missing years and needs at least ten", () => {
    expect(mannKendall(years.slice(0, 9), years.slice(0, 9))).toBeNull();
    const ys: (number | null)[] = years.map(y => y - 1981); ys[3] = null;
    expect(mannKendall(years, ys)!.n).toBe(44);
  });
});

describe("Benjamini–Hochberg false-discovery rate", () => {
  it("matches the worked example", () => {
    // Benjamini & Hochberg (1995) style example: sorted p-values, alpha 0.05 → the 4th is the last that passes.
    const p = [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.216];
    expect(fdrThreshold(p, 0.05)).toBe(0.008);
    expect(fdrThreshold(p, 0.25)).toBe(0.216); // 0.205 fails its own bound, but a larger p further up passes
  });
  it("returns −1 when nothing is significant, and handles p = 0", () => {
    expect(fdrThreshold([0.5, 0.7, 0.9])).toBe(-1);
    expect(fdrThreshold([0, 0, 0.9])).toBe(0);
  });
});

describe("Trend Lab grid analysis", () => {
  // Monthly series for two cells: one warming 0.3 °C/decade, one cooling; a third with a 1997 step.
  const monthly = (f: (y: number) => number) => years.flatMap(y => Array.from({ length: 12 }, () => f(y)));
  const r = rng(3);
  const cells = [
    [90, 24, ...monthly(y => 25 + 0.03 * (y - 1981) + r() * 0.1)],
    [91, 24, ...monthly(y => 25 - 0.03 * (y - 1981) + r() * 0.1)],
    [92, 24, ...monthly(y => 25 + (y >= 1997 ? -1 : 0) + r() * 0.1)],
  ];
  it("aggregates seasons, including a winter that spans two years", () => {
    const s = seasonal(cells[0].slice(2) as number[], years, "DJF", "mean");
    expect(s[0]).toBeNull(); // no December 1980
    expect(s[1]).not.toBeNull();
  });
  it("finds rising and falling cells, and confines the stepped cell to after its break", () => {
    const g = analyseGrid(years, cells, "T2M", "ANN", 1981, true);
    expect(g.cells[0].significant && g.cells[0].slope).toBeGreaterThan(0.2);
    expect(g.cells[1].significant && g.cells[1].slope).toBeLessThan(-0.2);
    expect(g.cells[2].breakYear).toBe(1997);
    expect(g.cells[2].from).toBe(1997);
    expect(Math.abs(g.cells[2].slope)).toBeLessThan(0.1);
  });
  it("without the break test, the step is wrongly reported as a significant cooling trend", () => {
    const g = analyseGrid(years, cells, "T2M", "ANN", 1981, false);
    expect(g.cells[2].significant).toBe(true);
    expect(g.cells[2].slope).toBeLessThan(0);
  });
});
