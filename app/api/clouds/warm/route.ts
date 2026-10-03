import { cloudDate } from "@/lib/clouds";

// Daily Vercel Cron job (vercel.json): requests today's cloud map through the CDN so the first visitor
// doesn't wait for it to be built. Vercel sends "Authorization: Bearer $CRON_SECRET" when that is set.
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const date = cloudDate(), target = new URL(`/api/clouds?date=${date}`, request.url);
  const r = await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(58000) }).catch(() => null);
  const ok = !!r && r.status === 200;
  return Response.json({ date, ok, status: r?.status ?? null, cache: r?.headers.get("x-vercel-cache") ?? null, passes: r?.headers.get("x-cloud-passes") ?? null }, { status: ok ? 200 : 502 });
}
