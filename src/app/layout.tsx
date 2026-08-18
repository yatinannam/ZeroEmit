import type { Metadata } from "next";
import "./globals.css";
import { PwaRegister } from "./components/pwa-register";

export const metadata: Metadata = {
  title: "ZeroEmit — Charge cleaner",
  description: "Plan your EV charging around a cleaner grid.",
  applicationName: "ZeroEmit",
  manifest: "/manifest.webmanifest",
  themeColor: "#f1fdec",
  icons: { icon: "/icons/zeroemit.svg", apple: "/icons/zeroemit.svg" },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "ZeroEmit" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="en"><body><PwaRegister />{children}</body></html>;
}
