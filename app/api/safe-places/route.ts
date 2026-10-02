import { isFiniteCoord } from "@/lib/geo";
import { findSafePlaces, SAFE_PLACES_SOURCE } from "@/lib/safe-places";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const lat = Number(q.get("lat")), lon = Number(q.get("lon"));
  const radiusKm = Math.min(30, Math.max(2, Number(q.get("radius")) || 12));
  if (!isFiniteCoord(lat, lon)) return Response.json({ error: "A valid latitude and longitude are required." }, { status: 400 });
  try {
    const places = await findSafePlaces(lat, lon, radiusKm);
    return Response.json({ places, radiusKm, source: SAFE_PLACES_SOURCE }, { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Emergency facility search is unavailable right now." }, { status: 502 });
  }
}
