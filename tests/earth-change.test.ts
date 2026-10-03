import { describe, expect, it } from "vitest";
import { compareLst, lstAt, lstComposites, ndviComposites } from "@/lib/earth-change";
import LST from "@/lib/lst-palette.json";

const PAL = LST as number[][];
const pixel = (rgb: number[]) => new Uint8ClampedArray([...rgb, 255]);

describe("land-surface temperature decoding", () => {
  it("decodes every GIBS colour-map entry exactly", () => {
    for (const [r, g, b, c] of PAL) expect(lstAt(pixel([r, g, b]), 0)).toBe(c);
  });
  it("treats transparent pixels (cloud) as missing", () => {
    expect(lstAt(new Uint8ClampedArray([255, 0, 0, 0]), 0)).toBeNull();
  });
  it("covers the physical range in 0.6 K steps", () => {
    const vals = PAL.map(e => e[3]);
    expect(Math.min(...vals)).toBeLessThan(-70);
    expect(Math.max(...vals)).toBeGreaterThan(75);
    expect(vals[1] - vals[0]).toBeCloseTo(0.6, 5);
  });
});

describe("compareLst", () => {
  // 10×10 scenes in palette colours: the second year is 2 °C warmer everywhere,
  // and one 2×5 block warmed a further 5 °C (e.g. new buildings).
  const colourFor = (c: number) => PAL.reduce((a, e) => (Math.abs(e[3] - c) < Math.abs(a[3] - c) ? e : a));
  const scene = (f: (x: number, y: number) => number) => {
    const im = new ImageData(10, 10);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) { const [r, g, b] = colourFor(f(x, y)); im.data.set([r, g, b, 255], (y * 10 + x) * 4); }
    return im;
  };
  const c = compareLst([scene(() => 30)], [scene((x, y) => (x < 2 && y < 5 ? 37 : 32))]);

  it("measures the area-mean change", () => expect(c.meanB - c.meanA).toBeCloseTo(2.5, 0));
  it("flags only places that warmed more than the area as a whole", () => {
    expect(c.warmerPct).toBeCloseTo(10, 0);
    expect(c.coolerPct).toBe(0);
  });
  it("reports full clear-sky coverage", () => expect(c.coverage).toBe(1));
});

describe("composite calendars", () => {
  it("lists the MOD11A2 8-day composites that start in April", () => {
    expect(lstComposites(2023, 4, new Date("2030-01-01"))).toEqual(["2023-04-07", "2023-04-15", "2023-04-23"]);
  });
  it("lists MOD13Q1 16-day composites from the chosen month", () => {
    expect(ndviComposites(2023, 3, 3, new Date("2030-01-01"))).toEqual(["2023-03-06", "2023-03-22", "2023-04-07"]);
  });
});
