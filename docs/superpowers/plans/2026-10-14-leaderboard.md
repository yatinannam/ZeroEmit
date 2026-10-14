# Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A real, opt-in monthly leaderboard (All India / my region) on the Rewards page, backed by Upstash Redis, with server-side score recomputation.

**Architecture:** Pure scoring rules live in `src/app/lib/leaderboard.ts`, shared by the client (to build the payload) and the server (to recompute points/CO₂ with limits). `src/app/lib/server/leaderboard.ts` stores members and monthly sorted sets in Redis; two route handlers expose it. On the client, a localStorage membership store, a layout-mounted sync component, and a `leaderboard.tsx` UI module (Rewards card, full page, join modal).

**Tech Stack:** Next.js 16 App Router (route handlers are not cached by default — `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`), React 19 (`useSyncExternalStore`, React Compiler lint rules), Upstash Redis REST via `src/app/lib/server/redis.ts`, `bun test` for unit tests, Playwright (`playwright-core` already installed in the session scratchpad's `node_modules`) for end-to-end checks.

**Spec:** `docs/superpowers/specs/2026-10-14-leaderboard-design.md`

## Global Constraints

- Ranking = Eco points earned **this IST calendar month**; resets on the 1st. Month key `YYYY-MM` from `istDayKey`.
- Points rule (shared from `lib/rewards.ts`): `POINTS_PER_CHARGE` (10) + `GREEN_CHARGE_BONUS` (5) when green; green only counts when an intensity was recorded.
- CO₂ avoided = max(0, `UNTIMED_CHARGE_BASELINE` (650) − intensity) × kWh, skipped when intensity is null; reported in kg rounded to 0.1.
- Limits: ≤ 2 counted charges per day (the highest-scoring two), kWh clamped to 150 (`MAX_CHARGE_KWH`), intensity clamped to 0–2000, dates in the current IST month and not in the future, ≤ 100 charges per request, ≤ 30 updates per member per hour.
- Display names: 2–20 characters of letters (any script), digits and single spaces; short block list.
- Identity: public `id` and secret `key`, both `crypto.randomUUID()`; server stores only SHA-256 of `key`; keys never leave the device except in POST/DELETE bodies.
- Redis keys: `lb:member:<id>` (JSON), `lb:<YYYY-MM>:all` and `lb:<YYYY-MM>:<zone>` (sorted sets); all expire 70 days after their last write.
- Leaderboard size: top 50, plus the requester's own row when outside it.
- Errors: 400 invalid input, 403 wrong key, 429 too many updates, 503 Redis not configured (UI then hides the leaderboard), 502 Redis failure.
- No emojis in any UI or notification text. Copy uses "CO₂" with the subscript character.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. On this Windows machine, commit with `git commit -F <file>` (PowerShell 5.1 mangles quotes in `-m` strings), and never rewrite files through PowerShell `Get-Content`/`Set-Content` (it corrupts UTF-8 and adds a BOM).
- Type-check with `node node_modules/typescript/bin/tsc --noEmit` (`npx tsc` is not wired up here).

## Review Focus

1. A display name in a non-Latin script (e.g. "राहुल") must be accepted — Indian users. Test in Task 1.
2. A charge at 23:30 IST on the last day of the month must count for that month, and one at 00:30 IST on the 1st for the next, whatever the device's timezone. Test in Task 1.
3. A user whose location moves to another grid region mid-month must disappear from the old region's list and appear in the new one (still in All India). Test in Task 2.
4. Equal points: whoever reached the score first ranks higher, and a later re-sync with unchanged points must not lose that place. Test in Task 2.
5. A joined user ranked below the top 50 must still see their own row and rank. Test in Task 2.

---

### Task 1: Shared scoring rules and test setup

**Files:**
- Create: `src/app/lib/leaderboard.ts`
- Create: `src/app/lib/leaderboard.test.ts`
- Modify: `src/app/lib/rewards.ts` (add `MAX_CHARGE_KWH`)
- Modify: `src/app/components/log-screen.tsx:21` (use the shared constant)
- Modify: `tsconfig.json` (exclude `**/*.test.ts` — `bun:test` has no installed types, and Next's build type-checks every included file)
- Modify: `package.json` (add `"test": "bun test"`)

**Interfaces:**
- Consumes: `istDayKey` from `src/app/lib/grid.ts`; `isGreenCharge`, `POINTS_PER_CHARGE`, `GREEN_CHARGE_BONUS`, `UNTIMED_CHARGE_BASELINE` from `src/app/lib/rewards.ts`; `ZONE_LABELS`, `Zone` from `src/app/lib/places.ts`; `Charge` type from `src/app/components/use-charges.ts`.
- Produces (all from `src/app/lib/leaderboard.ts`):
  - `MAX_COUNTED_PER_DAY = 2`, `MAX_SUBMITTED_CHARGES = 100`, `MAX_INTENSITY = 2000`, `LEADERBOARD_SIZE = 50`, `ZONES: Zone[]`
  - `type LeaderboardCharge = { date: string; kwh: number; intensity: number | null; green: boolean }`
  - `type LeaderboardScope = "all" | Zone`
  - `type LeaderboardRow = { rank: number; name: string; zone: Zone; points: number; co2Kg: number; isMe: boolean }`
  - `type LeaderboardResponse = { month: string; total: number; rows: LeaderboardRow[]; me: LeaderboardRow | null }`
  - `istMonthKey(date: string | number | Date): string` → `"YYYY-MM"` in IST
  - `toLeaderboardCharges(charges: Charge[], month: string): LeaderboardCharge[]`
  - `scoreMonth(entries: LeaderboardCharge[], month: string, today: string): { points: number; co2Kg: number }`
  - `validateDisplayName(raw: unknown): string | null`
  - From `src/app/lib/rewards.ts`: `MAX_CHARGE_KWH = 150`

- [ ] **Step 1: Test setup**

In `tsconfig.json`, change `"exclude": ["node_modules"]` to:

```json
  "exclude": ["node_modules", "**/*.test.ts"]
```

In `package.json` `scripts`, add after `"lint": "eslint",`:

```json
    "test": "bun test",
```

- [ ] **Step 2: Write the failing tests**

Create `src/app/lib/leaderboard.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { Charge } from "../components/use-charges";
import { istMonthKey, scoreMonth, toLeaderboardCharges, validateDisplayName, type LeaderboardCharge } from "./leaderboard";

const entry = (date: string, kwh = 20, intensity: number | null = 600, green = false): LeaderboardCharge => ({ date, kwh, intensity, green });
const MONTH = "2026-10";
const TODAY = "2026-10-14";

describe("scoreMonth", () => {
  test("10 points a charge, +5 when green", () => {
    expect(scoreMonth([entry("2026-10-01"), entry("2026-10-02", 20, 400, true)], MONTH, TODAY).points).toBe(25);
  });

  test("green only counts when an intensity was recorded", () => {
    expect(scoreMonth([entry("2026-10-01", 20, null, true)], MONTH, TODAY).points).toBe(10);
  });

  test("CO2 avoided is (650 - intensity) x kWh, never negative, skipped without intensity, in kg to 0.1", () => {
    // (650 - 400) x 20 = 5000 g; 700 is above the baseline -> 0; null -> 0
    const result = scoreMonth([entry("2026-10-01", 20, 400), entry("2026-10-02", 20, 700), entry("2026-10-03", 20, null)], MONTH, TODAY);
    expect(result.co2Kg).toBe(5);
  });

  test("only the best two charges of a day count", () => {
    const day = [entry("2026-10-05"), entry("2026-10-05", 20, 400, true), entry("2026-10-05"), entry("2026-10-05", 20, 300, true)];
    expect(scoreMonth(day, MONTH, TODAY).points).toBe(30);
  });

  test("other months and future days are ignored", () => {
    const result = scoreMonth([entry("2026-09-30"), entry("2026-10-15"), entry("2026-11-01"), entry("2026-10-14")], MONTH, TODAY);
    expect(result.points).toBe(10);
  });

  test("kWh is capped at 150 and intensity clamped to 0..2000", () => {
    // kWh 500 -> 150, intensity -100 -> 0: (650 - 0) x 150 = 97500 g
    expect(scoreMonth([entry("2026-10-01", 500, -100)], MONTH, TODAY).co2Kg).toBe(97.5);
    // intensity 5000 -> 2000, above the baseline -> no CO2, still a charge
    expect(scoreMonth([entry("2026-10-01", 20, 5000)], MONTH, TODAY)).toEqual({ points: 10, co2Kg: 0 });
  });

  test("a full month at the cap is 31 x 2 x 15 = 930 points", () => {
    const month = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`)
      .flatMap((date) => [entry(date, 20, 300, true), entry(date, 20, 300, true), entry(date, 20, 300, true)]);
    expect(scoreMonth(month, MONTH, "2026-10-31").points).toBe(930);
  });
});

