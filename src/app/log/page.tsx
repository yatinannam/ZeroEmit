import type { Metadata } from "next";
import { LogScreen } from "../components/log-screen";

export const metadata: Metadata = { title: "Charging history" };

// Prerendered, so a tab tap shows it at once; ?quick=1 is read on the device.
export default function LogPage() {
  return <LogScreen/>;
}
