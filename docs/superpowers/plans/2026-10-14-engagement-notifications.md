# Engagement notifications Implementation Plan

> Executed inline (the human partner chose to proceed immediately and to use subagents where independent). The install prompt (spec section 4) is built in parallel by a subagent in its own worktree and merged afterwards.

**Goal:** Leaderboard, badge and weekly-recap push notifications, a "Log a charge" action on best-time pushes, and a Last month share card.

**Architecture:** The device adds `leaderboardId`, `badge` and `week` to the push subscription it already syncs. The scheduler reads each subscriber's leaderboard standing from Redis and plans the new notifications in its pure `plan` step, storing the last seen rank with the subscription.

**Spec:** `docs/superpowers/specs/2026-10-14-engagement-notifications-design.md`

## Global Constraints

- IST everywhere; scheduler runs only 07:00–21:59 IST.
- No emojis in notification text. "CO₂" with the subscript character.
- New prefs `leaderboard` and `progress` default to on; missing from a request → on.
- Commit with `git commit -F <file>`; type-check with `node node_modules/typescript/bin/tsc --noEmit`.

## Tasks

### Task 1: Device-side summaries (`src/app/lib/rewards.ts`)
- `closestBadge(badges: Achievement[]): { key: string; hint: string } | null` — count badges (first-green, green-10, streak-7, streak-30, peak-dodger) within 2 steps; CO₂/kWh badges at ≥ 80%; picks the one with the highest progress fraction; hint sentences per spec.
- `weekSummary(charges: Charge[], now?: number): { charges: number; co2Kg: number; greenPercent: number }` — this IST week (Monday 00:00 IST onwards).
- Tests first in `src/app/lib/rewards.test.ts`.

### Task 2: Leaderboard standing (`src/app/lib/server/leaderboard.ts`)
- `memberStanding(id: string, month: string): Promise<{ rank: number; total: number; points: number; co2Kg: number | null; above: string | null } | null>` — rank from `lb:<month>:all`; points from the sorted-set score (floored); CO₂ from the member record only when its month matches; `above` = name of rank − 1.
- Tests first in `src/app/lib/server/leaderboard.test.ts`.

### Task 3: Subscription fields (`src/app/lib/server/push.ts`)
- `StoredSubscription` gains `leaderboardId: string | null`, `badge: { key; hint } | null`, `week: { charges; co2Kg; greenPercent } | null`, `lb?: { month: string; rank: number }`; prefs gain `leaderboard`, `progress`; `SentMarkers` gains `overtake`, `top`, `monthEnd`, `weekly`, `badges?: Record<string, string>`.
- `parseSubscriptionBody` validates per spec; `saveSubscription` keeps `sent` and `lb`; `updateSentMarkers` → `updateSubscriptionState(sub, { sent, lb })`.
- Tests first in `src/app/lib/server/push.test.ts`.

### Task 4: Scheduler (`src/app/lib/server/push-scheduler.ts`)
- Export `plan(sub, zonePlan, now, standing?: { current: Standing | null; lastMonth: Standing | null })` returning `{ planned, lb }`.
- Overtake, #1, month-end, badge nudge, weekly recap per spec; best-time/night payloads get `actions: [{ action: "log", title: "Log a charge" }]`.
- `runPushSchedule` loads standings for subscribers with `leaderboardId` and `prefs.leaderboard`, and saves `lb`.
- Tests first in `src/app/lib/server/push-scheduler.test.ts` (planning only).

### Task 5: Client wiring
- `notifications.ts`: kinds `leaderboard` ("Leaderboard updates") and `progress` ("Progress and weekly recap"), server-only, default on.
- `push-client.ts` / `push-sync.tsx`: send `leaderboardId`, `badge`, `week`, new prefs.
- `public/sw.js`: pass `actions`; `notificationclick` with `action === "log"` opens `/log?quick=1`.
- `log-screen.tsx` + `log/page.tsx`: `?quick=1` opens the prefilled form once, then replaces the URL with `/log`.
- `share-card.tsx` + `profile-screen.tsx` + `profile/page.tsx`: Last month period (shown when last month has charges or requested); `?share=last-month` opens the sheet on it.
- Browser check of `/log?quick=1` and `/profile?share=last-month`.

### Task 6: Merge the install prompt branch, full verification, final review
- Merge the subagent's branch; resolve `globals.css` / `dashboard.tsx` conflicts if any.
- `bun test`, tsc, eslint, build; Playwright: install card (synthetic `beforeinstallprompt`, iPhone UA), quick log, last-month share.
- One fresh whole-branch review; fix Critical/Important test-first.