describe("istMonthKey", () => {
  test("uses IST, not UTC or the device timezone", () => {
    expect(istMonthKey("2026-10-31T18:00:00.000Z")).toBe("2026-10"); // 23:30 IST, 31 Oct
    expect(istMonthKey("2026-10-31T19:00:00.000Z")).toBe("2026-11"); // 00:30 IST, 1 Nov
  });
});

describe("toLeaderboardCharges", () => {
  const charge = (loggedAt: string, extra: Partial<Charge> = {}): Charge => ({ id: loggedAt, energyKwh: 18, chargedAt: "10:00", city: "Pune, Maharashtra", carbonIntensity: 420, intensityClass: null, loggedAt, ...extra });

  test("keeps only this IST month's charges, dated in IST", () => {
    const out = toLeaderboardCharges([charge("2026-10-31T19:00:00.000Z"), charge("2026-10-31T18:00:00.000Z"), charge("2026-09-30T10:00:00.000Z")], "2026-10");
    expect(out).toEqual([{ date: "2026-10-31", kwh: 18, intensity: 420, green: true }]);
  });

  test("green follows the app's rule: the provider's class wins over the fallback threshold", () => {
    const out = toLeaderboardCharges([charge("2026-10-10T05:00:00.000Z", { intensityClass: "yellow" })], "2026-10");
    expect(out[0].green).toBe(false);
  });

  test("sends at most 100 charges", () => {
    const many = Array.from({ length: 120 }, (_, i) => charge(new Date(Date.parse("2026-10-01T00:00:00.000Z") + i * 3_600_000).toISOString()));
    expect(toLeaderboardCharges(many, "2026-10")).toHaveLength(100);
  });
});

describe("validateDisplayName", () => {
  test("trims and collapses spaces", () => {
    expect(validateDisplayName("  Asha   Rao ")).toBe("Asha Rao");
  });

  test("accepts letters in any script", () => {
    expect(validateDisplayName("राहुल")).toBe("राहुल");
  });

  test("rejects too short, too long, symbols and non-strings", () => {
    expect(validateDisplayName("A")).toBeNull();
    expect(validateDisplayName("x".repeat(21))).toBeNull();
    expect(validateDisplayName("<script>")).toBeNull();
    expect(validateDisplayName("Rahul_1")).toBeNull();
    expect(validateDisplayName(42)).toBeNull();
  });

  test("blocks offensive words without blocking ordinary names", () => {
    expect(validateDisplayName("fuck you")).toBeNull();
    expect(validateDisplayName("xFuCkx")).toBeNull();
    expect(validateDisplayName("Dickens")).toBe("Dickens");
    expect(validateDisplayName("Lundgren")).toBe("Lundgren");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test src/app/lib/leaderboard.test.ts`
Expected: FAIL — `Cannot find module './leaderboard'`.

- [ ] **Step 4: Add the shared kWh limit**

In `src/app/lib/rewards.ts`, after `export const GREEN_CHARGE_BONUS = 5;` add:

```ts
// Largest charge the log form accepts; the leaderboard clamps to it too.
export const MAX_CHARGE_KWH = 150;
```

In `src/app/components/log-screen.tsx`, delete the line `const MAX_KWH = 150;` and change line 5 from `import { chargeOutcome, pointsForCharge } from "../lib/rewards";` to:

```ts
import { chargeOutcome, MAX_CHARGE_KWH as MAX_KWH, pointsForCharge } from "../lib/rewards";
```

- [ ] **Step 5: Write the implementation**

Create `src/app/lib/leaderboard.ts`:

```ts
import type { Charge } from "../components/use-charges";
import { istDayKey } from "./grid";
import { ZONE_LABELS, type Zone } from "./places";
import { GREEN_CHARGE_BONUS, isGreenCharge, MAX_CHARGE_KWH, POINTS_PER_CHARGE, UNTIMED_CHARGE_BASELINE } from "./rewards";

// Rules shared by the app (building what it sends) and the server (which
// recomputes the score itself rather than trusting a number from the client).
export const MAX_COUNTED_PER_DAY = 2;
export const MAX_SUBMITTED_CHARGES = 100;
export const MAX_INTENSITY = 2000;
export const LEADERBOARD_SIZE = 50;
export const ZONES = Object.keys(ZONE_LABELS) as Zone[];

export type LeaderboardCharge = { date: string; kwh: number; intensity: number | null; green: boolean };
export type LeaderboardScope = "all" | Zone;
export type LeaderboardRow = { rank: number; name: string; zone: Zone; points: number; co2Kg: number; isMe: boolean };
export type LeaderboardResponse = { month: string; total: number; rows: LeaderboardRow[]; me: LeaderboardRow | null };

export const istMonthKey = (date: string | number | Date) => istDayKey(date).slice(0, 7);

// This IST month's charges, newest first (the order useCharges keeps), as the
// little the server needs to score them.
export function toLeaderboardCharges(charges: Charge[], month: string): LeaderboardCharge[] {
  return charges
    .filter((charge) => istMonthKey(charge.loggedAt) === month)
    .slice(0, MAX_SUBMITTED_CHARGES)
    .map((charge) => ({ date: istDayKey(charge.loggedAt), kwh: charge.energyKwh, intensity: charge.carbonIntensity, green: isGreenCharge(charge) }));
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

// Points and CO2 avoided for `month` ("YYYY-MM"), counting days up to `today`
// ("YYYY-MM-DD") and at most the best MAX_COUNTED_PER_DAY charges a day —
// charges are self-reported, so this bounds what logging fake ones can earn.
export function scoreMonth(entries: LeaderboardCharge[], month: string, today: string): { points: number; co2Kg: number } {
  const byDay = new Map<string, { points: number; grams: number }[]>();
  for (const entry of entries) {
    if (!entry.date.startsWith(`${month}-`) || entry.date > today) continue;
    const kwh = clamp(entry.kwh, 0, MAX_CHARGE_KWH);
    const intensity = entry.intensity === null ? null : clamp(entry.intensity, 0, MAX_INTENSITY);
    const points = POINTS_PER_CHARGE + (entry.green && intensity !== null ? GREEN_CHARGE_BONUS : 0);
    const grams = intensity === null ? 0 : Math.max(0, UNTIMED_CHARGE_BASELINE - intensity) * kwh;
    const day = byDay.get(entry.date) ?? [];
    day.push({ points, grams });
    byDay.set(entry.date, day);
  }
  let points = 0;
  let grams = 0;
  for (const day of byDay.values()) {
    day.sort((a, b) => b.points - a.points || b.grams - a.grams);
    for (const charge of day.slice(0, MAX_COUNTED_PER_DAY)) { points += charge.points; grams += charge.grams; }
  }
  return { points, co2Kg: Math.round(grams / 100) / 10 };
}

// Built at runtime: TypeScript rejects \p{…} in a regex literal at this
// project's ES2017 target.
const NAME_PATTERN = new RegExp("^[\\p{L}\\p{M}\\p{N}]+( [\\p{L}\\p{M}\\p{N}]+)*$", "u");
// Whole words only, so names like "Dickens" or "Lundgren" pass…
const BLOCKED_WORDS = new Set(["fuck", "fucker", "shit", "bitch", "bastard", "cunt", "dick", "asshole", "slut", "whore", "nigger", "chutiya", "madarchod", "bhenchod", "behenchod", "gandu", "randi", "bsdk", "lund", "harami", "porn", "sex"]);
// …while these are blocked anywhere in the name, ignoring case and spacing.
const BLOCKED_ANYWHERE = ["fuck", "nigger", "madarchod", "bhenchod", "behenchod", "chutiya"];

export function validateDisplayName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 20 || !NAME_PATTERN.test(name)) return null;
  const lower = name.toLowerCase();
  if (lower.split(" ").some((word) => BLOCKED_WORDS.has(word))) return null;
  const squashed = lower.replace(/[^a-z]/g, "");
  return BLOCKED_ANYWHERE.some((word) => squashed.includes(word)) ? null : name;
}
```

Note: `\p{M}` (combining marks) is required — Devanagari vowel signs like the "ा" in "राहुल" are marks, not letters.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test src/app/lib/leaderboard.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 7: Type-check and lint**

Run: `node node_modules/typescript/bin/tsc --noEmit && npx eslint src/app/lib src/app/components/log-screen.tsx`
Expected: no output (clean).

- [ ] **Step 8: Commit**

```bash
git add tsconfig.json package.json src/app/lib/leaderboard.ts src/app/lib/leaderboard.test.ts src/app/lib/rewards.ts src/app/components/log-screen.tsx
git commit -F <message file: "feat: shared leaderboard scoring rules" + Co-Authored-By line>
```

---

### Task 2: Server-side leaderboard store

**Files:**
- Create: `src/app/lib/server/leaderboard.ts`
- Create: `src/app/lib/server/leaderboard.test.ts`

**Interfaces:**
- Consumes: everything Task 1 produces; `istDayKey` from `../grid`; `Zone` from `../places`; `redis<T>(...command: (string | number)[]): Promise<T>` and `redisConfigured: boolean` from `./redis`.
- Produces (from `src/app/lib/server/leaderboard.ts`):
  - `leaderboardConfigured: boolean`
  - `isUuid(value: unknown): value is string`, `isZone(value: unknown): value is Zone`
  - `type MemberInput = { id: string; key: string; name: string; zone: Zone; charges: LeaderboardCharge[] }`
  - `type SubmitResult = { ok: true; rank: number; points: number; co2Kg: number } | { ok: false; status: 403 | 429 }`
  - `parseMemberBody(body: unknown): MemberInput | null`
  - `submitMember(input: MemberInput, now?: number): Promise<SubmitResult>`
  - `removeMember(id: string, key: string): Promise<"ok" | "forbidden">`
  - `readLeaderboard(scope: LeaderboardScope, me: string | null, now?: number): Promise<LeaderboardResponse>`

- [ ] **Step 1: Write the failing tests**

Create `src/app/lib/server/leaderboard.test.ts`:

```ts
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { LeaderboardCharge } from "../leaderboard";

// In-memory stand-in for the Upstash REST client — only the commands the
// leaderboard uses, with Redis's ordering (score desc, then member desc).
const strings = new Map<string, string>();
const zsets = new Map<string, Map<string, number>>();
const zrevOrder = (key: string) => [...(zsets.get(key) ?? new Map<string, number>()).entries()]
  .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))
  .map(([member]) => member);
async function fakeRedis(...command: (string | number)[]): Promise<unknown> {
  const [name, key, ...args] = command.map(String);
  switch (name) {
    case "GET": return strings.get(key) ?? null;
    case "SET": strings.set(key, args[0]); return "OK";
    case "DEL": return strings.delete(key) ? 1 : 0;
    case "MGET": return [key, ...args].map((k) => strings.get(k) ?? null);
    case "INCR": { const next = Number(strings.get(key) ?? 0) + 1; strings.set(key, String(next)); return next; }
    case "EXPIRE": return 1;
    case "ZADD": { const set = zsets.get(key) ?? new Map<string, number>(); set.set(args[1], Number(args[0])); zsets.set(key, set); return 1; }
    case "ZREM": return zsets.get(key)?.delete(args[0]) ? 1 : 0;
    case "ZCARD": return zsets.get(key)?.size ?? 0;
    case "ZREVRANGE": return zrevOrder(key).slice(Number(args[0]), Number(args[1]) + 1);
    case "ZREVRANK": { const index = zrevOrder(key).indexOf(args[0]); return index === -1 ? null : index; }
    default: throw new Error(`fake redis: unsupported ${name}`);
  }
}
mock.module("./redis", () => ({ redis: fakeRedis, redisConfigured: true }));
const { parseMemberBody, readLeaderboard, removeMember, submitMember } = await import("./leaderboard");

const NOW = Date.parse("2026-10-14T06:30:00.000Z"); // noon IST, 14 Oct
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// `count` one-a-day charges from 1 Oct: 10 points each, 15 when green.
const charges = (count: number, green = false): LeaderboardCharge[] =>
  Array.from({ length: count }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, kwh: 20, intensity: green ? 300 : 600, green }));
