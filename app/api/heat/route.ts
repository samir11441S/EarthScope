import { isFiniteCoord } from "@/lib/geo";
import { BD_DIVISIONS, fetchHeatOutlook } from "@/lib/heat";

// 7-day heat outlook. ?points=lat,lon;lat,lon (max 12) — or ?bd=1 for Bangladesh's division capitals.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const named = q.get("bd") === "1" ? BD_DIVISIONS : null;
  const points = named ?? (q.get("points") || "").split(";").filter(Boolean).slice(0, 12).map(s => { const [lat, lon] = s.split(",").map(Number); return { lat, lon }; });
  if (!points.length || !points.every(p => isFiniteCoord(p.lat, p.lon))) return Response.json({ error: "Give points as lat,lon;lat,lon or bd=1." }, { status: 400 });
  try {
    const outlooks = await fetchHeatOutlook(points);
    return Response.json({ outlooks: outlooks.map((o, i) => ({ ...o, name: named?.[i].name })) }, { headers: { "Cache-Control": "public, max-age=1800" } });
  } catch {
    return Response.json({ error: "Heat forecast is unavailable right now." }, { status: 502 });
  }
}
