// Public Overpass (OpenStreetMap) servers. They come and go, get overloaded,
// and some aren't reachable from India at all (overpass-api.de times out
// from Indian networks and from Vercel), so all are asked at once and the
// first good answer wins.
export const OVERPASS_SERVERS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

export async function firstOverpassAnswer(servers: string[], query: string, { fetchImpl = fetch, timeoutMs = 25_000 } = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const ask = async (server: string) => {
    const response = await fetchImpl(server, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "ZeroEmit (https://zero-emit.vercel.app)" },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`${server}: ${response.status}`);
    const body = await response.json() as { elements?: unknown };
    if (!Array.isArray(body?.elements)) throw new Error(`${server}: not Overpass JSON`);
    return body;
  };
  try {
    return await Promise.any(servers.map(ask));
  } catch {
    return null; // every server failed or ran out of time
  } finally {
    clearTimeout(timer);
    controller.abort(); // cancel the ones still running
  }
}