const member = (n: number, count: number, extra: Partial<{ name: string; zone: "western" | "southern"; key: string; green: boolean }> = {}) =>
  ({ id: uuid(n), key: extra.key ?? uuid(1000 + n), name: extra.name ?? `Player ${n}`, zone: extra.zone ?? "western", charges: charges(count, extra.green) });

beforeEach(() => { strings.clear(); zsets.clear(); });

describe("parseMemberBody", () => {
  const valid = { id: uuid(1), key: uuid(2), name: "Asha", zone: "western", charges: [{ date: "2026-10-01", kwh: 18, intensity: 420, green: true }] };

  test("accepts a valid body", () => {
    expect(parseMemberBody(valid)).toEqual(valid as never);
  });

  test("rejects bad ids, keys, names, zones, charges and oversized lists", () => {
    expect(parseMemberBody({ ...valid, id: "not-a-uuid" })).toBeNull();
    expect(parseMemberBody({ ...valid, key: 7 })).toBeNull();
    expect(parseMemberBody({ ...valid, name: "x" })).toBeNull();
    expect(parseMemberBody({ ...valid, zone: "central" })).toBeNull();
    expect(parseMemberBody({ ...valid, charges: [{ date: "2026-10-01", kwh: 18, green: true }] })).toBeNull(); // intensity missing
    expect(parseMemberBody({ ...valid, charges: [{ date: "1 Oct", kwh: 18, intensity: null, green: false }] })).toBeNull();
    expect(parseMemberBody({ ...valid, charges: [{ date: "2026-10-01", kwh: 0, intensity: null, green: false }] })).toBeNull();
    expect(parseMemberBody({ ...valid, charges: Array(101).fill(valid.charges[0]) })).toBeNull();
    expect(parseMemberBody(null)).toBeNull();
  });
});

describe("submitMember + readLeaderboard", () => {
  test("ranks members by recomputed monthly points", async () => {
    await submitMember(member(1, 3), NOW);              // 30
    await submitMember(member(2, 5), NOW);              // 50
    const third = await submitMember(member(3, 4, { green: true }), NOW); // 60
    expect(third).toEqual({ ok: true, rank: 1, points: 60, co2Kg: 28 }); // (650-300) x 20 x 4 = 28000 g

    const board = await readLeaderboard("all", uuid(1), NOW);
    expect(board.month).toBe("2026-10");
    expect(board.total).toBe(3);
    expect(board.rows.map((row) => [row.rank, row.name, row.points, row.isMe])).toEqual([[1, "Player 3", 60, false], [2, "Player 2", 50, false], [3, "Player 1", 30, true]]);
    expect(board.me?.rank).toBe(3);
  });

  test("a wrong key can't overwrite someone else's entry", async () => {
    await submitMember(member(1, 3), NOW);
    expect(await submitMember(member(1, 9, { key: uuid(999) }), NOW)).toEqual({ ok: false, status: 403 });
    expect((await readLeaderboard("all", null, NOW)).rows[0].points).toBe(30);
  });

  test("ties go to whoever reached the score first, and re-syncing doesn't lose that", async () => {
    await submitMember(member(1, 2), NOW);
    await submitMember(member(2, 2), NOW + 60_000);
    await submitMember(member(1, 2), NOW + 120_000); // same points again
    expect((await readLeaderboard("all", null, NOW + 120_000)).rows.map((row) => row.name)).toEqual(["Player 1", "Player 2"]);
  });

  test("region lists follow the member's zone, including a mid-month move", async () => {
    await submitMember(member(1, 3, { zone: "western" }), NOW);
    expect((await readLeaderboard("western", null, NOW)).rows).toHaveLength(1);
    expect((await readLeaderboard("southern", null, NOW)).rows).toHaveLength(0);

    await submitMember(member(1, 3, { zone: "southern" }), NOW + 1000);
    expect((await readLeaderboard("western", null, NOW)).rows).toHaveLength(0);
    expect((await readLeaderboard("southern", null, NOW)).rows[0].zone).toBe("southern");
    expect((await readLeaderboard("all", null, NOW)).rows).toHaveLength(1);
  });

  test("a member below the top 50 still gets their own row", async () => {
    for (let n = 1; n <= 51; n += 1) await submitMember(member(n, n % 14 + 1), NOW); // 10-140 points each
    await submitMember(member(99, 0), NOW); // 0 points: last of 52
    const board = await readLeaderboard("all", uuid(99), NOW);
    expect(board.total).toBe(52);
    expect(board.rows).toHaveLength(50);
    expect(board.rows.some((row) => row.isMe)).toBe(false);
    expect(board.me).toEqual({ rank: 52, name: "Player 99", zone: "western", points: 0, co2Kg: 0, isMe: true });
  });

  test("more than 30 updates an hour are refused", async () => {
    for (let i = 0; i < 30; i += 1) expect((await submitMember(member(1, 1), NOW)).ok).toBe(true);
    expect(await submitMember(member(1, 1), NOW)).toEqual({ ok: false, status: 429 });
    expect((await submitMember(member(1, 1), NOW + 3_600_000)).ok).toBe(true); // next hour
  });

  test("a new month starts a fresh board; last month's set keeps its entry", async () => {
    const september = Date.parse("2026-09-20T06:30:00.000Z");
    await submitMember({ ...member(1, 0), charges: [{ date: "2026-09-20", kwh: 20, intensity: 600, green: false }] }, september);
    expect((await readLeaderboard("all", null, september)).rows[0].points).toBe(10);
    expect((await readLeaderboard("all", null, NOW)).rows).toHaveLength(0);
    await submitMember(member(1, 2), NOW);
    expect((await readLeaderboard("all", null, NOW)).rows[0].points).toBe(20);
    // The member record holds only the latest month (only the current board
    // is ever shown), but September's set still lists them.
    expect(zsets.get("lb:2026-09:all")?.has(uuid(1))).toBe(true);
  });
});

