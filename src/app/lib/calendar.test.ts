import { describe, expect, test } from "bun:test";
import { chargingWindowIcs } from "./calendar";

const window = {
  start: "2026-10-30T06:30:00.000Z", // 12:00 pm IST
  end: "2026-10-30T08:30:00.000Z", // 2:00 pm IST
  average: 410.4,
  placeLabel: "Pune, Maharashtra",
  gridLabel: "Western grid",
};
const NOW = Date.parse("2026-10-29T10:00:00.000Z");

describe("chargingWindowIcs", () => {
  const ics = chargingWindowIcs(window, NOW);
  const lines = ics.split("\r\n");

  test("is a single-event calendar with CRLF line endings", () => {
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
    expect(lines.filter((line) => line === "BEGIN:VEVENT")).toHaveLength(1);
  });

  test("times are UTC, so every calendar shows them in its own timezone", () => {
    expect(lines).toContain("DTSTART:20261030T063000Z");
    expect(lines).toContain("DTEND:20261030T083000Z");
    expect(lines).toContain("DTSTAMP:20261029T100000Z");
  });

  test("says what and where, with commas and semicolons escaped", () => {
    expect(lines).toContain("SUMMARY:Charge your EV (cleanest window)");
    expect(lines).toContain("LOCATION:Pune\\, Maharashtra");
    expect(ics.replace(/\r\n /g, "")).toContain("DESCRIPTION:About 410 gCO₂/kWh on average\\, one of the cleanest stretches of the day on the Western grid.");
  });

  test("reminds 10 minutes before the window starts", () => {
    expect(ics).toContain("BEGIN:VALARM\r\nTRIGGER:-PT10M\r\nACTION:DISPLAY");
  });

  test("the same window always gets the same UID, so adding it twice updates one event", () => {
    expect(chargingWindowIcs(window, NOW + 60_000).match(/UID:.*\r\n/)?.[0]).toBe(ics.match(/UID:.*\r\n/)?.[0]);
  });

  test("lines are folded at 75 bytes, counting multi-byte characters", () => {
    for (const line of lines) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});
