# Leaderboard — design

Date: 2026-10-14
Status: approved in chat, awaiting written-spec review

## Goal

Add a real, opt-in leaderboard to ZeroEmit so users can compare their cleaner-charging
progress with others. It is one of the five panels on the course poster (main UI,
time-slot recommendations, rewards, leaderboard, customer result), so it must work
on the live site and be populated by real users (classmates can join for the demo).

Out of scope here: the fuller Rewards page (more badges) and the poster itself —
separate follow-ups.

## What the user sees

- **Placement:** a Leaderboard card at the top of the Rewards page (no new bottom-nav
  tab). It shows the user's rank, the top 5, and "See full leaderboard", which opens
  `/rewards/leaderboard`.
- **Opt-in:** nobody is listed by default. The card offers "Join the leaderboard" and
  asks for a display name, pre-filled from the profile's first name. Users can leave
  from the leaderboard page or from Profile → Privacy. Delete account also leaves.
- **Ranking:** Eco points earned **this month** (IST calendar month), reset on the 1st.
  Each row: rank, display name, grid region, points, CO₂ avoided this month. The
  user's own row is highlighted.
- **Filter:** "All India" / "My region" (the user's zone, e.g. Western grid).
- **Updates:** the app submits the month's summary on join, and whenever a charge is
  logged or deleted while joined.
- **States:** empty ("You're the first one here — share ZeroEmit"), loading, and
  failed ("Couldn't load the leaderboard"), none of which break the rest of Rewards.
  If the server has no Redis configured, the leaderboard UI is hidden.

## Identity

No accounts. On join, the device generates a random public ID and a random secret
key (both `crypto.randomUUID()`), stored in localStorage. The server stores only a
SHA-256 hash of the key. Updates and leaving require the key, so nobody can overwrite
another user's entry. Clearing app data means joining again as a new entry; the old
one drops off at the monthly reset.

## Storage (Upstash Redis, already provisioned)

- `lb:member:<publicId>` — JSON: `{ name, zone, keyHash, month, points, co2Kg, updatedAt }`.
- `lb:<YYYY-MM>:all` and `lb:<YYYY-MM>:<zone>` — sorted sets, member = publicId,
  score = points (ties broken by earlier `updatedAt` via a fractional score component).
- Month sorted sets expire ~70 days after creation; member records expire 70 days
  after their last update.
- Nothing else: no charge history, city, coordinates or push data.

## Anti-cheat (best effort)

The client never sends a score. It sends this month's charges as
`{ date: "YYYY-MM-DD", kwh: number, intensity: number | null, green: boolean }[]`
(`intensity` is the gCO₂/kWh captured at log time; `green` is the app's
`isGreenCharge` result, which may come from the provider's class), and the server
recomputes:

- points with the app's rules: 10 per charge, +5 if green (shared constants from
  `lib/rewards.ts`); `green` only counts when `intensity` is present;
- CO₂ avoided with the app's estimate (`UNTIMED_CHARGE_BASELINE` − intensity) × kWh,
  floored at 0, skipping charges with no intensity (same logic as
  `estimatedCarbonSavedGrams`);
- limits: at most 2 counted charges per day (the highest-scoring two), kWh clamped
  to the app's per-charge maximum (150), intensity clamped to 0–2000, dates must be
  in the current IST month and not in the future, at most 100 entries per request.

That caps a month at 31 × 2 × 15 = 930 points. Charges are self-reported, so fake logs within
those limits can't be detected; the leaderboard's info text says rankings are based
on self-logged charges.

Other limits: display names 2–20 characters (letters, digits, spaces), trimmed, with
a short block list; at most 30 updates per member per hour (Redis `INCR` + `EXPIRE`).

## API

- `POST /api/leaderboard/member` — body `{ id, key, name, zone, charges }`. Creates
  the member on first call (key hash recorded), otherwise requires a matching key.
  Returns `{ rank, points, co2Kg }`.
- `DELETE /api/leaderboard/member` — body `{ id, key }`. Removes the record and the
  member from all month sets.
- `GET /api/leaderboard?scope=all|northern|western|southern|eastern|north-eastern&me=<publicId>`
  — top 50 `{ rank, name, zone, points, co2Kg, isMe }` plus the requester's own rank
  and row if outside the top 50. Public IDs are not secret; keys never leave the device.

Errors: 400 for invalid input, 403 for a wrong key, 429 for too many updates, 503 if
Redis is not configured.

## Client

- `components/use-leaderboard.ts` — localStorage store `{ id, key, name } | null`,
  `join(name)`, `leave()`, `sync()`; `sync` is called after charges change.
- `components/leaderboard.tsx` — the Rewards card and the full list, sharing row UI.
- `app/rewards/leaderboard/page.tsx` — full page, reusing TopBar/BottomNav/PageHeader.
- Profile: delete account calls `leave()`; Privacy text gains: "If you join the
  leaderboard, your display name, region and this month's points and CO₂ avoided are
  visible to other ZeroEmit users; leaving removes them."

## Testing

- Unit (bun): point/CO₂ recomputation and every limit (per-day cap, kWh clamp,
  out-of-month and future dates, oversized payloads), name validation.
- End-to-end (Playwright + the in-memory mock Upstash server): join, update after a
  logged charge, rank ordering across several members, region filter, leave, delete
  account, wrong key rejected, empty and failed states. Screenshots in light/dark at
  360px, iPhone 13 and desktop.
- `tsc`, `eslint`, `next build` clean.