describe("removeMember", () => {
  test("removes the entry from every list; the key is required", async () => {
    await submitMember(member(1, 3), NOW);
    expect(await removeMember(uuid(1), uuid(999))).toBe("forbidden");
    expect(await removeMember(uuid(1), uuid(1001))).toBe("ok");
    expect((await readLeaderboard("all", uuid(1), NOW))).toEqual({ month: "2026-10", total: 0, rows: [], me: null });
    expect((await readLeaderboard("western", null, NOW)).rows).toHaveLength(0);
  });

  test("removing someone who isn't there is fine", async () => {
    expect(await removeMember(uuid(5), uuid(6))).toBe("ok");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/app/lib/server/leaderboard.test.ts`
Expected: FAIL — `Cannot find module './leaderboard'`.

- [ ] **Step 3: Write the implementation**

Create `src/app/lib/server/leaderboard.ts`:

```ts
import { createHash, timingSafeEqual } from "node:crypto";
import { istDayKey } from "../grid";
import { istMonthKey, LEADERBOARD_SIZE, MAX_SUBMITTED_CHARGES, scoreMonth, validateDisplayName, ZONES, type LeaderboardCharge, type LeaderboardResponse, type LeaderboardRow, type LeaderboardScope } from "../leaderboard";
import type { Zone } from "../places";
import { redis, redisConfigured } from "./redis";

export const leaderboardConfigured = redisConfigured;

const RETENTION_S = 70 * 24 * 60 * 60;
const UPDATES_PER_HOUR = 30;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// `scoredAt` is when `points` last changed — it breaks ties, so it must not
// move when a re-sync leaves the score where it was.
type MemberRecord = { name: string; zone: Zone; keyHash: string; month: string; points: number; co2Kg: number; scoredAt: number; updatedAt: number };
export type MemberInput = { id: string; key: string; name: string; zone: Zone; charges: LeaderboardCharge[] };
export type SubmitResult = { ok: true; rank: number; points: number; co2Kg: number } | { ok: false; status: 403 | 429 };

export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);
export const isZone = (value: unknown): value is Zone => typeof value === "string" && (ZONES as string[]).includes(value);

const memberKey = (id: string) => `lb:member:${id}`;
const boardKey = (month: string, scope: LeaderboardScope) => `lb:${month}:${scope}`;
const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");
function sameHash(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
// Sorted-set score: points, plus a fraction that is larger the earlier the
// score was reached (seconds keep it well inside double precision).
const sortScore = (points: number, scoredAt: number) => points + (2e10 - Math.floor(scoredAt / 1000)) / 1e11;

function parseCharge(raw: unknown): LeaderboardCharge | null {
  if (!raw || typeof raw !== "object") return null;
  const charge = raw as Record<string, unknown>;
  if (typeof charge.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(charge.date)) return null;
  if (typeof charge.kwh !== "number" || !Number.isFinite(charge.kwh) || charge.kwh < 0.1) return null;
  if (charge.intensity !== null && (typeof charge.intensity !== "number" || !Number.isFinite(charge.intensity))) return null;
  if (typeof charge.green !== "boolean") return null;
  return { date: charge.date, kwh: charge.kwh, intensity: charge.intensity as number | null, green: charge.green };
}

export function parseMemberBody(body: unknown): MemberInput | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const name = validateDisplayName(value.name);
  if (!isUuid(value.id) || !isUuid(value.key) || !name || !isZone(value.zone)) return null;
  if (!Array.isArray(value.charges) || value.charges.length > MAX_SUBMITTED_CHARGES) return null;
  const charges = value.charges.map(parseCharge);
  if (charges.some((charge) => charge === null)) return null;
  return { id: value.id, key: value.key, name, zone: value.zone, charges: charges as LeaderboardCharge[] };
}

async function getMember(id: string): Promise<MemberRecord | null> {
  const raw = await redis<string | null>("GET", memberKey(id));
  return raw ? JSON.parse(raw) as MemberRecord : null;
}

export async function submitMember(input: MemberInput, now = Date.now()): Promise<SubmitResult> {
  const existing = await getMember(input.id);
  const keyHash = hashKey(input.key);
  if (existing && !sameHash(existing.keyHash, keyHash)) return { ok: false, status: 403 };

  const rateKey = `lb:rate:${input.id}:${Math.floor(now / 3_600_000)}`;
  const updates = await redis<number>("INCR", rateKey);
  if (updates === 1) await redis("EXPIRE", rateKey, 3600);
  if (updates > UPDATES_PER_HOUR) return { ok: false, status: 429 };

  const month = istMonthKey(now);
  const { points, co2Kg } = scoreMonth(input.charges, month, istDayKey(now));
  const sameMonth = existing !== null && existing.month === month;
  const scoredAt = sameMonth && existing.points === points ? existing.scoredAt : now;
  // Moved region this month: leave the old region's list (All India stays).
  if (sameMonth && existing.zone !== input.zone) await redis("ZREM", boardKey(month, existing.zone), input.id);

  const record: MemberRecord = { name: input.name, zone: input.zone, keyHash, month, points, co2Kg, scoredAt, updatedAt: now };
  const scopes: LeaderboardScope[] = ["all", input.zone];
  for (const scope of scopes) {
    await redis("ZADD", boardKey(month, scope), sortScore(points, scoredAt), input.id);
    await redis("EXPIRE", boardKey(month, scope), RETENTION_S);
  }
  await redis("SET", memberKey(input.id), JSON.stringify(record), "EX", RETENTION_S);
  const rank = await redis<number | null>("ZREVRANK", boardKey(month, "all"), input.id);
  return { ok: true, rank: (rank ?? 0) + 1, points, co2Kg };
}

export async function removeMember(id: string, key: string): Promise<"ok" | "forbidden"> {
  const existing = await getMember(id);
  if (!existing) return "ok";
  if (!sameHash(existing.keyHash, hashKey(key))) return "forbidden";
  await redis("ZREM", boardKey(existing.month, "all"), id);
  await redis("ZREM", boardKey(existing.month, existing.zone), id);
  await redis("DEL", memberKey(id));
  return "ok";
}

const toRow = (rank: number, record: MemberRecord, isMe: boolean): LeaderboardRow => ({ rank, name: record.name, zone: record.zone, points: record.points, co2Kg: record.co2Kg, isMe });

export async function readLeaderboard(scope: LeaderboardScope, me: string | null, now = Date.now()): Promise<LeaderboardResponse> {
  const month = istMonthKey(now);
  const key = boardKey(month, scope);
  const [ids, total] = await Promise.all([redis<string[]>("ZREVRANGE", key, 0, LEADERBOARD_SIZE - 1), redis<number>("ZCARD", key)]);
  const records = ids.length ? await redis<(string | null)[]>("MGET", ...ids.map(memberKey)) : [];
  const rows: LeaderboardRow[] = [];
  ids.forEach((id, index) => {
    const raw = records[index];
    if (raw) rows.push(toRow(index + 1, JSON.parse(raw) as MemberRecord, id === me));
  });
  let mine = rows.find((row) => row.isMe) ?? null;
  if (!mine && me) {
    const [rank, record] = await Promise.all([redis<number | null>("ZREVRANK", key, me), getMember(me)]);
    if (rank !== null && record) mine = toRow(rank + 1, record, true);
  }
  return { month, total, rows, me: mine };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/app/lib/server/leaderboard.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Run all unit tests, type-check, lint**

Run: `bun test && node node_modules/typescript/bin/tsc --noEmit && npx eslint src/app/lib`
Expected: all tests pass; no tsc or eslint output.

- [ ] **Step 6: Commit**

```bash
git add src/app/lib/server/leaderboard.ts src/app/lib/server/leaderboard.test.ts
git commit -F <message file: "feat: leaderboard store with server-side scoring" + Co-Authored-By line>
```

---

### Task 3: API routes

**Files:**
- Create: `src/app/api/leaderboard/route.ts`
- Create: `src/app/api/leaderboard/member/route.ts`
- Create (scratchpad, not committed): `<scratchpad>/mock-upstash.mjs`

**Interfaces:**
- Consumes: `leaderboardConfigured`, `isUuid`, `isZone`, `parseMemberBody`, `submitMember`, `removeMember`, `readLeaderboard` from Task 2.
- Produces:
  - `GET /api/leaderboard?scope=all|<zone>&me=<uuid>` → 200 `LeaderboardResponse`; 400 `{ error }` for a bad scope or `me`; 503 when not configured; 502 on Redis failure.
  - `POST /api/leaderboard/member` body `{ id, key, name, zone, charges }` → 200 `{ rank, points, co2Kg }`; 400 / 403 / 429 / 503 / 502 `{ error }`.
  - `DELETE /api/leaderboard/member` body `{ id, key }` → 200 `{ ok: true }`; 400 / 403 / 503 / 502.

- [ ] **Step 1: Write the mock Upstash server (scratchpad)**

Create `<scratchpad>/mock-upstash.mjs`:

```js
// In-memory Upstash REST stand-in for local end-to-end checks: POST / with a
// JSON command array, answers { result }.
import { createServer } from "node:http";

const strings = new Map();
const zsets = new Map();
const zrev = (key) => [...(zsets.get(key) ?? new Map()).entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1)).map(([member]) => member);

function run([name, key, ...args]) {
  switch (name.toUpperCase()) {
    case "GET": return strings.get(key) ?? null;
    case "SET": strings.set(key, args[0]); return "OK";
    case "DEL": return strings.delete(key) ? 1 : 0;
    case "MGET": return [key, ...args].map((k) => strings.get(k) ?? null);
    case "INCR": { const next = Number(strings.get(key) ?? 0) + 1; strings.set(key, String(next)); return next; }
    case "EXPIRE": return 1;
    case "ZADD": { const set = zsets.get(key) ?? new Map(); set.set(args[1], Number(args[0])); zsets.set(key, set); return 1; }
    case "ZREM": return zsets.get(key)?.delete(args[0]) ? 1 : 0;
    case "ZCARD": return zsets.get(key)?.size ?? 0;
    case "ZREVRANGE": return zrev(key).slice(Number(args[0]), Number(args[1]) + 1);
    case "ZREVRANK": { const index = zrev(key).indexOf(args[0]); return index === -1 ? null : index; }
    default: throw new Error(`unsupported ${name}`);
  }
}

createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    try {
      const result = run(JSON.parse(body).map(String));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ result }));
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: String(error.message) }));
    }
  });
}).listen(8790, () => console.log("mock upstash on :8790"));
```

- [ ] **Step 2: Write the read route**

Create `src/app/api/leaderboard/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { isUuid, isZone, leaderboardConfigured, readLeaderboard } from "../../lib/server/leaderboard";

// Not cached: route handlers aren't by default in this Next.js version, and
// the board changes whenever anyone logs a charge.
export async function GET(request: NextRequest) {
  if (!leaderboardConfigured) return NextResponse.json({ error: "The leaderboard isn't set up on this server." }, { status: 503 });
  const params = request.nextUrl.searchParams;
  const scope = params.get("scope") ?? "all";
  const me = params.get("me");
  if (scope !== "all" && !isZone(scope)) return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  if (me !== null && !isUuid(me)) return NextResponse.json({ error: "Invalid member" }, { status: 400 });
  try {
    return NextResponse.json(await readLeaderboard(scope, me), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't load the leaderboard" }, { status: 502 });
  }
}
```

- [ ] **Step 3: Write the member route**

Create `src/app/api/leaderboard/member/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { isUuid, leaderboardConfigured, parseMemberBody, removeMember, submitMember } from "../../../lib/server/leaderboard";

const NOT_CONFIGURED = { error: "The leaderboard isn't set up on this server." };
const MAX_BODY_BYTES = 16_384; // 100 charges is ~8 KB

async function readJson(request: NextRequest): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// Join, or update this month's score. The server recomputes the score from
// the charges; the key proves this device owns the entry.
export async function POST(request: NextRequest) {
  if (!leaderboardConfigured) return NextResponse.json(NOT_CONFIGURED, { status: 503 });
  const input = parseMemberBody(await readJson(request));
  if (!input) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const result = await submitMember(input);
    if (!result.ok) return NextResponse.json({ error: result.status === 403 ? "Not your entry" : "Too many updates" }, { status: result.status });
    return NextResponse.json({ rank: result.rank, points: result.points, co2Kg: result.co2Kg });
  } catch {
    return NextResponse.json({ error: "Couldn't update the leaderboard" }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!leaderboardConfigured) return NextResponse.json(NOT_CONFIGURED, { status: 503 });
  const body = await readJson(request) as { id?: unknown; key?: unknown } | null;
  if (!isUuid(body?.id) || !isUuid(body?.key)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const result = await removeMember(body.id, body.key);
    if (result === "forbidden") return NextResponse.json({ error: "Not your entry" }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't leave the leaderboard" }, { status: 502 });
  }
}
```

- [ ] **Step 4: Build and start against the mock**

Run (Bash; `SP` = the scratchpad path):

```bash
node node_modules/typescript/bin/tsc --noEmit && npx eslint src/app/api/leaderboard && npx next build 2>&1 | grep -E "Compiled|rror"
(node "$SP/mock-upstash.mjs" > "$SP/mock.log" 2>&1 &)
(UPSTASH_REDIS_REST_URL=http://localhost:8790 UPSTASH_REDIS_REST_TOKEN=test nohup npx next start -p 3430 > "$SP/start3430.log" 2>&1 &)
for i in $(seq 1 30); do curl -s -o /dev/null -w "%{http_code}" http://localhost:3430/ --max-time 5 | grep -q 200 && break; sleep 1; done
```

Expected: `✓ Compiled successfully`; server answers 200. If port 3430 is already taken, stop that process first (PowerShell: `Get-NetTCPConnection -LocalPort 3430 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`) — a stale server serves an old build.

- [ ] **Step 5: Exercise the routes**

```bash
ID=00000000-0000-4000-8000-000000000001; KEY=00000000-0000-4000-8000-000000000101
TODAY=$(TZ=Asia/Kolkata date +%Y-%m-%d)
J='{"id":"'$ID'","key":"'$KEY'","name":"Asha","zone":"western","charges":[{"date":"'$TODAY'","kwh":18,"intensity":400,"green":true}]}'
curl -s -X POST localhost:3430/api/leaderboard/member -H 'content-type: application/json' -d "$J"; echo
curl -s -X POST localhost:3430/api/leaderboard/member -H 'content-type: application/json' -d "${J/$KEY/00000000-0000-4000-8000-000000000999}" -w " %{http_code}\n"
curl -s "localhost:3430/api/leaderboard?scope=all&me=$ID"; echo
curl -s "localhost:3430/api/leaderboard?scope=central" -w " %{http_code}\n"
curl -s -X DELETE localhost:3430/api/leaderboard/member -H 'content-type: application/json' -d '{"id":"'$ID'","key":"'$KEY'"}'; echo
curl -s "localhost:3430/api/leaderboard?scope=western"; echo
```

Expected, in order:
1. `{"rank":1,"points":15,"co2Kg":4.5}`
2. `{"error":"Not your entry"} 403`
3. `{"month":"<this month>","total":1,"rows":[{"rank":1,"name":"Asha","zone":"western","points":15,"co2Kg":4.5,"isMe":true}],"me":{…same row…}}`
4. `{"error":"Invalid scope"} 400`
5. `{"ok":true}`
6. `{"month":"…","total":0,"rows":[],"me":null}`

Leave the mock and the server running for Task 4.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/leaderboard
git commit -F <message file: "feat: leaderboard API routes" + Co-Authored-By line>
```

---

### Task 4: Join, sync and the leaderboard UI

**Files:**
- Create: `src/app/components/use-leaderboard.ts`
- Create: `src/app/components/leaderboard-sync.tsx`
- Create: `src/app/components/leaderboard.tsx`
- Create: `src/app/rewards/leaderboard/page.tsx`
- Modify: `src/app/layout.tsx:8,46` (mount `LeaderboardSync`)
- Modify: `src/app/components/rewards-screen.tsx` (render `LeaderboardCard` first)
- Modify: `src/app/components/app-shell.tsx:11` (Rewards tab stays active on `/rewards/leaderboard`)
- Modify: `src/app/globals.css` (append leaderboard styles)
- Create (scratchpad): `<scratchpad>/verify-leaderboard.js`

**Interfaces:**
- Consumes: Task 1 types and `toLeaderboardCharges`, `istMonthKey`, `validateDisplayName`; Task 3 endpoints; existing `createLocalStorageStore` (`./local-storage-store`), `useCharges`/`Charge` (`./use-charges`), `useStoredLocation` (`./use-location`, returns `[Place | null, setter]`), `useLocationPicker`, `useProfile`, `zoneOf`/`ZONE_LABELS` (`../lib/places`), `Modal` (props `title`, `onClose`, `onSubmit?`, `children`), `showToast`, `Icon`, `TopBar`, `BottomNav`, `PageHeader`, `LocationModal`.
- Produces:
  - From `use-leaderboard.ts`: `type Membership = { id: string; key: string; name: string }`; `useLeaderboardMembership(): Membership | null`; `joinLeaderboard(name: string, zone: Zone, charges: Charge[]): Promise<{ ok: true; rank: number } | { ok: false; error: string }>`; `syncLeaderboard(zone: Zone, charges: Charge[]): Promise<void>`; `leaveLeaderboard(): Promise<void>`.
  - From `leaderboard.tsx`: `LeaderboardCard()`, `LeaderboardScreen()`.
  - From `leaderboard-sync.tsx`: `LeaderboardSync()`.

- [ ] **Step 1: Membership store and server calls**

Create `src/app/components/use-leaderboard.ts`:

```ts
"use client";

import { useSyncExternalStore } from "react";
import { createLocalStorageStore } from "./local-storage-store";
import type { Charge } from "./use-charges";
import { istMonthKey, toLeaderboardCharges } from "../lib/leaderboard";
import type { Zone } from "../lib/places";

// This device's leaderboard entry: a public id, the secret key that proves the
// entry is ours (the server keeps only its hash), and the display name.
export type Membership = { id: string; key: string; name: string };

const store = createLocalStorageStore<Membership | null>(
  "zeroemit-leaderboard",
  (raw) => {
    const value = JSON.parse(raw) as Partial<Membership> | null;
    return value && typeof value.id === "string" && typeof value.key === "string" && typeof value.name === "string" ? { id: value.id, key: value.key, name: value.name } : null;
  },
  (value) => JSON.stringify(value),
  null,
);

export function useLeaderboardMembership() {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}

function submit(membership: Membership, zone: Zone, charges: Charge[]) {
  return fetch("/api/leaderboard/member", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...membership, zone, charges: toLeaderboardCharges(charges, istMonthKey(Date.now())) }),
  });
}

export async function joinLeaderboard(name: string, zone: Zone, charges: Charge[]): Promise<{ ok: true; rank: number } | { ok: false; error: string }> {
  const current = store.getSnapshot();
  const membership: Membership = { id: current?.id ?? crypto.randomUUID(), key: current?.key ?? crypto.randomUUID(), name };
  try {
    const response = await submit(membership, zone, charges);
    if (!response.ok) {
      const error = response.status === 400 ? "That name can't be used. Try another one." : response.status === 429 ? "Too many updates. Try again in a while." : "Couldn't join the leaderboard. Try again.";
      return { ok: false, error };
    }
    const body = await response.json() as { rank: number };
    store.write(membership);
    return { ok: true, rank: body.rank };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection." };
  }
}

export async function syncLeaderboard(zone: Zone, charges: Charge[]) {
  const membership = store.getSnapshot();
  if (!membership) return;
  try { await submit(membership, zone, charges); } catch { /* offline: the next change syncs again */ }
}

// Forgets the entry on this device first, so the UI updates at once; if the
// request fails, the entry drops off at the monthly reset.
export async function leaveLeaderboard() {
  const membership = store.getSnapshot();
  if (!membership) return;
  store.write(null);
  try {
    await fetch("/api/leaderboard/member", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: membership.id, key: membership.key }) });
  } catch { /* see above */ }
}
```

- [ ] **Step 2: Layout-mounted sync**

Create `src/app/components/leaderboard-sync.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { zoneOf } from "../lib/places";
import { useCharges } from "./use-charges";
import { useStoredLocation } from "./use-location";
import { syncLeaderboard, useLeaderboardMembership } from "./use-leaderboard";

