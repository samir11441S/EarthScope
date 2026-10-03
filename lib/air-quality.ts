// Air quality: hourly forecast from the Copernicus Atmosphere Monitoring Service (CAMS) via
// Open-Meteo, categorised with the US EPA Air Quality Index and compared with the WHO 2021
// PM2.5 guideline (15 µg/m³, 24-hour mean).
export interface AirDay { date: string; maxAqi: number; meanPm25: number }
export interface AirQuality {
  lat: number; lon: number;
  current: { time: string; aqi: number; pm25: number; pm10: number; no2: number; o3: number };
  days: AirDay[]; // today + 4 days
  peakAqi: number; // highest hourly AQI over the next 72 h
  source: string;
}

export const WHO_PM25_24H = 15; // µg/m³
export const AIR_SOURCE = "Copernicus Atmosphere Monitoring Service (CAMS) via Open-Meteo · US EPA AQI · WHO 2021 guideline";

/* i18n */
export const AQI_CATEGORIES = [
  { max: 50, label: "Good", color: "#34c759", rank: 0, advice: "Air quality is good. Enjoy outdoor activity." },
  { max: 100, label: "Moderate", color: "#f2d16b", rank: 1, advice: "Unusually sensitive people should consider limiting long or heavy outdoor exertion." },
  { max: 150, label: "Unhealthy for sensitive groups", color: "#ffa347", rank: 2, advice: "Children, older adults and people with asthma or heart disease should reduce long or heavy outdoor exertion." },
  { max: 200, label: "Unhealthy", color: "#ff5a4f", rank: 3, advice: "Everyone should reduce long or heavy outdoor exertion; sensitive groups should avoid it. Wear a well-fitting N95/KN95 mask outdoors." },
  { max: 300, label: "Very unhealthy", color: "#b3134a", rank: 4, advice: "Avoid outdoor exertion. Keep windows closed, use a mask outdoors and run an air purifier if you have one." },
  { max: Infinity, label: "Hazardous", color: "#7e0023", rank: 5, advice: "Health emergency: stay indoors with windows closed and avoid all outdoor activity." },
] as const;
/* /i18n */

export const aqiCategory = (aqi: number) => AQI_CATEGORIES.find(c => aqi <= c.max) ?? AQI_CATEGORIES[AQI_CATEGORIES.length - 1];

interface OpenMeteoAir {
  current?: { time: string; us_aqi: number; pm2_5: number; pm10: number; nitrogen_dioxide: number; ozone: number };
  hourly?: { time: string[]; us_aqi: (number | null)[]; pm2_5: (number | null)[] };
}

export async function fetchAirQuality(lat: number, lon: number): Promise<AirQuality> {
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone&hourly=us_aqi,pm2_5&forecast_days=5&timezone=auto`;
  const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`air quality ${r.status}`);
  const j = (await r.json()) as OpenMeteoAir;
  if (!j.current || !j.hourly) throw new Error("air quality: incomplete response");
  const byDay = new Map<string, { aqi: number[]; pm: number[] }>();
  j.hourly.time.forEach((t, i) => {
    const d = t.slice(0, 10), a = j.hourly!.us_aqi[i], p = j.hourly!.pm2_5[i];
    if (!byDay.has(d)) byDay.set(d, { aqi: [], pm: [] });
    if (typeof a === "number") byDay.get(d)!.aqi.push(a);
    if (typeof p === "number") byDay.get(d)!.pm.push(p);
  });
  const days = [...byDay].filter(([, v]) => v.aqi.length).map(([date, v]) => ({ date, maxAqi: Math.max(...v.aqi), meanPm25: v.pm.reduce((s, x) => s + x, 0) / Math.max(1, v.pm.length) }));
  const nowIdx = Math.max(0, j.hourly.time.findIndex(t => t >= j.current!.time));
  const next72 = j.hourly.us_aqi.slice(nowIdx, nowIdx + 72).filter((v): v is number => typeof v === "number");
  const c = j.current;
  return { lat, lon, current: { time: c.time, aqi: c.us_aqi, pm25: c.pm2_5, pm10: c.pm10, no2: c.nitrogen_dioxide, o3: c.ozone }, days, peakAqi: Math.max(c.us_aqi, ...next72), source: AIR_SOURCE };
}
