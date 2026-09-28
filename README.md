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

Charge confirmations, rewards (levels, achievements, streak milestones) and a once-a-day clean-grid alert are sent as in-app toasts plus system notifications, each switchable in Profile → Notifications. They're triggered on the device, so the clean-grid alert only runs while the app is open (in front or in the background); alerts when the app is fully closed need Web Push from a server. The service worker (production builds only) delivers them and opens the relevant page on tap. On iPhone, notifications require adding the app to the Home Screen (iOS 16.4+).

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
