// The deployed build, so open tabs can offer to reload when a new version ships.
export function GET() {
  return Response.json({ build: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev" }, { headers: { "Cache-Control": "no-store" } });
}
