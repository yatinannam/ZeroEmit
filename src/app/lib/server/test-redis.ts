// Test-only in-memory stand-in for the Upstash REST client (./redis), shared
// by every test file that mocks it so they can't disagree. Only the commands
// the app uses, with Upstash's reply shapes (e.g. scores come back as strings).
const strings = new Map<string, string>();
const zsets = new Map<string, Map<string, number>>();
const hashes = new Map<string, Map<string, string>>();

export const fakeRedis = { strings, zsets, hashes, roundTrips: 0 };

export function resetFakeRedis() {
  strings.clear();
  zsets.clear();
  hashes.clear();
  fakeRedis.roundTrips = 0;
}

const zrevOrder = (key: string) => [...(zsets.get(key) ?? new Map<string, number>()).entries()]
  .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))
  .map(([member]) => member);

function run(command: (string | number)[]): unknown {
  const [name, key, ...args] = command.map(String);
  switch (name) {
    case "GET": return strings.get(key) ?? null;
    case "SET": strings.set(key, args[0]); return "OK";
    case "DEL": return strings.delete(key) || hashes.delete(key) ? 1 : 0;
    case "MGET": return [key, ...args].map((k) => strings.get(k) ?? null);
    case "INCR": { const next = Number(strings.get(key) ?? 0) + 1; strings.set(key, String(next)); return next; }
    case "EXPIRE": return 1;
    case "ZADD": { const set = zsets.get(key) ?? new Map<string, number>(); set.set(args[1], Number(args[0])); zsets.set(key, set); return 1; }
    case "ZREM": return zsets.get(key)?.delete(args[0]) ? 1 : 0;
    case "ZCARD": return zsets.get(key)?.size ?? 0;
    case "ZSCORE": { const score = zsets.get(key)?.get(args[0]); return score === undefined ? null : String(score); }
    case "ZREVRANGE": {
      const stop = Number(args[1]);
      const members = zrevOrder(key).slice(Number(args[0]), stop < 0 ? undefined : stop + 1);
      return args[2] === "WITHSCORES" ? members.flatMap((member) => [member, String(zsets.get(key)!.get(member))]) : members;
    }
    case "ZREVRANK": { const index = zrevOrder(key).indexOf(args[0]); return index === -1 ? null : index; }
    case "HSET": { const hash = hashes.get(key) ?? new Map<string, string>(); hash.set(args[0], args[1]); hashes.set(key, hash); return 1; }
    case "HGET": return hashes.get(key)?.get(args[0]) ?? null;
    case "HGETALL": return [...(hashes.get(key) ?? new Map<string, string>()).entries()].flat();
    case "HDEL": return hashes.get(key)?.delete(args[0]) ? 1 : 0;
    default: throw new Error(`fake redis: unsupported ${name}`);
  }
}

// What `mock.module("./redis", () => fakeRedisModule)` should return. Each
// call, and each transaction, counts as one round trip.
export const fakeRedisModule = {
  redisConfigured: true,
  redis: async (...command: (string | number)[]) => { fakeRedis.roundTrips += 1; return run(command); },
  redisTransaction: async (commands: (string | number)[][]) => { fakeRedis.roundTrips += 1; return commands.map(run); },
};
