// A calendar event (.ics, RFC 5545) for a recommended charging window, so a
// driver can put it in their own calendar — works on every phone, with or
// without push notifications.
export type CalendarWindow = { start: string; end: string; average: number; placeLabel: string; gridLabel: string };

// UTC "basic" form: 20261030T063000Z. Calendars show it in their own timezone.
const icsTime = (value: string | number) => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

const escapeText = (text: string) => text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

// Lines longer than 75 bytes continue on the next line after a space; split
// on character boundaries so multi-byte characters (like ₂) stay whole.
function fold(line: string) {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  for (const char of line) {
    const limit = parts.length ? 74 : 75; // continuation lines start with a space
    if (encoder.encode(current + char).length > limit) { parts.push(current); current = ""; }
    current += char;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function chargingWindowIcs(window: CalendarWindow, now = Date.now()) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ZeroEmit//Charging window//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    // Same window, same UID: adding it again updates the event, not a duplicate.
    `UID:${icsTime(window.start)}-${window.placeLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@zero-emit.vercel.app`,
    `DTSTAMP:${icsTime(now)}`,
    `DTSTART:${icsTime(window.start)}`,
    `DTEND:${icsTime(window.end)}`,
    "SUMMARY:Charge your EV (cleanest window)",
    `LOCATION:${escapeText(window.placeLabel)}`,
    `DESCRIPTION:${escapeText(`About ${Math.round(window.average)} gCO₂/kWh on average, one of the cleanest stretches on the ${window.gridLabel} today. Times from ZeroEmit: https://zero-emit.vercel.app`)}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT10M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Your cleanest charging window starts in 10 minutes",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

// Hands the event to the device: on phones this opens the calendar app's
// "add event" sheet; on desktop it downloads a file the calendar opens.
export function downloadIcs(ics: string, filename = "zeroemit-charging-window.ics") {
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
