import jpeg from "jpeg-js";
import { CLOUD_LAYERS, cloudDate, cloudMask, dayBefore, wmsUrl } from "@/lib/clouds";
import { allow, clientKey } from "@/lib/rate-limit";

// Today's real cloud cover for the 3D globe: /api/clouds?date=YYYY-MM-DD (UTC; the client asks for cloudDate()).
// Each date is built once from NASA GIBS VIIRS imagery and then served from the CDN for a year (the
// URL changes every day). If NASA is unreachable, it falls back to the cloud map bundled with the app.
export const maxDuration = 60;

const W = 2048, H = 1024, CLEAR_DAYS = 6;
const FALLBACK = "/textures/earth-clouds.jpg";

async function image(url: string): Promise<Uint8Array | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (r.ok && r.headers.get("content-type")?.includes("image")) return jpeg.decode(new Uint8Array(await r.arrayBuffer()), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 64 }).data;
    } catch { /* retry once */ }
  }
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url), date = url.searchParams.get("date") ?? cloudDate();
  const age = (Date.now() - Date.parse(date)) / 86_400_000;
  // Only recent days are built (each build costs ~15 downloads); anything else gets the bundled map.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(age >= 1 && age <= 30)) return Response.redirect(new URL(FALLBACK, url), 302);
  if (!(await allow(`clouds:${clientKey(request)}`, 6, 60_000, 300))) return Response.redirect(new URL(FALLBACK, url), 302);

  const started = Date.now();
  const [noaa, snpp] = await Promise.all(CLOUD_LAYERS.map(l => image(wmsUrl(l, W, date))));
  if (!noaa || !snpp) return Response.redirect(new URL(FALLBACK, url), 302);
  const past = await Promise.all(Array.from({ length: CLEAR_DAYS }, (_, k) => CLOUD_LAYERS.map(l => image(wmsUrl(l, W, dayBefore(date, k + 1))))).flat());
  const history = past.filter((h): h is Uint8Array => !!h);
  if (history.length < 4) return Response.redirect(new URL(FALLBACK, url), 302);

  const { mask, cloudyPct } = cloudMask(noaa, snpp, history, W, H);
  const body = jpeg.encode({ data: mask, width: W, height: H }, 86).data;
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Cloud-Date": date, "X-Cloud-Passes": String(history.length), "X-Cloudy-Percent": cloudyPct.toFixed(0),
      "Server-Timing": `build;dur=${Date.now() - started}`,
    },
  });
}