// While this device is on the leaderboard, re-sends this month's charges when
// they change (or the user's grid region does) so the server can rescore.
// Mounted once in the layout.
export function LeaderboardSync() {
  const joined = useLeaderboardMembership() !== null;
  const [place] = useStoredLocation();
  const { charges } = useCharges();
  const zone = place ? zoneOf(place) : null;

  useEffect(() => {
    if (!joined || !zone) return;
    // Debounced: a burst of changes (e.g. logging a charge) syncs once.
    const timer = setTimeout(() => void syncLeaderboard(zone, charges), 1000);
    return () => clearTimeout(timer);
  }, [joined, zone, charges]);

  return null;
}
```

In `src/app/layout.tsx`, add `import { LeaderboardSync } from "./components/leaderboard-sync";` after the `PushSync` import, and render `<LeaderboardSync />` right after `<PushSync />`.

- [ ] **Step 3: UI module**

Create `src/app/components/leaderboard.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { validateDisplayName, type LeaderboardResponse, type LeaderboardRow, type LeaderboardScope } from "../lib/leaderboard";
import { ZONE_LABELS, zoneOf } from "../lib/places";
import { BottomNav, TopBar } from "./app-shell";
import { Icon } from "./icon-set";
import { LocationModal } from "./location-modal";
import { Modal } from "./modal";
import { PageHeader } from "./page-header";
import { showToast } from "./toast";
import { useCharges } from "./use-charges";
import { useStoredLocation } from "./use-location";
import { useLocationPicker } from "./use-location-picker";
import { useProfile } from "./use-profile";
import { joinLeaderboard, leaveLeaderboard, useLeaderboardMembership } from "./use-leaderboard";

