import { describe, expect, test } from "bun:test";
import { knownPlaceCoordinates } from "./places";

describe("knownPlaceCoordinates", () => {
  test("a listed city's own coordinates", () => {
    const pune = knownPlaceCoordinates({ name: "Pune", state: "maharashtra" });
    expect(pune?.lat).toBeCloseTo(18.52, 1);
    expect(pune?.lon).toBeCloseTo(73.86, 1);
  });

  test("null for a place that isn't on the list, so the server never searches arbitrary spots", () => {
    expect(knownPlaceCoordinates({ name: "Atlantis", state: "maharashtra" })).toBeNull();
    expect(knownPlaceCoordinates({ name: "Pune", state: "kerala" })).toBeNull();
  });
});
