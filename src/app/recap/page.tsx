import type { Metadata } from "next";
import { RecapScreen } from "../components/recap-screen";

export const metadata: Metadata = { title: "Your recap" };

// ?period=2026-10 (a month) or ?period=2026 (a year); ?from=home closes back to Home.
export default async function RecapPage({ searchParams }: PageProps<"/recap">) {
  const { period, from } = await searchParams;
  return <RecapScreen requested={typeof period === "string" ? period : null} closeTo={from === "home" ? "/" : "/profile"}/>;
}
