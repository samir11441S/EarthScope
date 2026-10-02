import { bearingDeg, compass, distanceKm, pointInGeometry, type Geometry } from "./geo";

export type HazardType = "earthquake" | "storm" | "flood" | "wildfire" | "volcano" | "drought" | "landslide" | "heat" | "dust" | "ice" | "other";
export type Severity = "red" | "orange" | "green" | "info";

/** "new" = first reported in the last 24 h · "ongoing" = still active and updated recently. */
export type Phase = "new" | "ongoing";
export interface ForecastPoint { lat: number; lon: number; time: string }
export interface Zone { level: Severity; label?: string; geometry: Geometry }

export interface Hazard {
  id: string;
  type: HazardType;
  title: string;
  lat: number; // latest observed position
  lon: number;
  date: string; // ISO time of the latest observation / update
  started?: string; // ISO time the event began
  phase: Phase;
  severity: Severity; // current alert level (not the event's lifetime maximum)
  detail?: string; // magnitude, wind speed, area …
  radiusKm: number; // approximate impact zone used for the safety check
  sources: { name: string; url?: string }[];
  track?: [number, number][]; // [lat, lon] observed history, oldest first (storms)
  country?: string;
  zones?: Zone[]; // measured footprint now: cyclone wind zones, flooded area
  forecast?: ForecastPoint[]; // predicted future positions (cyclones)
  cone?: Geometry; // forecast uncertainty cone
  forecastZones?: Zone[]; // wind zones over the whole forecast period
}

export interface HazardFeed {
  hazards: Hazard[];
  updated: string;
  feeds: { name: string; ok: boolean; count: number }[];
}

export const HAZARD_META: Record<HazardType, { label: string; color: string; icon: string }> = {
  earthquake: { label: "Earthquake", color: "#f0a35e", icon: "〰" },
  storm: { label: "Cyclone / storm", color: "#8fb8ff", icon: "🌀" },
  flood: { label: "Flood", color: "#52c7e0", icon: "🌊" },
  wildfire: { label: "Wildfire", color: "#ff6b4a", icon: "🔥" },
  volcano: { label: "Volcano", color: "#e05252", icon: "🌋" },
  drought: { label: "Drought", color: "#d9b36c", icon: "☀" },
  landslide: { label: "Landslide", color: "#b58a63", icon: "⛰" },
  heat: { label: "Extreme heat", color: "#ff8f6b", icon: "🌡" },
  dust: { label: "Dust / haze", color: "#c9ae8a", icon: "🌫" },
  ice: { label: "Sea & lake ice", color: "#bfe6ff", icon: "❄" },
  other: { label: "Other", color: "#b9c4b0", icon: "•" },
};

export const SEVERITY_META: Record<Severity, { label: string; color: string; rank: number }> = {
  red: { label: "Red alert", color: "#ff5a4f", rank: 3 },
  orange: { label: "Orange alert", color: "#ffa347", rank: 2 },
  green: { label: "Green alert", color: "#8fd27a", rank: 1 },
  info: { label: "Monitored", color: "#9fb0a0", rank: 0 },
};

/** Rough radius (km) of the area where strong effects are plausible. It is a screening aid, not a hazard model. */
export function impactRadius(type: HazardType, severity: Severity, opts: { magnitude?: number; windKts?: number; acres?: number; bboxKm?: number } = {}) {
  const sev = { red: 1.6, orange: 1.3, green: 1, info: 1 }[severity];
  switch (type) {
    case "earthquake": {
      const m = opts.magnitude ?? 5;
      return Math.round(Math.min(500, 10 ** (0.4 * m - 0.6)));
    }
    case "storm": {
      const w = opts.windKts;
      const base = w === undefined ? 150 : w >= 96 ? 320 : w >= 64 ? 250 : w >= 34 ? 180 : 110;
      return Math.round(base * (w === undefined ? sev : 1));
    }
    case "flood": return Math.round(Math.min(400, Math.max(60 * sev, (opts.bboxKm ?? 0) / 2)));
    case "wildfire": return Math.round(opts.acres ? Math.min(80, Math.sqrt((opts.acres * 0.004047) / Math.PI) + 10) : 15 * sev);
    case "volcano": return Math.round(20 * sev);
    case "drought": return Math.round(Math.min(700, Math.max(200, (opts.bboxKm ?? 0) / 2)));
    case "landslide": return 10;
    case "heat": return 200;
    case "dust": return 150;
    default: return 25;
  }
}

export type SafetyLevel = "danger" | "caution" | "clear";
export interface Threat { hazard: Hazard; distanceKm: number; inside: boolean; upcoming?: { eta: string }; awayDirection: string }
export interface SafetyAssessment { level: SafetyLevel; threats: Threat[] }

