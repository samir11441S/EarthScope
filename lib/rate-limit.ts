// Rate limiting for the AI and logging endpoints.
//
// • With UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN set (Upstash free tier), limits are shared
//   by every server instance: a fixed-window counter per client plus a daily cap per bucket.
// • Without them, an in-memory sliding window per instance is used (approximate on multi-instance
//   hosting, still useful against simple abuse).
// Buckets ("ai", "log", …) are taken from the key prefix, so one endpoint can't use up another's cap.

const hits = new Map<string, number[]>();
const daily = new Map<string, { day: string; count: number }>();

export function clientKey(request: Request) {
  const h = request.headers;
  return (h.get("cf-connecting-ip") || h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0] || "anon").trim();
}

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL, UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
export const sharedRateLimit = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

async function upstash(commands: (string | number)[][]): Promise<number[]> {
  const r = await fetch(`${UPSTASH_URL}/pipeline`, { method: "POST", headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(commands), signal: AbortSignal.timeout(2500) });
  if (!r.ok) throw new Error(`upstash ${r.status}`);
  return ((await r.json()) as { result: number }[]).map(x => x.result);
}

function allowInMemory(key: string, bucket: string, limit: number, windowMs: number, dailyCap: number) {
  const now = Date.now(), today = new Date(now).toISOString().slice(0, 10);
  const d = daily.get(bucket);
  if (!d || d.day !== today) daily.set(bucket, { day: today, count: 0 });
  const day = daily.get(bucket)!;
  if (day.count >= dailyCap) return false;
  const recent = (hits.get(key) ?? []).filter(t => now - t < windowMs);
  if (recent.length >= limit) { hits.set(key, recent); return false; }
  recent.push(now);
  hits.set(key, recent);
  day.count++;
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => now - t < windowMs)) hits.delete(k);
  return true;
}

/** Resolves true when the request is allowed: `limit` per `windowMs` per key, plus `dailyCap` per bucket. */
export async function allow(key: string, limit: number, windowMs: number, dailyCap: number): Promise<boolean> {
  const bucket = key.includes(":") ? key.slice(0, key.indexOf(":")) : "default";
  if (!sharedRateLimit) return allowInMemory(key, bucket, limit, windowMs, dailyCap);
  try {
    const win = Math.floor(Date.now() / windowMs), today = new Date().toISOString().slice(0, 10);
    const k = `rl:${key}:${win}`, dk = `rl:day:${bucket}:${today}`;
    const [count, , dayCount] = await upstash([["INCR", k], ["PEXPIRE", k, windowMs], ["INCR", dk], ["EXPIRE", dk, 172800]]);
    return count <= limit && dayCount <= dailyCap;
  } catch {
    return allowInMemory(key, bucket, limit, windowMs, dailyCap); // never fail closed because the store is down
  }
}
