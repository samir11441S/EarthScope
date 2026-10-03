import { RECORD_END, RECORD_START } from "@/lib/climate";
import { TREND_PARAMS, type TrendParam } from "@/lib/trend-lab";
import { allow, clientKey } from "@/lib/rate-limit";

// Monthly NASA POWER (MERRA-2) values for every grid cell of one 10°×10° tile, for the Trend Lab.
// The browser aggregates seasons and runs the trend tests, so one response serves every season.
// The record does not change, so tiles are cached for 30 days.
export const maxDuration = 60;

interface PowerRegional { features?: { geometry: { coordinates: number[] }; properties: { parameter: Record<string, Record<string, number>> } }[] }

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const param = q.get("param") as TrendParam, lat0 = Number(q.get("lat")), lon0 = Number(q.get("lon"));
  if (!(param in TREND_PARAMS)) return Response.json({ error: "Unknown variable." }, { status: 400 });
  if (!Number.isInteger(lat0) || !Number.isInteger(lon0) || lat0 % 10 || lon0 % 10 || lat0 < -90 || lat0 > 80 || lon0 < -180 || lon0 > 170)
    return Response.json({ error: "Tile origin must be a multiple of 10 degrees." }, { status: 400 });
  if (!(await allow(`trend:${clientKey(request)}`, 30, 60_000, 3000))) return Response.json({ error: "Too many requests — try again in a minute." }, { status: 429 });

  const meta = TREND_PARAMS[param], first = Math.max(RECORD_START, meta.from);
  const url = new URL("https://power.larc.nasa.gov/api/temporal/monthly/regional");
  url.search = new URLSearchParams({
    parameters: param, community: "RE", "latitude-min": String(lat0), "latitude-max": String(Math.min(90, lat0 + 10)),
    "longitude-min": String(lon0), "longitude-max": String(Math.min(180, lon0 + 10)), start: String(first), end: String(RECORD_END), format: "JSON",
  }).toString();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(50000) });
    if (!res.ok) throw new Error(`POWER ${res.status}`);
    const features = ((await res.json()) as PowerRegional).features ?? [];
    const years = Array.from({ length: RECORD_END - first + 1 }, (_, i) => first + i), k = 10 ** meta.decimals;
    // Each cell: [lon, lat, then 12 monthly values per year in order]; missing values are null.
    const cells = features.map(f => {
      const [lon, lat] = f.geometry.coordinates, v = f.properties.parameter[param] ?? {};
      const row: (number | null)[] = [lon, lat];
      for (const y of years) for (let m = 1; m <= 12; m++) {
        const x = v[`${y}${String(m).padStart(2, "0")}`];
        row.push(Number.isFinite(x) && x !== -999 ? Math.round(x * k) / k : null);
      }
      return row;
    });
    return Response.json({ param, years, cells }, { headers: { "Cache-Control": "public, max-age=2592000, s-maxage=2592000" } });
  } catch {
    return Response.json({ error: "NASA POWER grid data is temporarily unavailable." }, { status: 502 });
  }
}
