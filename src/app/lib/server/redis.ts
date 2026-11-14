// Minimal client for Upstash Redis's REST API (what Vercel's Marketplace
// Upstash integration provisions) — one fetch per command, no SDK needed.
// The integration names the variables KV_REST_API_*; a manually created
// Upstash database uses UPSTASH_REDIS_REST_*. Accept either.
const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

export const redisConfigured = Boolean(url && token);

// One hung call must not stall a whole request or scheduler run (one held a
// run until the 60 s kill). A call that times out is thrown as a plain Redis
// error, so callers handle it like any other.
export const REDIS_TIMEOUT_MS = 8000;
async function post<T>(endpoint: string, payload: unknown): Promise<{ response: Response; body: T }> {
  try {
    const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(payload), cache: "no-store", signal: AbortSignal.timeout(REDIS_TIMEOUT_MS) });
    return { response, body: await response.json() as T };
  } catch (error) {
    const name = (error as { name?: unknown } | null)?.name;
    if (name === "TimeoutError" || name === "AbortError") throw new Error(`Redis request timed out after ${REDIS_TIMEOUT_MS / 1000} s`);
    throw error;
  }
}

// Several commands in one round trip, applied atomically (Upstash's
// /multi-exec endpoint, i.e. MULTI/EXEC); resolves to each command's result.
export async function redisTransaction(commands: (string | number)[][]): Promise<unknown[]> {
  if (!url || !token) throw new Error("Redis is not configured");
  const { response, body } = await post<{ result?: unknown; error?: string }[] | { error?: string }>(`${url}/multi-exec`, commands);
  if (!response.ok || !Array.isArray(body)) throw new Error((body as { error?: string }).error || `Redis transaction failed (${response.status})`);
  const failed = body.find((entry) => entry.error);
  if (failed) throw new Error(failed.error);
  return body.map((entry) => entry.result);
}

export async function redis<T = unknown>(...command: (string | number)[]): Promise<T> {
  if (!url || !token) throw new Error("Redis is not configured");
  const { response, body } = await post<{ result?: T; error?: string }>(url, command);
  if (!response.ok || body.error) throw new Error(body.error || `Redis request failed (${response.status})`);
  return body.result as T;
}
