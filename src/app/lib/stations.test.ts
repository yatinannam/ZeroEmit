import { describe, expect, test } from "bun:test";
import { addChargerUrl, chargerOrigin, chargerSearchUrl, compactChargers, compassDirection, directionsUrl, distanceKm, INDIA_CHARGERS_QUERY, nearbyStations, normalizeOperator, parseOverpass, roundCoordinate, stationsAround } from "./stations";

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

  test("name falls back to the operator, then says it's unnamed", () => {
    expect(stations.map((station) => station.name)).toEqual(["Statiq", "Tata Power EZ Charge", "Unnamed EV charger"]);
  });

  test("a name that only says 'charging station' gives way to the operator", () => {
    const [named] = parseOverpass({ elements: [{ type: "node", id: 5, lat: 18.52, lon: 73.86, tags: { name: "Electric Vehicle Charging Station", operator: "tata power" } }] }, PUNE);
    expect(named.name).toBe("Tata Power");
    const [lower] = parseOverpass({ elements: [{ type: "node", id: 6, lat: 18.52, lon: 73.86, tags: { name: "srt tata ev charging station" } }] }, PUNE);
    expect(lower.name).toBe("Srt Tata EV Charging Station");
  });

  test("operators are tidied, falling back to the brand", () => {
    const parsed = parseOverpass({ elements: [
      { type: "node", id: 7, lat: 18.52, lon: 73.86, tags: { operator: "EV charging station", brand: "Tata power" } },
      { type: "node", id: 8, lat: 18.53, lon: 73.86, tags: { operator: "TATA" } },
    ] }, PUNE);
    expect(parsed.map((station) => station.operator)).toEqual(["Tata Power", "Tata Power"]);
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

describe("normalizeOperator", () => {
  test("one spelling per known network, whatever the case", () => {
    expect(["tata", "Tata power", "tata power", "Tata Power"].map(normalizeOperator)).toEqual(["Tata Power", "Tata Power", "Tata Power", "Tata Power"]);
    expect(["ather energy", "Ather energy", "Ather grid"].map(normalizeOperator)).toEqual(["Ather Energy", "Ather Energy", "Ather Grid"]);
    expect(["Energy Efficiency Services Limited (EESL)", "eesl", "Jio-bp", "Jio BP Pulse"].map(normalizeOperator)).toEqual(["EESL", "EESL", "Jio-bp pulse", "Jio-bp pulse"]);
  });

  test("all-lower-case names are title-cased; others are kept as typed", () => {
    expect(normalizeOperator("rama chandra agencies")).toBe("Rama Chandra Agencies");
    expect(normalizeOperator("ChargeMOD")).toBe("ChargeMOD");
    expect(normalizeOperator("BESCOM")).toBe("BESCOM");
  });

  test("a tag that only says 'charging station' is no operator", () => {
    expect(normalizeOperator("Electric Vehicle Charging Station")).toBeNull();
    expect(normalizeOperator(null)).toBeNull();
  });
});

describe("compassDirection", () => {
  test("the nearest of 8 compass points", () => {
    expect(compassDirection(PUNE, { lat: 19.076, lon: 72.8777 })).toBe("north-west"); // Mumbai
    expect(compassDirection(PUNE, { lat: 18.0, lon: 73.8567 })).toBe("south");
    expect(compassDirection(PUNE, { lat: 18.5204, lon: 74.5 })).toBe("east");
  });
});

describe("stationsAround", () => {
  const snapshot = [
    { type: "node", id: 1, lat: 19.0, lon: 73.85, tags: {} }, // ~53 km
    { type: "node", id: 2, lat: 19.5, lon: 73.85, tags: {} }, // ~109 km
    { type: "node", id: 3, lat: 20.0, lon: 73.85, tags: {} },
    { type: "node", id: 4, lat: 21.0, lon: 73.85, tags: {} },
  ];

  test("with none in range, the nearest 3 beyond it", () => {
    const { stations, farther } = stationsAround(snapshot, PUNE);
    expect(stations).toEqual([]);
    expect(farther.map((station) => station.id)).toEqual(["node/1", "node/2", "node/3"]);
  });

  test("with some in range, nothing farther, so the answer stays small", () => {
    const { stations, farther } = stationsAround([...snapshot, { type: "node", id: 9, lat: 18.53, lon: 73.85, tags: {} }], PUNE);
    expect(stations.map((station) => station.id)).toEqual(["node/9"]);
    expect(farther).toEqual([]);
  });
});

describe("chargerSearchUrl and addChargerUrl", () => {
  test("Google Maps' search for chargers near a place, and OpenStreetMap's editor there", () => {
    expect(chargerSearchUrl("Jaipur, Rajasthan")).toBe("https://www.google.com/maps/search/?api=1&query=EV%20charging%20station%20near%20Jaipur%2C%20Rajasthan");
    expect(addChargerUrl({ lat: 26.91, lon: 75.79 })).toBe("https://www.openstreetmap.org/edit#map=15/26.91/75.79");
  });
});

describe("search area", () => {
  test("30 km by default, since India's mapped chargers are sparse outside city centres", () => {
    const far = [{ type: "node", id: 1, lat: 12.82 + 0.26, lon: 80.04, tags: {} }]; // ~29 km north
    expect(nearbyStations(far, { lat: 12.82, lon: 80.04 })).toHaveLength(1);
  });
});
