"use client";
import { useEffect, useState } from "react";
import type { City, GridData } from "../lib/grid";

export function useGridData(city: City) {
  const [data, setData] = useState<GridData | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const [completedVersion, setCompletedVersion] = useState(-1);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/grid?city=${encodeURIComponent(city)}`, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const result = await response.json() as GridData;
      if (!response.ok && !result.error) throw new Error("Live grid data is unavailable");
      setData(result); if (!result.available) setError(result.error || "Live grid data is unavailable");
    }).catch((reason: unknown) => { if (reason instanceof DOMException && reason.name === "AbortError") return; setError("Live grid data is unavailable"); }).finally(() => { if (!controller.signal.aborted) setCompletedVersion(requestVersion); });
    return () => controller.abort();
  }, [city, requestVersion]);
  return { data, loading: completedVersion !== requestVersion, error, refresh: () => { setError(""); setRequestVersion((value) => value + 1); } };
}
