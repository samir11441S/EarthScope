import { RECORD_END, RECORD_START } from "@/lib/climate";
import { annualFromDaily } from "@/lib/crosscheck";
import { isFiniteCoord } from "@/lib/geo";
import { allow, clientKey } from "@/lib/rate-limit";

// ECMWF ERA5 annual climate for a point (Open-Meteo historical archive, 0.25°), used to cross-check
// NASA POWER. The record does not change, so responses are cached for 30 days.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const lat = Number(q.get("lat")), lon = Number(q.get("lon"));
  if (!q.get("lat") || !q.get("lon") || !isFiniteCoord(lat, lon)) return Response.json({ error: "A valid latitude and longitude are required." }, { status: 400 });
  if (!(await allow(`era5:${clientKey(request)}`, 20, 60_000, 2000))) return Response.json({ error: "Too many requests — try again in a minute." }, { status: 429 });
  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.search = new URLSearchParams({
    latitude: lat.toFixed(3), longitude: lon.toFixed(3), start_date: `${RECORD_START}-01-01`, end_date: `${RECORD_END}-12-31`,
    daily: "temperature_2m_mean,precipitation_sum", models: "era5", timezone: "GMT",
  }).toString();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw new Error(`ERA5 ${r.status}`);
    const j = (await r.json()) as { latitude: number; longitude: number; daily?: { time: string[]; temperature_2m_mean: (number | null)[]; precipitation_sum: (number | null)[] } };
    if (!j.daily) throw new Error("ERA5: no daily data");
    const annual = annualFromDaily(j.daily.time, j.daily.temperature_2m_mean, j.daily.precipitation_sum);
    return Response.json({ ...annual, gridLat: j.latitude, gridLon: j.longitude, source: "ECMWF ERA5 reanalysis (Copernicus Climate Change Service) via Open-Meteo" }, { headers: { "Cache-Control": "public, max-age=2592000, s-maxage=2592000" } });
  } catch {
    return Response.json({ error: "The ERA5 cross-check is unavailable right now." }, { status: 502 });
  }
}
