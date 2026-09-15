# ZeroEmit

ZeroEmit is a mobile-first Next.js PWA that recommends lower-carbon EV charging windows using live Indian grid data.

## Run locally

```bash
bun install
cp .env.example .env.local
bun dev
```

Add `INDIA_ENERGY_ATLAS_API_KEY` to `.env.local` for state-level live intensity and 24-hour forecasts. The key is used only by the server route at `/api/grid`; it is never sent to the browser. The provider requires a plan that includes state forecasts. `ELECTRICITY_MAPS_API_KEY` is an optional, lower-precision regional fallback.

Without a configured provider, the app deliberately shows “Live data unavailable” instead of displaying fabricated values.

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
