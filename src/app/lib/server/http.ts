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
