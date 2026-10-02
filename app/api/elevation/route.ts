import { isFiniteCoord } from "@/lib/geo";

// Ground elevation (metres above sea level) from the Copernicus GLO-90 DEM via Open-Meteo.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const lat = Number(q.get("lat")), lon = Number(q.get("lon"));
  if (!q.get("lat") || !q.get("lon") || !isFiniteCoord(lat, lon)) return Response.json({ error: "A valid latitude and longitude are required." }, { status: 400 });
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`, { signal: AbortSignal.timeout(10000) });
    const j = (await r.json()) as { elevation?: number[] };
    const elevation = j.elevation?.[0];
    if (!r.ok || typeof elevation !== "number" || !Number.isFinite(elevation)) throw new Error();
    return Response.json({ elevation, source: "Copernicus GLO-90 DEM via Open-Meteo" }, { headers: { "Cache-Control": "public, max-age=2592000" } });
  } catch {
    return Response.json({ error: "Elevation data is unavailable right now." }, { status: 502 });
  }
}
