import type { Metadata } from "next";
import { RecapPageContent } from "../components/recap-screen";

export const metadata: Metadata = { title: "Your recap" };

// ?period=2026-10 (a month) or ?period=2026 (a year); ?from=home closes back
// to Home. Prerendered; the query is read on the device.
export default function RecapPage() {
  return <RecapPageContent/>;
}
