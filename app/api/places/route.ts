interface GeocodingItem {
  id: number | string;
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
}

interface ReverseAddress {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  suburb?: string;
  county?: string;
  state?: string;
  country?: string;
}

function oceanName(lat: number, lon: number): string {
  if (lat > 66) return "Arctic Ocean";
  if (lat < -60) return "Southern Ocean";
  if (lon >= -70 && lon <= 20) return "Atlantic Ocean";
  if (lon >= 20 && lon <= 120 && lat <= 30) return "Indian Ocean";
  return "Pacific Ocean";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const latParam = url.searchParams.get("lat");
  const lonParam = url.searchParams.get("lon");

  // Handle Reverse Geocoding
  if (latParam !== null && lonParam !== null) {
    const lat = Number(latParam), lon = Number(lonParam);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return Response.json({ error: "Invalid coordinates" }, { status: 400 });
    }
    try {
      const revRes = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&format=json&zoom=10&accept-language=en`,
        {
          headers: { "User-Agent": "EarthScopeClimateApp/1.0" },
          signal: AbortSignal.timeout(6000),
        }
      );
      if (revRes.ok) {
        const data = (await revRes.json()) as { address?: ReverseAddress; display_name?: string };
        const addr = data.address;
        if (addr && (addr.city || addr.town || addr.village || addr.municipality || addr.county || addr.country)) {
          const name = addr.city || addr.town || addr.village || addr.municipality || addr.county || addr.state || "Coastal Region";
          const country = addr.country || oceanName(lat, lon);
          const region = addr.state || addr.county || "";
          return Response.json({
            place: {
              id: `geo-${lat.toFixed(2)}-${lon.toFixed(2)}`,
              name,
              country,
              region,
              lat: +lat.toFixed(4),
              lon: +lon.toFixed(4),
            },
          });
        }
      }
    } catch {}

    const ocean = oceanName(lat, lon);
    return Response.json({
      place: {
        id: `ocean-${lat.toFixed(2)}-${lon.toFixed(2)}`,
        name: ocean,
        country: `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`,
        region: "Maritime Observation",
        lat: +lat.toFixed(4),
        lon: +lon.toFixed(4),
      },
    });
  }

  // Handle Query Search
  if (q.length < 2 || q.length > 100) return Response.json({ results: [] });
  try {
    const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=en&format=json`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error();
    const data = (await response.json()) as { results?: GeocodingItem[] };
    return Response.json({
      results: (data.results || []).map((p: GeocodingItem) => ({
        id: String(p.id),
        name: p.name,
        country: p.country || "",
        region: p.admin1 || "",
        lat: p.latitude,
        lon: p.longitude,
      })),
    }, { headers: { "Cache-Control": "public, max-age=86400" } });
  } catch { return Response.json({ error: "Search is temporarily unavailable.", results: [] }, { status: 502 }); }
}
