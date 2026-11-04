import type { Metadata } from "next";
import { PlannerScreen } from "../../components/planner-screen";

export const metadata: Metadata = { title: "Charge planner" };

export default function PlanPage() { return <PlannerScreen/>; }
