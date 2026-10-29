import type { Metadata } from "next";
import { LogScreen } from "../components/log-screen";

export const metadata: Metadata = { title: "Charging history" };

export default async function LogPage({ searchParams }: PageProps<"/log">) {
  const { quick } = await searchParams;
  return <LogScreen quick={quick === "1"}/>;
}
