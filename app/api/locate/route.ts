// Approximate (city-level) location of the visitor, for when the browser can't share a precise one.
// 1. Hosting-platform geo headers (Vercel sets these for every request — no third party involved).
// 2. Otherwise the ipwho.is lookup for the connecting IP (or this server's own IP when running locally).
// Nothing is stored; the answer is only returned to the visitor who asked.

const isPrivate = (ip: string) => !ip || ip === "::1" || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|fc|fd|fe80|::ffff:127\.)/i.test(ip);

export async function GET(request: Request) {
  const h = request.headers;
  const lat = Number(h.get("x-vercel-ip-latitude")), lon = Number(h.get("x-vercel-ip-longitude"));
  if (h.get("x-vercel-ip-latitude") && Number.isFinite(lat) && Number.isFinite(lon)) {
    const city = decodeURIComponent(h.get("x-vercel-ip-city") ?? "");
    return Response.json({ lat, lon, city, country: h.get("x-vercel-ip-country") ?? "", source: "hosting network geolocation" }, { headers: { "Cache-Control": "private, no-store" } });
  }
  const ip = (h.get("cf-connecting-ip") || h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0] || "").trim();
  try {
    const r = await fetch(`https://ipwho.is/${isPrivate(ip) ? "" : encodeURIComponent(ip)}?fields=success,message,latitude,longitude,city,country`, { signal: AbortSignal.timeout(8000) });
    const j = (await r.json()) as { success?: boolean; message?: string; latitude?: number; longitude?: number; city?: string; country?: string };
    if (!j.success || !Number.isFinite(j.latitude) || !Number.isFinite(j.longitude)) throw new Error(j.message || "lookup failed");
    return Response.json({ lat: j.latitude, lon: j.longitude, city: j.city ?? "", country: j.country ?? "", source: "IP geolocation (ipwho.is)" }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Approximate location is unavailable right now. Search for your area or pick a spot on the map." }, { status: 502 });
  }
}
