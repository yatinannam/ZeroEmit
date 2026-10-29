import type { Metadata } from "next";
import { LeaderboardScreen } from "../../components/leaderboard";

export const metadata: Metadata = { title: "Leaderboard" };

export default function LeaderboardPage() { return <LeaderboardScreen />; }
