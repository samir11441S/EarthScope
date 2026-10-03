import { describe, expect, it } from "vitest";
import { detectBreak, MIN_TEMP_STEP } from "@/lib/homogeneity";
import { calculateTrend, homogeneity, parsePower, type NasaPowerRaw } from "@/lib/climate";
import dhaka from "@/lib/dhaka-power.json";

const rng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) - 0.5;
const years = Array.from({ length: 45 }, (_, i) => 1981 + i);

describe("detectBreak (Lund & Reeves two-phase regression)", () => {
  it("finds an artificial 1 °C step at the right year", () => {
    const r = rng(11);
    const b = detectBreak(years, years.map(y => 25 + 0.02 * (y - 1981) - (y >= 1997 ? 1 : 0) + r() * 0.4), MIN_TEMP_STEP);
    expect(b?.year).toBe(1997);
    expect(b!.step).toBeCloseTo(-1, 0);
  });

  it("does not mistake a steady trend for a step", () => {
    const r = rng(5);
    expect(detectBreak(years, years.map(y => 25 + 0.03 * (y - 1981) + r() * 0.4), MIN_TEMP_STEP)).toBeNull();
  });

  it("ignores steps too small to matter", () => {
    expect(detectBreak(years, years.map(y => 25 + (y >= 2000 ? 0.1 : 0)), MIN_TEMP_STEP)).toBeNull();
  });
});

describe("NASA POWER Dhaka record (regression test)", () => {
  const data = parsePower(dhaka as unknown as NasaPowerRaw);

  it("parses 45 complete years", () => {
    expect(data.annual[0].year).toBe(1981);
    expect(data.annual.at(-1)!.year).toBe(2025);
  });

  it("detects the 1997 artefact and trends only the consistent part", () => {
    const h = homogeneity(data.annual);
    expect(h.tempBreak?.year).toBe(1997);
    expect(h.tempBreak!.step).toBeLessThan(-0.5);
    const t = calculateTrend(data.annual);
    expect(t.years[0]).toBe(1997);
    expect(t.direction).not.toBe("cooling"); // the naive full-record trend would say "cooling"
  });
});
