# Engagement notifications and install prompt — design

Date: 2026-10-14
Status: approved in chat ("yup go ahead")

## Goal

Make the leaderboard and badges pull people back into the app, make logging a
charge one tap from a reminder, and help users install the PWA (required for
push on iPhone). Builds on the existing server push scheduler
(`src/app/lib/server/push-scheduler.ts`, runs every ~15 min, 07:00–22:00 IST).

## 1. Leaderboard notifications (new switch "Leaderboard updates", default on)

- The device includes its leaderboard **public id** (never the key) in the push
  subscription it already syncs. `null` when not joined.
- Each scheduler run, for subscribers with an id and the switch on, the server
  reads their standing this month: rank, total, points, CO₂, and the name of
  the member directly above.
- **Overtaken:** rank got worse since the last run this month → "Meera passed
  you on the leaderboard. You're now #3 this month." At most one per IST day.
- **Reaching #1** (and at least 2 members): "You're #1 on the leaderboard this
  month." At most once per month.
- **Month-end result:** on the 1st (IST), 09:00–11:59, if they were on last
  month's board: "October's final: you finished #2 of 14, with 61.0 kg CO₂
  avoided." (CO₂ only if known.) Opens `/profile?share=last-month`, which opens
  the share sheet on a new **Last month** period.
- The last seen `{ month, rank }` is stored with the subscription.

## 2. "Log a charge" action on best-time notifications

- Day best-time and night reminders carry an action button "Log a charge".
- The action opens `/log?quick=1`, which opens the log form prefilled with now
  and then drops the query (a refresh doesn't reopen it).
- Where actions aren't supported (iPhone), tapping behaves as today.

## 3. Badge nudge and weekly recap (new switch "Progress and weekly recap", default on)

- The device includes, with the subscription:
  - `badge`: the closest locked badge **when close** — count badges within 2
    steps, CO₂/kWh badges at ≥ 80% — as `{ key, hint }`, the hint being a ready
    sentence like "1 more green charge to unlock Green Regular.";
  - `week`: this IST week's (Mon–Sun) `{ charges, co2Kg, greenPercent }`.
- **Badge nudge:** 18:00–18:59 IST, at most once every 3 days per badge.
  Title "Almost there". Opens `/rewards`.
- **Weekly recap:** Sundays 18:00–19:59 IST if ≥ 1 charge that week: "This
  week: 4 charges, 3.2 kg CO₂ avoided, 75% green." Opens `/profile`. On a run
  that sends the recap, no badge nudge is sent.

## 4. Install prompt

- A dismissible card on Home:
  - Chromium (`beforeinstallprompt` fired): "Install ZeroEmit" with an Install
    button calling `prompt()`.
  - iPhone/iPad Safari, not installed: instructions "Tap Share, then Add to Home
    Screen — needed for notifications on iPhone".
- Hidden when running installed (`display-mode: standalone` or
  `navigator.standalone`), after `appinstalled`, or for 14 days after "Not now".

## Validation and limits (server)

- `leaderboardId`: UUID or null. `badge.key`: one of the 8 badge keys;
  `badge.hint`: 1–140 chars. `week.charges`: integer 0–1000; `week.co2Kg`:
  0–100000; `week.greenPercent`: integer 0–100. Missing new prefs default to on.
- Push text from `badge.hint` is only ever sent back to the device that sent it.

## Testing

- Unit (bun): badge hint and week summary; subscription parsing; the
  scheduler's planning for every new notification (timing windows, once-per
  rules, overtake detection, #1, month-end); member standing from Redis.
- Browser: `/log?quick=1` opens the prefilled form; `/profile?share=last-month`
  opens the Last month card; the install card on Chromium (synthetic
  `beforeinstallprompt`) and iPhone, and its dismissal.
- Live: one real push to a subscribed device after deploy is the user's check.
