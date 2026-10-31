import type { Metadata } from "next";
import { connection } from "next/server";
import { ForecastScreen } from "../components/forecast-screen";

export const metadata: Metadata = { title: "Forecast" };

// Rendered per request, so the day picked in the URL (?day=tomorrow) is
// already in the first HTML.
export default async function ForecastPage() {
  await connection();
  return <ForecastScreen/>;
}
