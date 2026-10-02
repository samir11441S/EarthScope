// Small in-memory sliding-window limiter (per server instance). Protects the paid AI path from abuse;
// limits are approximate on multi-instance hosting, which is acceptable for this purpose.
const hits = new Map<string, number[]>();
let day = "", dayCount = 0;

export function clientKey(request: Request) {
  const h = request.headers;
  return (h.get("cf-connecting-ip") || h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0] || "anon").trim();
}

/** true when the request is allowed: `limit` per `windowMs` per client, plus a daily cap per instance. */
export function allow(key: string, limit: number, windowMs: number, dailyCap: number) {
  const now = Date.now(), today = new Date(now).toISOString().slice(0, 10);
  if (today !== day) { day = today; dayCount = 0; }
  if (dayCount >= dailyCap) return false;
  const recent = (hits.get(key) ?? []).filter(t => now - t < windowMs);
  if (recent.length >= limit) { hits.set(key, recent); return false; }
  recent.push(now);
  hits.set(key, recent);
  dayCount++;
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => now - t < windowMs)) hits.delete(k);
  return true;
}
