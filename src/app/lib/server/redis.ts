// Minimal client for Upstash Redis's REST API (what Vercel's Marketplace
// Upstash integration provisions) — one fetch per command, no SDK needed.
// The integration names the variables KV_REST_API_*; a manually created
// Upstash database uses UPSTASH_REDIS_REST_*. Accept either.
const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

export const redisConfigured = Boolean(url && token);

// Several commands in one round trip, applied atomically (Upstash's
// /multi-exec endpoint, i.e. MULTI/EXEC); resolves to each command's result.
export async function redisTransaction(commands: (string | number)[][]): Promise<unknown[]> {
  if (!url || !token) throw new Error("Redis is not configured");
  const response = await fetch(`${url}/multi-exec`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(commands), cache: "no-store" });
  const body = await response.json() as { result?: unknown; error?: string }[] | { error?: string };
  if (!response.ok || !Array.isArray(body)) throw new Error((body as { error?: string }).error || `Redis transaction failed (${response.status})`);
  const failed = body.find((entry) => entry.error);
  if (failed) throw new Error(failed.error);
  return body.map((entry) => entry.result);
}

export async function redis<T = unknown>(...command: (string | number)[]): Promise<T> {
  if (!url || !token) throw new Error("Redis is not configured");
  const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(command), cache: "no-store" });
  const body = await response.json() as { result?: T; error?: string };
  if (!response.ok || body.error) throw new Error(body.error || `Redis request failed (${response.status})`);
  return body.result as T;
}
