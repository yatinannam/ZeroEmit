// A JSON request body, or null if it's invalid or larger than `maxBytes`.
// A declared Content-Length over the limit is refused before reading; the
// body itself is measured in UTF-8 bytes, not characters.
export async function readLimitedJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// Whether a state-changing request came from the app itself. A text/plain or
// form body needs no CORS preflight, so another website could make visitors'
// browsers post one (each from a different IP, defeating per-IP limits):
// require JSON, and refuse when the browser says the request is cross-site.
// Non-browser clients send neither header and are judged by the other checks.
export function fromOwnSite(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return false;
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return false;
  return true;
}
