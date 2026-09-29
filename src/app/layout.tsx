import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { PwaRegister } from "./components/pwa-register";
import { ToastHost } from "./components/toast";
import { LocationGate } from "./components/location-gate";
import { CleanGridWatcher } from "./components/clean-grid-watcher";
import { PushSync } from "./components/push-sync";
import { ThemeSync } from "./components/theme";
import { THEME_BOOT_SCRIPT } from "./lib/theme-boot";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "ZeroEmit — Charge cleaner",
  description: "Plan your EV charging around a cleaner grid.",
  applicationName: "ZeroEmit",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/zeroemit.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: { url: "/icons/apple-touch-icon-180.png", sizes: "180x180", type: "image/png" },
  },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "ZeroEmit" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1fdec" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1510" },
  ],
  // Without this, iOS Safari ignores env(safe-area-inset-*) entirely (they
  // resolve to 0), so the bottom nav's safe-area padding — already written
  // in globals.css — silently does nothing on notched/home-indicator iPhones.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // suppressHydrationWarning: the inline script may set data-theme on <html>
  // before React hydrates.
  return <html lang="en" className={inter.variable} suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}/></head>
    <body><PwaRegister />{children}<LocationGate /><CleanGridWatcher /><PushSync /><ThemeSync /><ToastHost /></body>
  </html>;
}
