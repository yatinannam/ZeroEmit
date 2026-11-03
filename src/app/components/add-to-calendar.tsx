"use client";

import { chargingWindowIcs, downloadIcs } from "../lib/calendar";
import type { ChargeWindow } from "../lib/grid";
import { placeLabel, ZONE_LABELS, zoneOf, type Place } from "../lib/places";
import { Icon } from "./icon-set";
import { showToast } from "./toast";

// Puts a recommended charging window in the driver's own calendar, with a
// reminder 10 minutes before it starts.
export function addWindowToCalendar(window: ChargeWindow, place: Place) {
  downloadIcs(chargingWindowIcs({ start: window.start.datetime, end: window.end.datetime, average: window.average, placeLabel: placeLabel(place), gridLabel: ZONE_LABELS[zoneOf(place)] }));
  // The download itself is easy to miss on a phone; say what happened.
  showToast("Calendar event downloaded. Open it to add the reminder.");
}

export function AddToCalendarButton({ window, place }: { window: ChargeWindow; place: Place }) {
  return <button type="button" className="text-button calendar-button" onClick={() => addWindowToCalendar(window, place)}><Icon name="calendar" size={16}/> Add to calendar</button>;
}
