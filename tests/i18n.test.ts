import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { makeI18n, toBnDigits } from "@/lib/i18n";
import { BN } from "@/lib/i18n-bn";

describe("translator", () => {
  const en = makeI18n("en"), bn = makeI18n("bn");
  it("fills placeholders", () => expect(en.t("{n} km away", { n: 12 })).toBe("12 km away"));
  it("translates and writes numbers with Bangla digits", () => expect(bn.t("{n} km away", { n: 12 })).toBe("১২ কিমি দূরে"));
  it("falls back to English for unknown strings", () => expect(bn.t("Not a real string")).toBe("Not a real string"));
  it("formats numbers and years", () => {
    expect(bn.n(1234.5, 1)).toBe("১,২৩৪.৫");
    expect(bn.y(2025)).toBe("২০২৫");
    expect(toBnDigits("M5.0")).toBe("M৫.০");
  });
});

describe("Bangla dictionary", () => {
  const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
  it("keeps every placeholder of the English source", () => {
    for (const [k, v] of Object.entries(BN)) expect(ph(v), k).toBe(ph(k));
  });
  it("has no empty translations", () => {
    for (const [k, v] of Object.entries(BN)) expect(v.trim().length, k).toBeGreaterThan(0);
  });
  it("covers every interface string (scripts/i18n-check.mjs --strict)", () => {
    expect(() => execFileSync(process.execPath, ["scripts/i18n-check.mjs", "--strict"], { stdio: "pipe" })).not.toThrow();
  });
});
