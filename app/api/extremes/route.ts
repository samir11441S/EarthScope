import { RECORD_END, RECORD_START } from "@/lib/climate";
import { computeExtremes, EXTREMES_SOURCE, type DailyPower } from "@/lib/extremes";
import { isFiniteCoord } from "@/lib/geo";

// Annual climate-extremes indices for a point, from NASA POWER daily data (one ~1 MB request, cached a day).
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const lat = Number(q.get("lat")), lon = Number(q.get("lon"));
  if (!q.get("lat") || !q.get("lon") || !isFiniteCoord(lat, lon)) return Response.json({ error: "A valid latitude and longitude are required." }, { status: 400 });
  const url = new URL("https://power.larc.nasa.gov/api/temporal/daily/point");
  url.search = new URLSearchParams({ parameters: "T2M_MAX,T2M_MIN,T2MWET,PRECTOTCORR", community: "AG", longitude: lon.toFixed(4), latitude: lat.toFixed(4), start: `${RECORD_START}0101`, end: `${RECORD_END}1231`, format: "JSON" }).toString();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(45000) });
    if (!r.ok) throw new Error();
    const j = (await r.json()) as { header?: { api?: { version?: string } }; properties?: { parameter?: Partial<DailyPower> } };
    const p = j.properties?.parameter;
    if (!p?.T2M_MAX || !p.T2M_MIN || !p.T2MWET || !p.PRECTOTCORR) throw new Error();
    const years = computeExtremes(p as DailyPower);
    if (!years.length) throw new Error();
    return Response.json(
      { years, source: EXTREMES_SOURCE, version: j.header?.api?.version ?? null, retrieved: new Date().toISOString() },
      { headers: { "Cache-Control": "public, max-age=86400" } },
    );
  } catch {
    return Response.json({ error: "NASA POWER daily data could not be loaded. Try again shortly." }, { status: 502 });
  }
}
