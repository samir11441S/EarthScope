import { getHazardFeed } from "@/lib/hazard-feed";

export async function GET() {
  try {
    const body = await getHazardFeed(); // cached data, never a (single-use) Response
    return Response.json(body, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch {
    return Response.json({ error: "Live hazard feeds are unreachable right now." }, { status: 502 });
  }
}
