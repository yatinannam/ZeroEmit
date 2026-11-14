"use client";
import { useEffect, useRef, useState } from "react";
import type { GridData } from "../lib/grid";

// The latest good answer, whichever screen fetched it: the top bar's bolt
// (components/app-shell.tsx) reads it here rather than fetching its own.
let latestGrid: GridData | null = null;
const latestListeners = new Set<() => void>();
export function subscribeLatestGrid(listener: () => void) {
  latestListeners.add(listener);
  return () => { latestListeners.delete(listener); };
}
export const getLatestGrid = () => latestGrid;
function publishGrid(result: GridData) {
  if (!result.available) return;
  latestGrid = result;
  latestListeners.forEach((listener) => listener());
}

// While the page stays open (an installed app can sit open for days), fetch
// again this often while it's on screen, and on coming back to it once the
// last answer is this old — so "Now" and today's windows don't go stale.
const REFETCH_EVERY_MS = 15 * 60_000;
const REFETCH_ON_RETURN_AFTER_MS = 5 * 60_000;
// Screens add the full stop (and "Showing data from …" when there is some).
const UNAVAILABLE = "Live grid data is unavailable";
const OFFLINE = "You're offline, so live grid data can't load";
// An error belongs to the state it was fetched for: after a city change the
// old region's error isn't shown under the new one while its answer loads.
type GridError = { state: string | null; message: string };
const NO_ERROR: GridError = { state: null, message: "" };

// `state` is a state slug from lib/places.ts — all the API needs, so the
// user's own city or coordinates never leave the device.
// `null` while the place isn't known yet (before hydration): nothing is
// fetched, so a prerendered default never costs a request.
export function useGridData(state: string | null) {
  const [data, setData] = useState<GridData | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const requestKey = `${state}:${requestVersion}`;
  const [completedKey, setCompletedKey] = useState("");
  const [error, setError] = useState<GridError>(NO_ERROR);
  // Only an explicit refresh() should bypass HTTP caching — a plain mount or
  // location change should let the browser reuse a recent response (the API
  // route sets Cache-Control/s-maxage precisely so repeat navigations don't
  // re-hit the rate-limited upstream provider on every page visit).
  const forceRefresh = useRef(false);
  // Also stamped when a fetch starts, so coming back to the page while one is
  // still on its way (the first one included) doesn't abort and restart it;
  // one stuck for longer than REFETCH_ON_RETURN_AFTER_MS is started again.
  const lastFetchedAt = useRef(0);
  // Whether the last answer was a failure: coming back online fetches again.
  const failed = useRef(false);
  useEffect(() => {
    if (state === null) return;
    const controller = new AbortController();
    const force = forceRefresh.current;
    forceRefresh.current = false;
    lastFetchedAt.current = Date.now();
    // fetch() itself rejecting (not an abort) means no answer came back at all.
    let answered = false;
    fetch(`/api/grid?state=${encodeURIComponent(state)}`, { signal: controller.signal, cache: force ? "no-store" : "default" }).then(async (response) => {
      answered = true;
      const result = await response.json() as GridData;
      if (!response.ok && !result.error) throw new Error(UNAVAILABLE);
      // A failed answer (a 5xx carries `error` and `state` too) doesn't wipe
      // out good data already on screen for the same state: keep that, and
      // say why it couldn't be updated.
      setData((previous) => (result.available || !previous?.available || previous.state !== result.state ? result : previous));
      publishGrid(result);
      failed.current = !result.available;
      if (result.available) setError(NO_ERROR);
      else setError({ state, message: result.error || UNAVAILABLE });
    }).catch((reason: unknown) => {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      failed.current = true;
      setError({ state, message: !navigator.onLine || (!answered && reason instanceof TypeError) ? OFFLINE : UNAVAILABLE });
    }).finally(() => { if (!controller.signal.aborted) { lastFetchedAt.current = Date.now(); setCompletedKey(requestKey); } });
    return () => controller.abort();
  }, [state, requestKey]);
  useEffect(() => {
    if (state === null) return;
    const refetch = () => { if (document.visibilityState === "visible" && Date.now() - lastFetchedAt.current >= REFETCH_ON_RETURN_AFTER_MS) setRequestVersion((value) => value + 1); };
    // Back online after a failed fetch: try again rather than wait for Try again.
    const reconnect = () => { if (failed.current) setRequestVersion((value) => value + 1); };
    const timer = setInterval(refetch, REFETCH_EVERY_MS);
    document.addEventListener("visibilitychange", refetch);
    window.addEventListener("online", reconnect);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refetch); window.removeEventListener("online", reconnect); };
  }, [state]);
  // `data` still holds the previous location's response until the new fetch
  // lands — hide it rather than show one region's data under another's name.
  return { data: data?.state === state ? data : null, loading: completedKey !== requestKey, error: error.state === state ? error.message : "", refresh: () => { forceRefresh.current = true; setError(NO_ERROR); setRequestVersion((value) => value + 1); } };
}
