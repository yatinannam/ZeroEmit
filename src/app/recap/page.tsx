import type { Metadata } from "next";
import { RecapScreen } from "../components/recap-screen";

export const metadata: Metadata = { title: "Your recap" };

// ?period=2026-10 (a month) or ?period=2026 (a year).
export default async function RecapPage({ searchParams }: PageProps<"/recap">) {
  const { period } = await searchParams;
  return <RecapScreen requested={typeof period === "string" ? period : null}/>;
}
