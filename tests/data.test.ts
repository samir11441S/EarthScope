import { describe, expect, it } from "vitest";
import { aqiCategory } from "@/lib/air-quality";
import { computeExtremes, type DailyPower } from "@/lib/extremes";
import { parseShare, shareUrl } from "@/lib/report/share";
import { AR6_GMSL, elevationBand } from "@/lib/sea-level";

describe("air-quality categories (US EPA AQI)", () => {
  it.each([[0, "Good"], [50, "Good"], [51, "Moderate"], [151, "Unhealthy"], [301, "Hazardous"]] as const)("AQI %i → %s", (aqi, label) => {
    expect(aqiCategory(aqi).label).toBe(label);
  });
});

describe("IPCC AR6 sea level", () => {
  it("rises with emissions and with time, with medians inside the likely range", () => {
    const ssps = Object.values(AR6_GMSL);
    for (let i = 1; i < ssps.length; i++) expect(ssps[i][2100].median).toBeGreaterThanOrEqual(ssps[i - 1][2100].median);
    for (const s of ssps) {
      expect(s[2100].median).toBeGreaterThan(s[2050].median);
      for (const p of [s[2050], s[2100]]) {
        expect(p.likely[0]).toBeLessThanOrEqual(p.median);
        expect(p.likely[1]).toBeGreaterThanOrEqual(p.median);
      }
    }
    expect(AR6_GMSL["SSP2-4.5"][2100].median).toBeCloseTo(0.56, 2);
  });
  it("bands ground height", () => {
    expect(elevationBand(3)).toBe("very-low");
    expect(elevationBand(8)).toBe("low");
    expect(elevationBand(19)).toBe("moderate");
    expect(elevationBand(120)).toBe("high");
  });
});

describe("climate extremes (ETCCDI-style indices)", () => {
  it("counts hot days, warm nights, heavy rain and dry spells", () => {
    const p: DailyPower = { T2M_MAX: {}, T2M_MIN: {}, T2MWET: {}, PRECTOTCORR: {} };
    for (let i = 0; i < 365; i++) {
      const k = new Date(Date.UTC(2021, 0, 1 + i)).toISOString().slice(0, 10).replace(/-/g, "");
      p.T2M_MAX[k] = i < 10 ? 36 : 30;
      p.T2M_MIN[k] = i < 20 ? 26 : 20;
      p.T2MWET[k] = 22;
      p.PRECTOTCORR[k] = i === 100 ? 80 : i >= 200 && i < 230 ? 0 : 3;
    }
    const [y] = computeExtremes(p);
    expect(y).toMatchObject({ year: 2021, hotDays: 10, warmNights: 20, heavyRainDays: 1, rx1day: 80, cdd: 30, txx: 36 });
  });
});

describe("report share links", () => {
  const place = { id: "x", name: "Dhaka", country: "Bangladesh", lat: 23.810332, lon: 90.412518 };
  it("round-trips and rounds the location to ~1 km for privacy", () => {
    const url = shareUrl("https://example.org", { place, year: 2025, warming: 2, rainChange: -10, lang: "bn", audience: "planner" });
    const r = parseShare(new URL(url).searchParams.get("report"))!;
    expect(r).toMatchObject({ year: 2025, warming: 2, rainChange: -10, lang: "bn", audience: "planner" });
    expect(r.place).toMatchObject({ name: "Dhaka", lat: 23.81, lon: 90.41 });
  });
  it("rejects tampered or oversized links and strips markup", () => {
    expect(parseShare("not-base64!")).toBeNull();
    expect(parseShare("A".repeat(700))).toBeNull();
    const evil = Buffer.from(JSON.stringify({ p: [1, 2, "<script>x</script>", "y"], y: 9999, w: 99 })).toString("base64url");
    const r = parseShare(evil)!;
    expect(r.place.name).not.toMatch(/[<>]/);
    expect(r.year).toBe(2050);
    expect(r.warming).toBe(4);
  });
});
