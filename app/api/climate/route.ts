import { parsePower, RECORD_END, RECORD_START } from "@/lib/climate";
export async function GET(request: Request) {
  const url = new URL(request.url), latText = url.searchParams.get("lat"), lonText = url.searchParams.get("lon");
  const lat = Number(latText), lon = Number(lonText);
  if (!latText || !lonText || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return Response.json({ error: "A valid latitude and longitude are required." }, { status: 400 });
  const endpoint = new URL("https://power.larc.nasa.gov/api/temporal/monthly/point");
  endpoint.search = new URLSearchParams({ parameters: "T2M,PRECTOTCORR", community: "RE", longitude: lon.toFixed(4), latitude: lat.toFixed(4), start: String(RECORD_START), end: String(RECORD_END), format: "JSON" }).toString();
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error("NASA service is temporarily unavailable.");
    return Response.json(parsePower(await response.json()), { headers: { "Cache-Control": "public, max-age=86400" } });
  } catch { return Response.json({ error: "NASA observations could not be loaded. Try again shortly." }, { status: 502 }); }
}
