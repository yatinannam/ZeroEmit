import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return { name: "ZeroEmit", short_name: "ZeroEmit", description: "Plan your EV charging around a cleaner grid.", start_url: "/", display: "standalone", background_color: "#f1fdec", theme_color: "#f1fdec", orientation: "portrait", icons: [
    { src: "/icons/zeroemit.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ] };
}