type BoardState = { status: "loading" } | { status: "ready"; data: LeaderboardResponse } | { status: "error" } | { status: "unavailable" };

// Fetches the board for `scope`; `refresh` bumps force a reload (after joining
// or leaving). The result is tagged with its request so a stale response never
// shows under a newer scope.
function useBoard(scope: LeaderboardScope, me: string | null, refresh: number): BoardState {
  const request = `${scope}|${me ?? ""}|${refresh}`;
  const [result, setResult] = useState<{ request: string; state: BoardState } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ scope });
    if (me) query.set("me", me);
    fetch(`/api/leaderboard?${query}`, { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 503) return { status: "unavailable" } as const;
        if (!response.ok) return { status: "error" } as const;
        return { status: "ready", data: await response.json() as LeaderboardResponse } as const;
      })
      .catch(() => ({ status: "error" }) as const)
      .then((state) => { if (!cancelled) setResult({ request, state }); });
    return () => { cancelled = true; };
  }, [scope, me, request]);

  return result?.request === request ? result.state : { status: "loading" };
}

function LeaderboardItem({ row }: { row: LeaderboardRow }) {
  return <li className={row.isMe ? "leaderboard-row leaderboard-me" : "leaderboard-row"}>
    <span className={`leaderboard-rank${row.rank <= 3 ? ` leaderboard-top${row.rank}` : ""}`}>{row.rank}</span>
    <span className="leaderboard-name">
      <strong>{row.name}{row.isMe && " (you)"}</strong>
      <small>{ZONE_LABELS[row.zone]} · {row.co2Kg.toFixed(1)} kg CO₂ avoided</small>
    </span>
    <b className="leaderboard-points">{row.points}<small> pts</small></b>
  </li>;
}

// The top `rows`, plus the user's own row after a gap when it isn't among them.
function LeaderboardList({ rows, me }: { rows: LeaderboardRow[]; me: LeaderboardRow | null }) {
  const showMe = me !== null && !rows.some((row) => row.isMe);
  return <ol className="leaderboard-list">
    {rows.map((row) => <LeaderboardItem key={`${row.rank}-${row.name}`} row={row}/>)}
    {showMe && <li className="leaderboard-gap" aria-hidden="true">…</li>}
    {showMe && <LeaderboardItem row={me}/>}
  </ol>;
}

