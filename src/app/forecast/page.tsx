import type { Metadata } from "next";
import { ForecastPageContent } from "../components/forecast-screen";

export const metadata: Metadata = { title: "Forecast" };

// Prerendered: the day picked in the URL (?day=tomorrow) is read on the device.
export default function ForecastPage() {
  return <ForecastPageContent/>;
}
