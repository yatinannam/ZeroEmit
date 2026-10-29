// Refreshes the snapshot of India's public EV chargers from OpenStreetMap
// (src/app/lib/server/chargers-india.json), which /api/stations searches.
// Run with `bun run chargers`; a weekly GitHub workflow runs it and commits
// any change, which redeploys the app. When every public Overpass server is
// busy, save INDIA_CHARGERS_QUERY's answer some other way (e.g. overpass-turbo)
// and pass the file: `bun run chargers path/to/answer.json`.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { firstOverpassAnswer, OVERPASS_SERVERS } from "../src/app/lib/server/overpass";
import { compactChargers, INDIA_CHARGERS_QUERY, type ChargerElement } from "../src/app/lib/stations";

const FILE = new URL("../src/app/lib/server/chargers-india.json", import.meta.url);

const saved = process.argv[2];
const answer: unknown = saved ? JSON.parse(readFileSync(saved, "utf8")) : await firstOverpassAnswer(OVERPASS_SERVERS, INDIA_CHARGERS_QUERY, { timeoutMs: 200_000 });
if (answer === null) {
  console.error("No Overpass server returned the chargers. Try again later.");
  process.exit(1);
}
const elements = compactChargers(answer);

const previous: ChargerElement[] = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as { elements: ChargerElement[] }).elements : [];
// A server can return a partial answer without saying so; a big drop is far
// more likely that than chargers disappearing, so keep the old snapshot.
if (elements.length < previous.length * 0.8) {
  console.error(`Got ${elements.length} chargers, down from ${previous.length}; keeping the current snapshot.`);
  process.exit(1);
}
if (JSON.stringify(elements) === JSON.stringify(previous)) {
  console.log(`No change (${elements.length} chargers).`);
  process.exit(0);
}

// One charger per line, so a refresh's diff shows what changed.
const lines = elements.map((element) => `    ${JSON.stringify(element)}`).join(",\n");
// When the map data is from, not when this ran.
const dataTime = (answer as { osm3s?: { timestamp_osm_base?: string } }).osm3s?.timestamp_osm_base ?? new Date().toISOString();
writeFileSync(FILE, `{\n  "updatedAt": "${dataTime}",\n  "elements": [\n${lines}\n  ]\n}\n`);
console.log(`Saved ${elements.length} chargers (was ${previous.length}).`);
