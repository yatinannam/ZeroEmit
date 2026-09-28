# ZeroEmit

ZeroEmit is a mobile-first Next.js PWA that recommends lower-carbon EV charging windows using live Indian grid data.

## Run locally

```bash
bun install
cp .env.example .env.local
bun dev
```

Add `INDIA_ENERGY_ATLAS_API_KEY` to `.env.local` for live grid data. The key is used only by the server route at `/api/grid`; it is never sent to the browser.

- **Locations** cover every mainland Indian state/UT (`src/app/lib/places.ts`: ~250 searchable cities with common aliases, each state mapped to one of India's five regional grids). "Use current location" picks the nearest listed city on the device — only the state is ever sent to `/api/grid?state=…`, never coordinates.
- **Current intensity** works on the free Sandbox tier via zone-level data for all five regional grids (Northern, Western, Southern, Eastern, North-Eastern), falling back to the all-India aggregate if a zone lookup fails.
- **24-hour forecasts** (used for "Best time to charge") require the Pro plan or above. On the free tier, the app instead builds a "typical day" pattern per zone from up to 14 days of real historical hourly readings (the same free `by-zone` endpoint, just averaged by hour-of-day in IST) and uses that as the recommended window — labeled "Typical pattern" in the UI so it's never confused with a live forecast. Falls back further to your own charging history if even that isn't available yet.
- `ELECTRICITY_MAPS_API_KEY` is an optional, lower-precision regional fallback (its free tier is limited to one zone per account).

Without a configured provider, the app deliberately shows “Live data unavailable” instead of displaying fabricated values.

## Notifications

Each kind is switchable in Profile → Notifications, and tapping one opens the relevant page. On iPhone, notifications require adding the app to the Home Screen (iOS 16.4+).

- **On the device:** charge confirmations and rewards (levels, achievements, streak milestones), plus in-app toasts.
- **Scheduled, from the server (Web Push), even when the app is closed:** best time to charge (a reminder as today's cleanest window approaches, and at 9 pm for tonight's), a morning digest, and an evening streak reminder. Nothing is sent 10 pm – 7 am IST, and each kind at most once a day. Without push configured, "best time" falls back to an in-app check while the app is open.

### Setting up scheduled notifications

1. **Redis:** in Vercel → the project → Storage (Marketplace) → add **Upstash Redis** and connect it to the project. This sets `KV_REST_API_URL` / `KV_REST_API_TOKEN`.
2. **Environment variables** in Vercel (Production), copied from your local `.env.local` (generate keys with `npx web-push generate-vapid-keys` if you don't have them):
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (your site URL), `CRON_SECRET` (any long random string).
3. **Scheduler:** Vercel's Hobby plan only allows a once-a-day cron (`vercel.json`, used as a backup for the morning digest), so `.github/workflows/push-schedule.yml` calls `/api/push/run` every 15 minutes. Add a repository secret `CRON_SECRET` with the same value (and optionally a repository variable `SITE_URL`).
4. **Redeploy** (the public key is baked in at build time), open the app, turn on notifications, and use **Send a test notification**: with push active it goes through the server, the same path as reminders.

The scheduler refreshes grid data at most hourly per region and not at all overnight, to stay well inside the trial key's 100 calls/day. Note: GitHub pauses scheduled workflows in public repos after 60 days without commits; re-enable it from the Actions tab if that happens.

## Regenerating PWA icons

`public/icons/zeroemit.svg` and `zeroemit-maskable.svg` are the source icons. Running `bun run icons` rasterizes them (via `sharp`) into the PNGs referenced by `app/manifest.ts` and `app/layout.tsx` (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon-180.png`) — a maskable icon is required for Android adaptive icons, and a PNG apple-touch-icon for iOS home-screen installs. Re-run this after editing either source SVG and commit the resulting PNGs.

## Production

```bash
bun run lint
bunx tsc --noEmit
bun run build
bun start
```

Deploy behind HTTPS so the service worker and install prompt work. The PWA stores device-local location and charge entries for now; production multi-device accounts, server persistence, and push reminders require an authenticated data store and notification service.
