// Minimal client for Upstash Redis's REST API (what Vercel's Marketplace
// Upstash integration provisions) — one fetch per command, no SDK needed.
// The integration names the variables KV_REST_API_*; a manually created
// Upstash database uses UPSTASH_REDIS_REST_*. Accept either.
const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

export const redisConfigured = Boolean(url && token);

export async function redis<T = unknown>(...command: (string | number)[]): Promise<T> {
  if (!url || !token) throw new Error("Redis is not configured");
  const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(command), cache: "no-store" });
  const body = await response.json() as { result?: T; error?: string };
  if (!response.ok || body.error) throw new Error(body.error || `Redis request failed (${response.status})`);
  return body.result as T;
}
