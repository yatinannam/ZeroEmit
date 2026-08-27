"use client";
import { useEffect, useState } from "react";
import type { City, GridData } from "../lib/grid";

export function useGridData(city: City) {
  const [data, setData] = useState<GridData | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const requestKey = `${city}:${requestVersion}`;
  const [completedKey, setCompletedKey] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/grid?city=${encodeURIComponent(city)}`, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const result = await response.json() as GridData;
      if (!response.ok && !result.error) throw new Error("Live grid data is unavailable");
      setData(result);
      if (result.available) setError("");
      else setError(result.error || "Live grid data is unavailable");
    }).catch((reason: unknown) => { if (reason instanceof DOMException && reason.name === "AbortError") return; setError("Live grid data is unavailable"); }).finally(() => { if (!controller.signal.aborted) setCompletedKey(requestKey); });
    return () => controller.abort();
  }, [city, requestKey]);
  return { data, loading: completedKey !== requestKey, error, refresh: () => { setError(""); setRequestVersion((value) => value + 1); } };
}
