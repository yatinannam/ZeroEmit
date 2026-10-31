"use client";

import { chargingWindowIcs, downloadIcs } from "../lib/calendar";
import type { ChargeWindow } from "../lib/grid";
import { placeLabel, ZONE_LABELS, zoneOf, type Place } from "../lib/places";
import { Icon } from "./icon-set";

// Puts a recommended charging window in the driver's own calendar, with a
// reminder 10 minutes before it starts.
export function AddToCalendarButton({ window, place }: { window: ChargeWindow; place: Place }) {
  function add() {
    downloadIcs(chargingWindowIcs({ start: window.start.datetime, end: window.end.datetime, average: window.average, placeLabel: placeLabel(place), gridLabel: ZONE_LABELS[zoneOf(place)] }));
  }
  return <button type="button" className="text-button calendar-button" onClick={add}><Icon name="calendar" size={16}/> Add to calendar</button>;
}
