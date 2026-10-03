import { fetchAirQuality } from "@/lib/air-quality";
import { isFiniteCoord } from "@/lib/geo";

// Current air quality and a 5-day forecast for a point (CAMS via Open-Meteo), cached 30 minutes.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const lat = Number(q.get("lat")), lon = Number(q.get("lon"));
  if (!q.get("lat") || !q.get("lon") || !isFiniteCoord(lat, lon)) return Response.json({ error: "A valid latitude and longitude are required." }, { status: 400 });
  try {
    return Response.json(await fetchAirQuality(lat, lon), { headers: { "Cache-Control": "public, max-age=1800" } });
  } catch {
    return Response.json({ error: "Air-quality data is unavailable right now." }, { status: 502 });
  }
}
