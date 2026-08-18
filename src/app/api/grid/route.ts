import { NextRequest, NextResponse } from "next/server";
import { CITIES, City } from "../../lib/grid";

const ATLAS_URL = "https://api.energymap.in/developer/v1";
const ELECTRICITY_MAPS_URL = "https://api.electricitymaps.com/v4";

function unavailable(city: City, error: string, status = 503) {
  return NextResponse.json({ available: false, city, forecast: [], source: "Live grid provider", error }, { status });
}

export async function GET(request: NextRequest) {
  const city = request.nextUrl.searchParams.get("city") as City | null;
  const coordinates = city ? CITIES[city] : undefined;
  if (!city || !coordinates) return NextResponse.json({ available: false, error: "Unsupported location", forecast: [] }, { status: 400 });
  const atlasKey = process.env.INDIA_ENERGY_ATLAS_API_KEY;
  const electricityMapsKey = process.env.ELECTRICITY_MAPS_API_KEY;
  if (!atlasKey && !electricityMapsKey) return unavailable(city, "Live grid data is not configured yet.");

  try {
    if (atlasKey) {
      const headers = { "X-API-Key": atlasKey, accept: "application/json" };
      const [latestResponse, forecastResponse] = await Promise.all([
        fetch(`${ATLAS_URL}/carbon-intensity/latest?state=${coordinates.state}`, { headers, next: { revalidate: 300 } }),
        fetch(`${ATLAS_URL}/forecast/carbon-intensity?state=${coordinates.state}&horizon_h=24`, { headers, next: { revalidate: 900 } }),
      ]);
      if (!latestResponse.ok || !forecastResponse.ok) return unavailable(city, latestResponse.status === 402 || forecastResponse.status === 402 ? "24-hour forecasts require an enabled provider plan." : "Live grid data is temporarily unavailable.", latestResponse.status === 429 || forecastResponse.status === 429 ? 429 : 502);
      const latest = await latestResponse.json();
      const forecastPayload = await forecastResponse.json();
      const rawForecast: unknown = forecastPayload.forecast;
      const forecast = Array.isArray(rawForecast) ? rawForecast.filter((point: unknown): point is { ts: string; intensity_gco2_per_kwh: number } => Boolean(point && typeof point === "object" && "ts" in point && "intensity_gco2_per_kwh" in point)).map((point: { ts: string; intensity_gco2_per_kwh: number }) => ({ datetime: point.ts, carbonIntensity: point.intensity_gco2_per_kwh })) : [];
      return NextResponse.json({ available: true, city, current: { carbonIntensity: latest.intensity_gco2_per_kwh, datetime: latest.as_of, isEstimated: true }, forecast, updatedAt: forecastPayload.as_of || latest.as_of, source: "India Energy Atlas" }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
    }

    const query = `lat=${coordinates.lat}&lon=${coordinates.lon}`;
    const headers = { "auth-token": electricityMapsKey as string, accept: "application/json" };
    const [latestResponse, forecastResponse] = await Promise.all([fetch(`${ELECTRICITY_MAPS_URL}/carbon-intensity/latest?${query}`, { headers, next: { revalidate: 300 } }), fetch(`${ELECTRICITY_MAPS_URL}/carbon-intensity/forecast?${query}`, { headers, next: { revalidate: 900 } })]);
    if (!latestResponse.ok || !forecastResponse.ok) return unavailable(city, "Live grid data is temporarily unavailable.", 502);
    const latest = await latestResponse.json(); const forecastPayload = await forecastResponse.json();
    const forecast = Array.isArray(forecastPayload.forecast) ? forecastPayload.forecast : [];
    return NextResponse.json({ available: true, city, current: { carbonIntensity: latest.carbonIntensity, datetime: latest.datetime, isEstimated: Boolean(latest.isEstimated) }, forecast, updatedAt: forecastPayload.updatedAt || latest.updatedAt, source: "Electricity Maps" }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
  } catch { return unavailable(city, "Could not connect to the live grid service.", 502); }
}
