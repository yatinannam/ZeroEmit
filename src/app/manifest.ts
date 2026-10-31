import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  // `id` pins the installed app's identity to "/" even if start_url changes.
  return { id: "/", name: "ZeroEmit", short_name: "ZeroEmit", description: "Plan your EV charging around a cleaner grid.", lang: "en-IN", start_url: "/", display: "standalone", background_color: "#f1fdec", theme_color: "#f1fdec", orientation: "portrait", icons: [
    { src: "/icons/zeroemit.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
  // Long-press the home-screen icon to jump straight in.
  shortcuts: [
    { name: "Log a charge", url: "/log?quick=1", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    { name: "Today's forecast", short_name: "Forecast", url: "/forecast", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
  ] };
}
