"use client";

import { INTENSITY_LEVEL_LABELS, intensityLevel, type GridData } from "../lib/grid";
import { ZONE_LABELS, zoneOf, type Place } from "../lib/places";
import { hourlyPattern } from "../lib/timing";

// Where a reading sits in its region's day: green Low, amber Average, red
// High. Nothing when there isn't a day's worth of data to compare with.
export function IntensityLevelChip({ value, data, place, long = false }: { value: number; data: GridData | null; place: Place; long?: boolean }) {
  const level = data?.available ? intensityLevel(value, hourlyPattern(data.forecast)) : null;
  if (!level) return null;
  const grid = ZONE_LABELS[zoneOf(place)];
  return <span className={`level-chip level-${level}`} title={`${INTENSITY_LEVEL_LABELS[level]} for the ${grid} today`}>
    {INTENSITY_LEVEL_LABELS[level]}{long ? ` for the ${grid}` : <span className="sr-only"> for the {grid} today</span>}
  </span>;
}