/** Inside the measured footprint when the agency publishes one, otherwise inside the approximate radius. */
export function insideNow(h: Hazard, lat: number, lon: number) {
  if (h.zones?.length) return h.zones.some(z => pointInGeometry(lon, lat, z.geometry));
  return distanceKm(lat, lon, h.lat, h.lon) <= h.radiusKm;
}

/** In the forecast path (cone or forecast wind zones): returns the time the storm passes closest. */
export function inForecastPath(h: Hazard, lat: number, lon: number): { eta: string } | null {
  if (!h.forecast?.length) return null;
  const hit = (h.cone && pointInGeometry(lon, lat, h.cone)) || h.forecastZones?.some(z => pointInGeometry(lon, lat, z.geometry));
  if (!hit) return null;
  let best = h.forecast[0], bd = Infinity;
  for (const p of h.forecast) { const d = distanceKm(lat, lon, p.lat, p.lon); if (d < bd) { bd = d; best = p; } }
  return { eta: best.time };
}

/** Classify a location against current hazard footprints and forecast paths. */
export function assessSafety(lat: number, lon: number, hazards: Hazard[]): SafetyAssessment {
  const threats: Threat[] = [];
  for (const h of hazards) {
    if (h.type === "ice") continue;
    const d = distanceKm(lat, lon, h.lat, h.lon);
    const inside = insideNow(h, lat, lon);
    const upcoming = inside ? null : inForecastPath(h, lat, lon);
    if (!inside && !upcoming && d > h.radiusKm * 2) continue;
    threats.push({ hazard: h, distanceKm: d, inside, upcoming: upcoming ?? undefined, awayDirection: compass(bearingDeg(h.lat, h.lon, lat, lon)) });
  }
  threats.sort((a, b) => Number(b.inside) - Number(a.inside) || Number(!!b.upcoming) - Number(!!a.upcoming) || SEVERITY_META[b.hazard.severity].rank - SEVERITY_META[a.hazard.severity].rank || a.distanceKm - b.distanceKm);
  const level: SafetyLevel = threats.some(t => t.inside) ? "danger" : threats.length ? "caution" : "clear";
  return { level, threats };
}

export const isInsideAnyZone = (lat: number, lon: number, hazards: Hazard[]) => hazards.some(h => h.type !== "ice" && insideNow(h, lat, lon));

/** Short, widely published protective actions (Ready.gov / IFRC style). */
export const GUIDANCE: Record<HazardType, string[]> = {
  earthquake: ["Drop, cover and hold on during shaking.", "After shaking, move to open ground away from buildings, walls and power lines.", "Expect aftershocks; do not re-enter damaged buildings."],
  storm: ["Go to a designated cyclone shelter or a strong building before winds arrive.", "Stay indoors away from windows until authorities say it is safe.", "Coastal and low-lying areas: evacuate early; storm surge is the biggest killer."],
  flood: ["Move to higher ground or an upper floor now.", "Never walk or drive through flood water — 15 cm of moving water can knock you down.", "Switch off electricity if water may enter your home."],
  wildfire: ["Leave early if told to evacuate; do not wait to see the flames.", "Move away from the fire and downwind smoke; keep windows closed.", "Wear an N95 mask if smoke is heavy."],
  volcano: ["Follow evacuation orders; avoid river valleys (mudflow paths).", "Stay indoors during ash fall and wear a mask or damp cloth.", "Protect eyes and avoid driving in heavy ash."],
  drought: ["Store safe drinking water and follow water-use restrictions.", "Check on vulnerable neighbours, livestock and crops.", "Watch for heat illness and wildfire risk."],
  landslide: ["Move away from the slide path and steep slopes.", "Watch for tilting trees, cracks and sudden changes in stream flow.", "Avoid river valleys during heavy rain."],
  heat: ["Stay in shade or cool indoor spaces during the hottest hours.", "Drink water regularly; check on older people and children.", "Know the signs of heat stroke: confusion, hot dry skin — call emergency services."],
  dust: ["Stay indoors with windows closed.", "Use a mask outdoors; people with asthma should keep medication ready.", "Drive slowly with headlights on in low visibility."],
  ice: ["Follow maritime notices for navigation hazards."],
  other: ["Follow instructions from local authorities."],
};

export type SafePlaceKind = "shelter" | "assembly" | "hospital" | "fire" | "community";
export interface SafePlace { id: string; name: string; kind: SafePlaceKind; lat: number; lon: number }
export const SAFE_PLACE_META: Record<SafePlaceKind, { label: string; color: string; icon: string }> = {
  shelter: { label: "Emergency shelter", color: "#c6f27c", icon: "⛺" },
  assembly: { label: "Assembly point", color: "#9be7a4", icon: "⚑" },
  hospital: { label: "Hospital", color: "#7fd3ff", icon: "✚" },
  fire: { label: "Fire station", color: "#ffb36b", icon: "🚒" },
  community: { label: "Community centre", color: "#d7c8ff", icon: "⌂" },
};
