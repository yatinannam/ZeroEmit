"use client";
import { useEffect, useRef, useState } from "react";
import type { GridData } from "../lib/grid";

// `state` is a state slug from lib/places.ts — all the API needs, so the
// user's own city or coordinates never leave the device.
export function useGridData(state: string) {
  const [data, setData] = useState<GridData | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const requestKey = `${state}:${requestVersion}`;
  const [completedKey, setCompletedKey] = useState("");
  const [error, setError] = useState("");
  // Only an explicit refresh() should bypass HTTP caching — a plain mount or
  // location change should let the browser reuse a recent response (the API
  // route sets Cache-Control/s-maxage precisely so repeat navigations don't
  // re-hit the rate-limited upstream provider on every page visit).
  const forceRefresh = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    const force = forceRefresh.current;
    forceRefresh.current = false;
    fetch(`/api/grid?state=${encodeURIComponent(state)}`, { signal: controller.signal, cache: force ? "no-store" : "default" }).then(async (response) => {
      const result = await response.json() as GridData;
      if (!response.ok && !result.error) throw new Error("Live grid data is unavailable");
      setData(result);
      if (result.available) setError("");
      else setError(result.error || "Live grid data is unavailable");
    }).catch((reason: unknown) => { if (reason instanceof DOMException && reason.name === "AbortError") return; setError("Live grid data is unavailable"); }).finally(() => { if (!controller.signal.aborted) setCompletedKey(requestKey); });
    return () => controller.abort();
  }, [state, requestKey]);
  // `data` still holds the previous location's response until the new fetch
  // lands — hide it rather than show one region's data under another's name.
  return { data: data?.state === state ? data : null, loading: completedKey !== requestKey, error, refresh: () => { forceRefresh.current = true; setError(""); setRequestVersion((value) => value + 1); } };
}
