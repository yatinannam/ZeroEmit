import type { Metadata } from "next";
import { StationsScreen } from "../components/stations";

export const metadata: Metadata = { title: "EV chargers" };

export default function StationsPage() { return <StationsScreen />; }
