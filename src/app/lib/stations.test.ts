import { describe, expect, test } from "bun:test";
import { chargerOrigin, compactChargers, directionsUrl, distanceKm, INDIA_CHARGERS_QUERY, nearbyStations, parseOverpass, roundCoordinate } from "./stations";

const PUNE = { lat: 18.5204, lon: 73.8567 };

describe("distanceKm", () => {
  test("great-circle distance", () => {
    expect(distanceKm(PUNE, { lat: 19.076, lon: 72.8777 })).toBeCloseTo(119.9, 0); // Pune to Mumbai
    expect(distanceKm(PUNE, PUNE)).toBe(0);
  });
});

describe("INDIA_CHARGERS_QUERY", () => {
  test("every charging station in India, as points or buildings, with a centre point", () => {
    expect(INDIA_CHARGERS_QUERY).toContain("area[\"ISO3166-1\"=\"IN\"][admin_level=2]");
    expect(INDIA_CHARGERS_QUERY).toContain("nwr[\"amenity\"=\"charging_station\"](area.in);");
    expect(INDIA_CHARGERS_QUERY).toMatch(/out center tags;$/);
  });
});

describe("compactChargers", () => {
  test("keeps the position and the tags the app shows, sorted by id for a stable file", () => {
    const out = compactChargers({ elements: [
      { type: "way", id: 9, center: { lat: 18.5, lon: 73.8 }, tags: { amenity: "charging_station", operator: "Statiq", "addr:street": "MG Road", "socket:type2": "1" } },
      { type: "node", id: 3, lat: 12.8, lon: 80.0, tags: { name: "Shell", opening_hours: "24/7", fixme: "x" } },
      { type: "node", id: 4, tags: {} }, // no position
    ] });
    expect(out).toEqual([
      { type: "node", id: 3, lat: 12.8, lon: 80.0, tags: { name: "Shell", opening_hours: "24/7" } },
      { type: "way", id: 9, lat: 18.5, lon: 73.8, tags: { operator: "Statiq", "socket:type2": "1" } },
    ]);
    expect(compactChargers(null)).toEqual([]);
  });
});

describe("nearbyStations", () => {
  test("only chargers within the radius, nearest first", () => {
    const snapshot = [
      { type: "node", id: 1, lat: 18.53, lon: 73.85, tags: {} }, // ~1.3 km
      { type: "node", id: 2, lat: 18.9, lon: 73.85, tags: {} }, // ~42 km
      { type: "node", id: 3, lat: 18.52, lon: 73.86, tags: {} }, // ~0.4 km
    ];
    expect(nearbyStations(snapshot, PUNE).map((station) => station.id)).toEqual(["node/3", "node/1"]);
    expect(nearbyStations(snapshot, PUNE, 50).map((station) => station.id)).toEqual(["node/3", "node/1", "node/2"]);
  });
});

describe("parseOverpass", () => {
  const response = {
    elements: [
      { type: "node", id: 1, lat: 18.53, lon: 73.85, tags: { amenity: "charging_station", name: "Tata Power EZ Charge", operator: "Tata Power", "socket:type2_combo": "2", "socket:type2": "1", opening_hours: "24/7" } },
      { type: "way", id: 2, center: { lat: 18.5204, lon: 73.857 }, tags: { amenity: "charging_station", operator: "Statiq" } },
      { type: "node", id: 3, lat: 18.6, lon: 73.9, tags: { amenity: "charging_station", "socket:chademo": "no" } },
      { type: "node", id: 4, tags: { amenity: "charging_station" } }, // no position: skipped
    ],
  };
  const stations = parseOverpass(response, PUNE);

  test("nearest first, with distance to 0.1 km", () => {
    expect(stations.map((station) => station.id)).toEqual(["way/2", "node/1", "node/3"]);
    expect(stations[0].distanceKm).toBe(0);
    expect(stations[1].distanceKm).toBe(1.3); // ~1.07 km north, ~0.71 km west
  });

  test("name falls back to the operator, then a generic label", () => {
    expect(stations.map((station) => station.name)).toEqual(["Statiq", "Tata Power EZ Charge", "EV charging station"]);
  });

  test("connector types the station has, skipping ones marked no", () => {
    expect(stations[1].connectors).toEqual(["CCS2", "Type 2"]);
    expect(stations[2].connectors).toEqual([]);
    expect(stations[1].open24h).toBe(true);
    expect(stations[0].open24h).toBe(false);
  });

  test("at most 20, and garbage gives nothing", () => {
    const many = { elements: Array.from({ length: 30 }, (_, i) => ({ type: "node", id: i, lat: 18.52 + i / 1000, lon: 73.85, tags: {} })) };
    expect(parseOverpass(many, PUNE)).toHaveLength(20);
    expect(parseOverpass(null, PUNE)).toEqual([]);
    expect(parseOverpass({ elements: "x" }, PUNE)).toEqual([]);
  });
});

describe("directionsUrl", () => {
  test("Google Maps directions to the station", () => {
    expect(directionsUrl({ lat: 18.53, lon: 73.85 })).toBe("https://www.google.com/maps/dir/?api=1&destination=18.53,73.85");
  });
});

describe("roundCoordinate", () => {
  test("2 decimals, about 1 km, so an exact position never leaves the phone", () => {
    expect(roundCoordinate(12.823123)).toBe(12.82);
    expect(roundCoordinate(80.04417)).toBe(80.04);
  });
});

describe("chargerOrigin", () => {
  test("a shared position is rounded and searched around", () => {
    expect(chargerOrigin({ lat: "12.823123", lon: "80.04417" })).toEqual({ origin: { lat: 12.82, lon: 80.04 }, source: "location" });
  });

  test("a position outside India, or not a number, is refused rather than ignored", () => {
    expect(chargerOrigin({ lat: "51.5", lon: "-0.12", city: "Pune", state: "maharashtra" })).toBeNull();
    expect(chargerOrigin({ lat: "abc", lon: "80.0" })).toBeNull();
  });

  test("without a position, the listed city's centre", () => {
    const origin = chargerOrigin({ city: "Pune", state: "maharashtra" });
    expect(origin?.source).toBe("city");
    expect(origin?.origin.lat).toBeCloseTo(18.52, 1);
    expect(chargerOrigin({ city: "Atlantis", state: "maharashtra" })).toBeNull();
  });
});

describe("search area", () => {
  test("30 km by default, since India's mapped chargers are sparse outside city centres", () => {
    const far = [{ type: "node", id: 1, lat: 12.82 + 0.26, lon: 80.04, tags: {} }]; // ~29 km north
    expect(nearbyStations(far, { lat: 12.82, lon: 80.04 })).toHaveLength(1);
  });
});
