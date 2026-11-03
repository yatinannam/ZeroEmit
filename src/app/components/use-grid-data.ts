"use client";
import { useEffect, useRef, useState } from "react";
import type { GridData } from "../lib/grid";

// While the page stays open (an installed app can sit open for days), fetch
// again this often while it's on screen, and on coming back to it once the
// last answer is this old — so "Now" and today's windows don't go stale.
const REFETCH_EVERY_MS = 15 * 60_000;
const REFETCH_ON_RETURN_AFTER_MS = 5 * 60_000;

// `state` is a state slug from lib/places.ts — all the API needs, so the
// user's own city or coordinates never leave the device.
// `null` while the place isn't known yet (before hydration): nothing is
// fetched, so a prerendered default never costs a request.
export function useGridData(state: string | null) {
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
  const lastFetchedAt = useRef(0);
  useEffect(() => {
    if (state === null) return;
    const controller = new AbortController();
    const force = forceRefresh.current;
    forceRefresh.current = false;
    fetch(`/api/grid?state=${encodeURIComponent(state)}`, { signal: controller.signal, cache: force ? "no-store" : "default" }).then(async (response) => {
      const result = await response.json() as GridData;
      if (!response.ok && !result.error) throw new Error("Live grid data is unavailable");
      // A failed answer (a 5xx carries `error` and `state` too) doesn't wipe
      // out good data already on screen for the same state: keep that, and
      // say why it couldn't be updated.
      setData((previous) => (result.available || !previous?.available || previous.state !== result.state ? result : previous));
      if (result.available) setError("");
      else setError(result.error || "Live grid data is unavailable");
    }).catch((reason: unknown) => { if (reason instanceof DOMException && reason.name === "AbortError") return; setError("Live grid data is unavailable"); }).finally(() => { if (!controller.signal.aborted) { lastFetchedAt.current = Date.now(); setCompletedKey(requestKey); } });
    return () => controller.abort();
  }, [state, requestKey]);
  useEffect(() => {
    if (state === null) return;
    const refetch = () => { if (document.visibilityState === "visible" && Date.now() - lastFetchedAt.current >= REFETCH_ON_RETURN_AFTER_MS) setRequestVersion((value) => value + 1); };
    const timer = setInterval(refetch, REFETCH_EVERY_MS);
    document.addEventListener("visibilitychange", refetch);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refetch); };
  }, [state]);
  // `data` still holds the previous location's response until the new fetch
  // lands — hide it rather than show one region's data under another's name.
  return { data: data?.state === state ? data : null, loading: completedKey !== requestKey, error, refresh: () => { forceRefresh.current = true; setError(""); setRequestVersion((value) => value + 1); } };
}