function BoardBody({ state, limit }: { state: BoardState; limit: number }) {
  if (state.status === "loading") return <p className="personal-note">Loading the leaderboard…</p>;
  if (state.status !== "ready") return <p className="personal-note">Couldn&apos;t load the leaderboard. Check your connection and try again.</p>;
  const { rows, me, total } = state.data;
  if (!rows.length) return <p className="personal-note">Nobody is on the leaderboard yet this month. Join and invite friends who charge an EV.</p>;
  return <>
    {me && <p className="leaderboard-summary">You&apos;re <b>#{me.rank}</b> of {total} this month</p>}
    <LeaderboardList rows={rows.slice(0, limit)} me={me}/>
  </>;
}

function JoinModal({ onClose, onJoined }: { onClose: () => void; onJoined: () => void }) {
  const { profile } = useProfile();
  const { charges } = useCharges();
  const [place] = useStoredLocation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = validateDisplayName(new FormData(event.currentTarget).get("name"));
    if (!name) { setError("Use 2 to 20 letters or numbers, with single spaces."); return; }
    if (!place) return;
    setBusy(true);
    const result = await joinLeaderboard(name, zoneOf(place), charges);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    showToast(`You're #${result.rank} on the leaderboard this month`);
    onJoined();
  }

  return <Modal title="Join the leaderboard" onClose={onClose} onSubmit={submit}>
    <p>Other ZeroEmit users will see your display name, your grid region, and this month&apos;s Eco points and CO₂ avoided. Nothing else leaves this device.</p>
    <label>Display name<input name="name" type="text" defaultValue={profile.name.trim().split(/\s+/)[0] ?? ""} placeholder="e.g. Asha" minLength={2} maxLength={20} autoComplete="nickname" required/></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="primary-button" type="submit" disabled={busy}>{busy ? "Joining…" : "Join"}</button>
  </Modal>;
}

// Rewards page: the user's rank and the top 5 for All India.
export function LeaderboardCard() {
  const membership = useLeaderboardMembership();
  const [joinOpen, setJoinOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const state = useBoard("all", membership?.id ?? null, refresh);
  if (state.status === "unavailable") return null;

  return <section className="card stat-card leaderboard-card">
    <div className="recommendation-head"><h2>Leaderboard</h2><span className="chip">This month</span></div>
    <BoardBody state={state} limit={5}/>
    {!membership && <button className="primary-button" onClick={() => setJoinOpen(true)}>Join the leaderboard</button>}
    <Link className="forecast-button" href="/rewards/leaderboard">See full leaderboard <Icon name="arrow" size={18}/></Link>
    {joinOpen && <JoinModal onClose={() => setJoinOpen(false)} onJoined={() => { setJoinOpen(false); setRefresh((n) => n + 1); }}/>}
  </section>;
}

// /rewards/leaderboard: top 50, All India or the user's region.
export function LeaderboardScreen() {
  const { place, locationOpen, openLocation, closeLocation, chooseLocation } = useLocationPicker();
  const membership = useLeaderboardMembership();
  const zone = place ? zoneOf(place) : null;
  const [regional, setRegional] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const state = useBoard(regional && zone ? zone : "all", membership?.id ?? null, refresh);

  async function leave() {
    await leaveLeaderboard();
    showToast("You've left the leaderboard");
    setRefresh((n) => n + 1);
  }

  return <div className="mobile-app">
    <TopBar onChooseLocation={openLocation}/>
    <main className="dashboard-content">
      <Link className="back-link" href="/rewards"><Icon name="arrow-left" size={18}/> Rewards</Link>
      <PageHeader eyebrow="Leaderboard" title="Cleaner charging, together." intro="Ranked by Eco points earned this month. Resets on the 1st."/>
      {state.status === "unavailable" ? <p className="personal-note">The leaderboard isn&apos;t available right now.</p> : <>
        <div className="segmented" role="tablist" aria-label="Leaderboard area">
          <button role="tab" aria-selected={!regional} className={regional ? "" : "active"} onClick={() => setRegional(false)}>All India</button>
          <button role="tab" aria-selected={regional} className={regional ? "active" : ""} onClick={() => setRegional(true)}>{zone ? ZONE_LABELS[zone] : "My region"}</button>
        </div>
        <section className="card stat-card leaderboard-card"><BoardBody state={state} limit={50}/></section>
        {membership
          ? <button className="forecast-button action-button" onClick={leave}>Leave the leaderboard</button>
          : <button className="primary-button" onClick={() => setJoinOpen(true)}>Join the leaderboard</button>}
        <p className="personal-note">Rankings use Eco points from the charges people log, counting up to 2 charges a day.</p>
      </>}
    </main>
    <BottomNav/>
    {locationOpen && <LocationModal current={place} onClose={closeLocation} onChoose={chooseLocation}/>}
    {joinOpen && <JoinModal onClose={() => setJoinOpen(false)} onJoined={() => { setJoinOpen(false); setRefresh((n) => n + 1); }}/>}
  </div>;
}
```

Create `src/app/rewards/leaderboard/page.tsx`:

```tsx
import { LeaderboardScreen } from "../../components/leaderboard";
export default function LeaderboardPage() { return <LeaderboardScreen />; }
```

(Matches `src/app/rewards/page.tsx`; pages in this app don't set their own `metadata`.)

- [ ] **Step 4: Wire into Rewards and the nav**

In `src/app/components/rewards-screen.tsx`, add `import { LeaderboardCard } from "./leaderboard";` and render `<LeaderboardCard/>` immediately after the `<PageHeader … />` line.

In `src/app/components/app-shell.tsx` line 11, change `className={pathname === href ? "active" : ""}` to:

```tsx
className={pathname === href || (href !== "/" && pathname.startsWith(`${href}/`)) ? "active" : ""}
```

- [ ] **Step 5: Styles**

Append to `src/app/globals.css` (tokens only, so light and dark both work):

```css
.leaderboard-card { display:grid; gap:12px; }.leaderboard-card .forecast-button { margin-top:0; }
.leaderboard-summary { margin:0; color:var(--muted); font-size:14px; }.leaderboard-summary b { color:var(--primary); font-size:18px; }
.leaderboard-list { display:grid; gap:4px; margin:0; padding:0; list-style:none; }
.leaderboard-row { display:grid; grid-template-columns:32px minmax(0,1fr) auto; align-items:center; gap:12px; min-height:56px; padding:8px 12px; border-radius:12px; }
.leaderboard-me { background:var(--accent-soft); }
.leaderboard-rank { display:grid; place-items:center; width:32px; height:32px; border-radius:50%; color:var(--muted); background:var(--variant); font-size:14px; font-weight:700; }
.leaderboard-top1 { color:var(--on-primary); background:var(--primary); }.leaderboard-top2, .leaderboard-top3 { color:var(--primary); background:var(--card); box-shadow:inset 0 0 0 2px var(--primary); }
.leaderboard-name { display:grid; min-width:0; }.leaderboard-name strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:15px; }.leaderboard-name small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--muted); font-size:12px; }
.leaderboard-points { color:var(--primary); font-size:16px; white-space:nowrap; }.leaderboard-points small { color:var(--muted); font-size:12px; font-weight:600; }
.leaderboard-gap { padding:0 12px; color:var(--muted); text-align:center; }
.back-link { display:inline-flex; align-items:center; gap:6px; min-height:44px; color:var(--primary); font-weight:600; text-decoration:none; }
```

- [ ] **Step 6: Type-check, lint, build**

Run: `node node_modules/typescript/bin/tsc --noEmit && npx eslint . && npx next build 2>&1 | grep -E "Compiled|rror"`
Expected: clean; `✓ Compiled successfully`. Restart the server from Task 3 Step 4 (stop the old one first) so it serves the new build.

- [ ] **Step 7: End-to-end check**

Create `<scratchpad>/verify-leaderboard.js` (seeds two other members straight through the API, then drives the UI):

```js
const { chromium, devices } = require("playwright-core");
const OUT = __dirname + "/lb"; require("fs").mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3430";
const problems = [];
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const charge = (kwh, intensity, green) => ({ date: today, kwh, intensity, green });
const seed = (n, name, zone, list) => fetch(`${BASE}/api/leaderboard/member`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, key: `00000000-0000-4000-8000-${String(500 + n).padStart(12, "0")}`, name, zone, charges: list }) }).then((r) => r.json());

