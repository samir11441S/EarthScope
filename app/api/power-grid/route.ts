import { RECORD_END, RECORD_START } from "@/lib/climate";

// Annual NASA POWER (MERRA-2) grid cells for one 10°×10° tile, compacted for the map.
// Tiles are aligned to multiples of 10° so the same tile is cached and reused across countries.

const FIRST_YEAR = RECORD_START, LAST_YEAR = RECORD_END;

interface PowerRegional { features?: { geometry: { coordinates: number[] }; properties: { parameter: Record<string, Record<string, number>> } }[] }

async function fetchParam(param: "T2M" | "PRECTOTCORR", lat0: number, lon0: number) {
  const url = new URL("https://power.larc.nasa.gov/api/temporal/monthly/regional");
  url.search = new URLSearchParams({
    parameters: param, community: "RE", "latitude-min": String(lat0), "latitude-max": String(Math.min(90, lat0 + 10)),
    "longitude-min": String(lon0), "longitude-max": String(Math.min(180, lon0 + 10)), start: String(FIRST_YEAR), end: String(LAST_YEAR), format: "JSON",
  }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw new Error(`POWER ${res.status}`);
  return ((await res.json()) as PowerRegional).features ?? [];
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const lat0 = Number(q.get("lat")), lon0 = Number(q.get("lon"));
  if (!Number.isInteger(lat0) || !Number.isInteger(lon0) || lat0 % 10 || lon0 % 10 || lat0 < -90 || lat0 > 80 || lon0 < -180 || lon0 > 170)
    return Response.json({ error: "Tile origin must be a multiple of 10 degrees." }, { status: 400 });
  try {
    const [temp, rain] = await Promise.all([fetchParam("T2M", lat0, lon0), fetchParam("PRECTOTCORR", lat0, lon0)]);
    const years = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);
    const rainByCell = new Map<string, Record<string, number>>();
    for (const f of rain) rainByCell.set(`${f.geometry.coordinates[0]},${f.geometry.coordinates[1]}`, f.properties.parameter.PRECTOTCORR);
    const cells: (number | null)[][] = [];
    for (const f of temp) {
      const [lon, lat] = f.geometry.coordinates;
      const t = f.properties.parameter.T2M, p = rainByCell.get(`${lon},${lat}`);
      const row: (number | null)[] = [lon, lat];
      for (const y of years) { const v = t?.[`${y}13`]; row.push(Number.isFinite(v) && v !== -999 ? Math.round(v * 100) / 100 : null); }
      for (const y of years) {
        const v = p?.[`${y}13`]; // annual mean of daily totals, mm/day
        const days = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 366 : 365;
        row.push(Number.isFinite(v) && v !== undefined && v >= 0 ? Math.round(v * days) : null);
      }
      cells.push(row);
    }
    return Response.json({ years, cells }, { headers: { "Cache-Control": "public, max-age=2592000, immutable" } });
  } catch {
    return Response.json({ error: "NASA POWER grid data is temporarily unavailable." }, { status: 502 });
  }
}
