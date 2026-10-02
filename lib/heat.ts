// Heat stress: Bangladesh Meteorological Department (BMD) heatwave classes from the daily maximum
// temperature, and the US National Weather Service heat index (Rothfusz regression with the NWS
// adjustments) from hourly temperature and humidity — humid heat is what makes Bangladesh dangerous.

export type HeatLevel = "none" | "caution" | "extreme-caution" | "danger" | "extreme-danger";

export interface HeatDay {
  date: string;
  tmax: number; // °C
  feelsMax: number; // model "apparent temperature" max, °C
  heatIndexMax: number; // NWS heat index max, °C
  bmd: "none" | "mild" | "moderate" | "severe" | "very-severe";
  level: HeatLevel; // NWS heat index category
}

export interface HeatOutlook { lat: number; lon: number; days: HeatDay[]; peak: HeatDay; source: string }

/** NWS heat index (°C) from air temperature (°C) and relative humidity (%). */
export function heatIndexC(tC: number, rh: number): number {
  const T = tC * 9 / 5 + 32;
  let hi = 0.5 * (T + 61 + (T - 68) * 1.2 + rh * 0.094);
  if ((hi + T) / 2 >= 80) {
    hi = -42.379 + 2.04901523 * T + 10.14333127 * rh - 0.22475541 * T * rh - 0.00683783 * T * T - 0.05481717 * rh * rh
      + 0.00122874 * T * T * rh + 0.00085282 * T * rh * rh - 0.00000199 * T * T * rh * rh;
    if (rh < 13 && T >= 80 && T <= 112) hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
    else if (rh > 85 && T >= 80 && T <= 87) hi += ((rh - 85) / 10) * ((87 - T) / 5);
  }
  return ((hi - 32) * 5) / 9;
}

/** NWS heat index categories (°C): 27 caution · 32 extreme caution · 41 danger · 54 extreme danger. */
export function heatLevel(hiC: number): HeatLevel {
  return hiC >= 54 ? "extreme-danger" : hiC >= 41 ? "danger" : hiC >= 32 ? "extreme-caution" : hiC >= 27 ? "caution" : "none";
}

/** BMD heatwave classes by daily maximum temperature: 36 mild · 38 moderate · 40 severe · 42 very severe. */
export function bmdClass(tmax: number): HeatDay["bmd"] {
  return tmax >= 42 ? "very-severe" : tmax >= 40 ? "severe" : tmax >= 38 ? "moderate" : tmax >= 36 ? "mild" : "none";
}

export const HEAT_META: Record<HeatLevel, { label: string; color: string; rank: number }> = {
  none: { label: "No heat stress", color: "#8fd27a", rank: 0 },
  caution: { label: "Caution", color: "#f2d16b", rank: 1 },
  "extreme-caution": { label: "Extreme caution", color: "#ffa347", rank: 2 },
  danger: { label: "Danger", color: "#ff5a4f", rank: 3 },
  "extreme-danger": { label: "Extreme danger", color: "#b3134a", rank: 4 },
};

export const BMD_LABEL: Record<HeatDay["bmd"], string> = {
  none: "No heatwave", mild: "Mild heatwave", moderate: "Moderate heatwave", severe: "Severe heatwave", "very-severe": "Very severe heatwave",
};

/** Is this outlook worth warning about? Danger-level humid heat or a BMD moderate-or-worse heatwave. */
export const heatAlert = (d: HeatDay) => HEAT_META[d.level].rank >= 3 || ["moderate", "severe", "very-severe"].includes(d.bmd);

export const HEAT_SOURCE = "Open-Meteo forecast (ECMWF / GFS / national models); heat index after NOAA NWS; heatwave classes after Bangladesh Meteorological Department";

/** The eight division capitals of Bangladesh, for the national heat watch. */
export const BD_DIVISIONS = [
  { name: "Dhaka", lat: 23.81, lon: 90.41 }, { name: "Chattogram", lat: 22.36, lon: 91.78 }, { name: "Khulna", lat: 22.85, lon: 89.54 },
  { name: "Rajshahi", lat: 24.37, lon: 88.6 }, { name: "Rangpur", lat: 25.75, lon: 89.25 }, { name: "Sylhet", lat: 24.9, lon: 91.87 },
  { name: "Barishal", lat: 22.7, lon: 90.35 }, { name: "Mymensingh", lat: 24.75, lon: 90.4 },
];

interface OpenMeteoPoint {
  latitude: number; longitude: number;
  daily: { time: string[]; temperature_2m_max: number[]; apparent_temperature_max: number[] };
  hourly: { time: string[]; temperature_2m: number[]; relative_humidity_2m: number[] };
}

/** 7-day heat outlook for up to 20 points in one request. Server-side helper. */
export async function fetchHeatOutlook(points: { lat: number; lon: number }[]): Promise<HeatOutlook[]> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: points.map(p => p.lat.toFixed(3)).join(","), longitude: points.map(p => p.lon.toFixed(3)).join(","),
    daily: "temperature_2m_max,apparent_temperature_max", hourly: "temperature_2m,relative_humidity_2m",
    forecast_days: "7", timezone: "auto",
  }).toString();
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("Heat forecast unavailable.");
  const raw = (await r.json()) as OpenMeteoPoint | OpenMeteoPoint[];
  return (Array.isArray(raw) ? raw : [raw]).map((p, k) => {
    const days: HeatDay[] = p.daily.time.map((date, i) => {
      let hiMax = -99;
      p.hourly.time.forEach((t, h) => {
        if (!t.startsWith(date)) return;
        const T = p.hourly.temperature_2m[h], RH = p.hourly.relative_humidity_2m[h];
        if (Number.isFinite(T) && Number.isFinite(RH)) hiMax = Math.max(hiMax, heatIndexC(T, RH));
      });
      const tmax = p.daily.temperature_2m_max[i], hi = Math.round(Math.max(hiMax, tmax) * 10) / 10;
      return { date, tmax, feelsMax: p.daily.apparent_temperature_max[i], heatIndexMax: hi, bmd: bmdClass(tmax), level: heatLevel(hi) };
    });
    const peak = days.reduce((a, b) => (b.heatIndexMax > a.heatIndexMax ? b : a), days[0]);
    return { lat: points[k].lat, lon: points[k].lon, days, peak, source: HEAT_SOURCE };
  });
}
