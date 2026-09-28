import { ForecastScreen } from "../components/forecast-screen";

export default async function ForecastPage({ searchParams }: PageProps<"/forecast">) {
  const { day } = await searchParams;
  return <ForecastScreen initialDay={day === "tomorrow" ? "tomorrow" : "today"}/>;
}
