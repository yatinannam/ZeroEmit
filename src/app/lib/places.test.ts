import { describe, expect, test } from "bun:test";
import { isInIndia, knownPlaceCoordinates, searchPlaces, STATES } from "./places";

describe("isInIndia", () => {
  test("every listed city is inside", () => {
    const listed = Object.values(STATES).flatMap((state) => searchPlaces(state.name, 1000));
    expect(listed.length).toBeGreaterThan(250);
    const outside = listed.filter((place) => { const at = knownPlaceCoordinates(place)!; return !isInIndia(at.lat, at.lon); });
    expect(outside).toEqual([]);
  });

  test("border and remote towns in India are inside", () => {
    const towns: [string, number, number][] = [
      ["Attari", 31.6, 74.6], ["Ferozepur", 30.92, 74.61], ["Fazilka", 30.4, 74.03], ["Tanot", 27.83, 70.35], ["Lakhpat", 23.83, 68.78], ["Kanyakumari", 8.08, 77.55], ["Rameswaram", 9.29, 79.31],
      ["Hanle", 32.78, 78.97], ["Dharchula", 29.85, 80.54], ["Raxaul", 26.98, 84.85], ["Jogbani", 26.4, 87.26], ["Jaigaon", 26.847, 89.375], ["Tawang", 27.59, 91.86], ["Kibithu", 28.28, 97.0],
      ["Moreh", 24.25, 94.3], ["Zokhawthar", 23.37, 93.38], ["Karimganj", 24.87, 92.355], ["Dawki", 25.19, 92.02], ["Balurghat", 25.22, 88.77], ["Bongaon", 23.05, 88.82], ["Basirhat", 22.66, 88.87], ["Sagar Island", 21.65, 88.05],
    ];
    expect(towns.filter(([, lat, lon]) => !isInIndia(lat, lon)).map(([name]) => name)).toEqual([]);
  });

  test("neighbouring countries' cities are outside, even ones close to the border", () => {
    const cities: [string, number, number][] = [
      ["Lahore", 31.55, 74.34], ["Kasur", 31.12, 74.45], ["Sialkot", 32.49, 74.53], ["Islamabad", 33.68, 73.05], ["Bahawalnagar", 29.99, 73.25], ["Umerkot", 25.36, 69.74], ["Karachi", 24.86, 67.0], ["Kabul", 34.53, 69.17],
      ["Kathmandu", 27.7, 85.32], ["Pokhara", 28.21, 83.99], ["Birgunj", 27.01, 84.88], ["Biratnagar", 26.45, 87.28], ["Thimphu", 27.47, 89.64], ["Phuentsholing", 26.858, 89.389], ["Lhasa", 29.65, 91.1], ["Shigatse", 29.27, 88.88],
      ["Dhaka", 23.81, 90.41], ["Chittagong", 22.36, 91.78], ["Sylhet", 24.9, 91.87], ["Rajshahi", 24.37, 88.6], ["Comilla", 23.46, 91.18], ["Satkhira", 22.72, 89.07], ["Tetulia", 26.48, 88.35],
      ["Mandalay", 21.97, 96.08], ["Tamu", 24.22, 94.31], ["Hakha", 22.65, 93.6], ["Colombo", 6.93, 79.86], ["Jaffna", 9.66, 80.01], ["London", 51.5, -0.12],
    ];
    expect(cities.filter(([, lat, lon]) => isInIndia(lat, lon)).map(([name]) => name)).toEqual([]);
  });

  test("the island UTs are inside, their foreign neighbours outside", () => {
    expect(isInIndia(11.62, 92.73)).toBe(true); // Port Blair
    expect(isInIndia(7.0, 93.9)).toBe(true); // Great Nicobar
    expect(isInIndia(10.57, 72.64)).toBe(true); // Kavaratti
    expect(isInIndia(14.12, 93.37)).toBe(false); // Coco Islands (Myanmar)
    expect(isInIndia(4.17, 73.51)).toBe(false); // Malé
  });
});

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
