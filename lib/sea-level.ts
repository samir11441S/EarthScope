// Global mean sea-level rise projections assessed by the IPCC Sixth Assessment Report (AR6 WGI,
// Table 9.9 / SPM B.5.3; Fox-Kemper et al. 2021), in metres relative to 1995–2014: median and
// "likely" (17th–83rd percentile) range. Medium-confidence processes only.
export type Ssp = "SSP1-1.9" | "SSP1-2.6" | "SSP2-4.5" | "SSP3-7.0" | "SSP5-8.5";
export interface SeaLevelProjection { median: number; likely: [number, number] }

export const AR6_GMSL: Record<Ssp, { 2050: SeaLevelProjection; 2100: SeaLevelProjection }> = {
  "SSP1-1.9": { 2050: { median: 0.18, likely: [0.15, 0.23] }, 2100: { median: 0.38, likely: [0.28, 0.55] } },
  "SSP1-2.6": { 2050: { median: 0.19, likely: [0.16, 0.25] }, 2100: { median: 0.44, likely: [0.32, 0.62] } },
  "SSP2-4.5": { 2050: { median: 0.20, likely: [0.17, 0.26] }, 2100: { median: 0.56, likely: [0.44, 0.76] } },
  "SSP3-7.0": { 2050: { median: 0.22, likely: [0.18, 0.27] }, 2100: { median: 0.68, likely: [0.55, 0.90] } },
  "SSP5-8.5": { 2050: { median: 0.23, likely: [0.20, 0.29] }, 2100: { median: 0.77, likely: [0.63, 1.01] } },
};
/** Scenarios shown in the app (low, middle, high emissions). */
export const SHOWN_SSPS: Ssp[] = ["SSP1-2.6", "SSP2-4.5", "SSP5-8.5"];

export const OBSERVED_GMSL = { since1901: 0.20, range: [0.15, 0.25] as [number, number], rate2006_2018: 3.7 }; // m, m, mm/yr (AR6 SPM A.1.7)
export const SEA_LEVEL_SOURCES = [
  "IPCC AR6 WGI (2021), Table 9.9 and SPM B.5.3 — global mean sea-level projections",
  "Copernicus GLO-90 digital elevation model via Open-Meteo (ground height)",
  "Becker et al. (2020), PNAS 117(4) — subsidence and relative sea-level rise in the Ganges–Brahmaputra–Meghna delta",
];

/** Whether a place is in the Ganges–Brahmaputra–Meghna delta region, where land subsidence adds to sea-level rise. */
export const inBengalDelta = (lat: number, lon: number) => lat > 20.5 && lat < 25.5 && lon > 88 && lon < 92.8;

export type ElevationBand = "very-low" | "low" | "moderate" | "high";
export const elevationBand = (m: number): ElevationBand => (m < 5 ? "very-low" : m < 10 ? "low" : m < 30 ? "moderate" : "high");
