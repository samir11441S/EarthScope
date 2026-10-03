import { describe, expect, it } from "vitest";
import { annualFromDaily, crossCheck, pearson } from "@/lib/crosscheck";

const rng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) - 0.5;

describe("annualFromDaily", () => {
  it("averages temperature, sums rainfall and drops incomplete years", () => {
    const time: string[] = [], t: number[] = [], p: number[] = [];
    for (let d = new Date(Date.UTC(2020, 0, 1)); d < new Date(Date.UTC(2021, 6, 1)); d = new Date(+d + 86_400_000)) {
      time.push(d.toISOString().slice(0, 10));
      t.push(d.getUTCFullYear() === 2020 ? 25 : 30);
      p.push(2);
    }
    const a = annualFromDaily(time, t, p);
    expect(a.years).toEqual([2020]); // 2021 is only half a year
    expect(a.temperature[0]).toBeCloseTo(25);
    expect(a.rainfall[0]).toBeCloseTo(366 * 2);
  });
});

describe("pearson", () => {
  it("is 1 for a linear relation and −1 for its mirror", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1);
  });
});

describe("crossCheck", () => {
  const years = Array.from({ length: 45 }, (_, i) => 1981 + i), r = rng(9);
  const signal = years.map(y => 25 + 0.025 * (y - 1981) + r() * 0.5);
  const era5 = { years, temperature: signal.map(v => v + r() * 0.1), rainfall: years.map(() => 2000 + r() * 300) };

  it("agrees when two datasets share the signal", () => {
    const power = years.map((y, i) => ({ year: y, temperature: signal[i] - 0.3, rainfall: era5.rainfall[i] * 1.1 }));
    const c = crossCheck(power, era5, 1981)!;
    expect(c.verdict).toBe("agree");
    expect(c.tempBias).toBeCloseTo(-0.3, 1);
    expect(c.rainRatio).toBeCloseTo(1.1, 2);
    expect(c.diffBreak).toBeNull();
  });

  it("confirms an artificial step in one dataset through the difference series", () => {
    const power = years.map((y, i) => ({ year: y, temperature: signal[i] - (y >= 1997 ? 1 : 0), rainfall: era5.rainfall[i] }));
    const c = crossCheck(power, era5, 1997)!;
    expect(c.diffBreak?.year).toBe(1997);
    expect(c.diffBreak!.step).toBeCloseTo(-1, 0);
    expect(c.era5Break).toBeNull();
    expect(c.era5FullTrend!.perDecade).toBeCloseTo(0.25, 1);
  });
});