(async () => {
  console.log("seed", await seed(1, "Meera", "western", [charge(30, 300, true), charge(30, 300, true)]));   // 30 pts
  console.log("seed", await seed(2, "Karthik", "southern", [charge(20, 600, false)]));                        // 10 pts
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return; sessionStorage.setItem("seeded", "1");
    localStorage.setItem("zeroemit-intro-seen", "1");
    localStorage.setItem("zeroemit-location", JSON.stringify({ name: "Pune", state: "maharashtra" }));
    localStorage.setItem("zeroemit-profile", JSON.stringify({ name: "Suresh Kumar", vehicle: "Tata Nexon EV" }));
    localStorage.setItem("zeroemit-charges", JSON.stringify([{ id: "c1", energyKwh: 22, chargedAt: "12:15", city: "Pune, Maharashtra", carbonIntensity: 410, intensityClass: null, loggedAt: new Date().toISOString() }]));
  });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text().slice(0, 150)); });
  page.on("pageerror", (e) => problems.push(String(e).slice(0, 150)));

  await page.goto(BASE + "/rewards", { waitUntil: "load" });
  await page.waitForSelector(".leaderboard-card .leaderboard-row");
  console.log("card before join:", (await page.locator(".leaderboard-card .leaderboard-name strong").allInnerTexts()).join(", "));
  await page.screenshot({ path: `${OUT}/rewards-before.png`, fullPage: false });

  await page.getByRole("button", { name: "Join the leaderboard" }).click();
  console.log("prefilled name:", await page.locator('input[name="name"]').inputValue());
  await page.locator('input[name="name"]').fill("x");
  await page.getByRole("button", { name: "Join", exact: true }).click();
  console.log("short-name error:", await page.locator(".form-error").innerText());
  await page.locator('input[name="name"]').fill("Suresh");
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await page.waitForSelector(".leaderboard-summary");
  console.log("summary:", await page.locator(".leaderboard-summary").innerText());
  console.log("rows:", (await page.locator(".leaderboard-card .leaderboard-row").allInnerTexts()).map((t) => t.replace(/\s+/g, " ")).join(" | "));
  await page.screenshot({ path: `${OUT}/rewards-joined.png` });

  await page.getByRole("link", { name: /See full leaderboard/ }).click();
  await page.waitForURL("**/rewards/leaderboard"); await page.waitForSelector(".leaderboard-row");
  console.log("rewards tab active on sub-page:", await page.locator(".bottom-nav a.active").innerText());
  await page.getByRole("tab", { name: "Western grid" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".leaderboard-row").length === 2);
  console.log("western rows:", (await page.locator(".leaderboard-name strong").allInnerTexts()).join(", "));
  await page.screenshot({ path: `${OUT}/full-western.png` });

  // Logging a charge resyncs (debounced 1 s) and moves the score.
  await page.evaluate(() => { const list = JSON.parse(localStorage.getItem("zeroemit-charges")); list.unshift({ id: "c2", energyKwh: 18, chargedAt: "13:00", city: "Pune, Maharashtra", carbonIntensity: 380, intensityClass: null, loggedAt: new Date().toISOString() }); localStorage.setItem("zeroemit-charges", JSON.stringify(list)); window.dispatchEvent(new StorageEvent("storage")); });
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: "load" }); await page.waitForSelector(".leaderboard-me");
  console.log("after logging a 2nd green charge:", (await page.locator(".leaderboard-me").innerText()).replace(/\s+/g, " "));

  await page.getByRole("button", { name: "Leave the leaderboard" }).click();
  await page.waitForFunction(() => !document.querySelector(".leaderboard-me"));
  console.log("after leave, stored membership:", await page.evaluate(() => localStorage.getItem("zeroemit-leaderboard")));
  await browser.close();
  console.log("\nPROBLEMS (" + problems.length + "):\n" + problems.join("\n"));
})();
```

Run: `node <scratchpad>/verify-leaderboard.js`
Expected:
- `card before join: Meera, Karthik`
- `prefilled name: Suresh`
- `short-name error: Use 2 to 20 letters or numbers, with single spaces.`
- `summary: You're #2 of 3 this month` and rows `Meera … 30 pts | Suresh (you) … 15 pts | Karthik … 10 pts`
- `rewards tab active on sub-page: Rewards`
- `western rows: Meera, Suresh (you)`
- `after logging a 2nd green charge:` a row showing `30 pts`
- `after leave, stored membership: null`
- `PROBLEMS (0)`

Then open the three screenshots and check: rows don't overflow at 390px, the "(you)" row is highlighted, rank badges 1–3 are distinct.

- [ ] **Step 8: Commit**

```bash
git add src/app/components/use-leaderboard.ts src/app/components/leaderboard-sync.tsx src/app/components/leaderboard.tsx src/app/rewards/leaderboard src/app/layout.tsx src/app/components/rewards-screen.tsx src/app/components/app-shell.tsx src/app/globals.css
git commit -F <message file: "feat: opt-in monthly leaderboard on the Rewards page" + Co-Authored-By line>
```

---

### Task 5: Privacy, leaving from Profile, delete account

**Files:**
- Modify: `src/app/components/profile-screen.tsx` (lines 31, 65–75, 139–141)

**Interfaces:**
- Consumes: `leaveLeaderboard`, `useLeaderboardMembership` from `./use-leaderboard`.
- Produces: nothing new.

- [ ] **Step 1: Privacy copy**

Append to the end of `PRIVACY_TEXT` (inside the string, after "removes that."):

```
 If you join the leaderboard, your display name, grid region and this month's Eco points and CO₂ avoided are visible to other ZeroEmit users; leaving removes them.
```

- [ ] **Step 2: Leave from Privacy, and on delete account**

Add `import { leaveLeaderboard, useLeaderboardMembership } from "./use-leaderboard";`. Inside `ProfileScreen`, add `const leaderboardMember = useLeaderboardMembership();`.

In `deleteAccount()`, add `void leaveLeaderboard();` right after `void removePushSubscription();`.

Replace the info modal body `<p>{infoModal === "about" ? ABOUT_TEXT : PRIVACY_TEXT}</p>` with:

```tsx
      <p>{infoModal === "about" ? ABOUT_TEXT : PRIVACY_TEXT}</p>
      {infoModal === "privacy" && leaderboardMember && <button className="forecast-button action-button" onClick={() => { void leaveLeaderboard(); showToast("You've left the leaderboard"); }}>Leave the leaderboard</button>}
```

Also update the delete-account modal copy: in its `<p>`, change "your profile, location, charge history and notification choices" to "your profile, location, charge history, notification choices and leaderboard entry".

- [ ] **Step 3: Verify**

Extend `<scratchpad>/verify-leaderboard.js` with a second context run (append before `await browser.close();`):

```js
  // Delete account takes the entry off the board.
  await page.goto(BASE + "/rewards", { waitUntil: "load" });
  await page.getByRole("button", { name: "Join the leaderboard" }).click();
  await page.locator('input[name="name"]').fill("Suresh");
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await page.waitForSelector(".leaderboard-summary");
  await page.goto(BASE + "/profile", { waitUntil: "load" });
  await page.getByRole("button", { name: /Privacy/ }).click();
  console.log("privacy mentions leaderboard:", (await page.locator(".modal p").innerText()).includes("leaderboard"), "| leave button:", await page.getByRole("button", { name: "Leave the leaderboard" }).count());
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Delete account/ }).first().click();
  await page.locator(".modal").getByRole("button", { name: /Delete account/ }).click();
  await page.waitForTimeout(1000);
  const board = await (await fetch(`${BASE}/api/leaderboard?scope=all`)).json();
  console.log("after delete account, names on board:", board.rows.map((r) => r.name).join(", "));
```

Run: `node <scratchpad>/verify-leaderboard.js`
Expected additionally: `privacy mentions leaderboard: true | leave button: 1` and `after delete account, names on board: Meera, Karthik`.

- [ ] **Step 4: Commit**

```bash
git add src/app/components/profile-screen.tsx
git commit -F <message file: "feat: leaderboard privacy note, leave from Profile, removal on delete account" + Co-Authored-By line>
```

---

### Task 6: Final verification

**Files:** none changed (fix anything found in the task that owns it, then re-run).

- [ ] **Step 1: Full checks**

Run: `bun test && node node_modules/typescript/bin/tsc --noEmit && npx eslint . && npx next build 2>&1 | grep -E "Compiled|rror"`
Expected: all unit tests pass (Task 1 + Task 2), clean tsc/eslint, successful build.

- [ ] **Step 2: Screenshots across themes and sizes**

With the mock + server running and the two seeded members present, rejoin as "Suresh" and capture `/rewards` and `/rewards/leaderboard` at: 360×740 light, iPhone 13 dark (`colorScheme: "dark"`), and 1280×800 desktop. Check: no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`), no clipped names, the "(you)" highlight and rank badges readable in dark mode, sidebar layout intact on desktop.

- [ ] **Step 3: Not-configured state**

Restart `next start` *without* the `UPSTASH_*` variables and load `/rewards`: the leaderboard card must not appear (the card briefly shows "Loading…" then disappears) and there must be no console errors other than the 503 fetch; `/rewards/leaderboard` shows "The leaderboard isn't available right now."

- [ ] **Step 4: Clean up**

Stop the server and the mock (PowerShell `Stop-Process` on the listeners for ports 3430 and 8790). `git status` must show a clean tree.
