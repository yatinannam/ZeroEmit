// A JSON request body, or null if it's invalid or larger than `maxBytes`.
// A declared Content-Length over the limit is refused before reading; the
// body itself is measured in UTF-8 bytes, not characters.
// Read as a stream and abandoned as soon as it passes the limit, so a body
// sent without a length (or with a false one) is never held in full.
export async function readLimitedJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const bytes = new Uint8Array(maxBytes);
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > maxBytes) { await reader.cancel().catch(() => undefined); return null; }
      bytes.set(value, size);
      size += value.byteLength;
    }
  } catch { return null; }
  try { return JSON.parse(new TextDecoder().decode(bytes.subarray(0, size))); } catch { return null; }
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
