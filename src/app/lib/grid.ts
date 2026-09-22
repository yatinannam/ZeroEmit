export type City = "Chennai, India" | "Bengaluru, India" | "Mumbai, India";

export const DEFAULT_CITY: City = "Chennai, India";

// `zone` is India Energy Atlas's regional-grid slug (Southern/Western/...).
// Zone-level "latest" carbon intensity is real, live data available on their
// free Sandbox tier — unlike state-level data, which needs a paid plan.
export const CITIES: Record<City, { state: string; zone: string; lat: number; lon: number }> = {
  "Chennai, India": { state: "tamil-nadu", zone: "southern", lat: 13.0827, lon: 80.2707 },
  "Bengaluru, India": { state: "karnataka", zone: "southern", lat: 12.9716, lon: 77.5946 },
  "Mumbai, India": { state: "maharashtra", zone: "western", lat: 19.076, lon: 72.8777 },
};

export type ForecastPoint = { datetime: string; carbonIntensity: number };
// `forecastIsTypical` marks a forecast built from an average of real
// historical readings per hour-of-day (used when a live forecast isn't
// available, e.g. it needs a paid plan) rather than an actual live forecast.
export type GridData = { available: boolean; city: City; current?: { carbonIntensity: number; datetime: string; isEstimated: boolean; intensityClass?: string }; forecast: ForecastPoint[]; forecastIsTypical?: boolean; updatedAt?: string; source: string; error?: string };

export function bestWindow(forecast: ForecastPoint[], hours = 2) {
  if (forecast.length < hours) return null;
  let best = { start: forecast[0], end: forecast[hours - 1], average: Number.POSITIVE_INFINITY };
  for (let index = 0; index <= forecast.length - hours; index += 1) {
    const window = forecast.slice(index, index + hours);
    const average = window.reduce((sum, point) => sum + point.carbonIntensity, 0) / hours;
    const end = forecast[index + hours] || { ...window[hours - 1], datetime: new Date(new Date(window[hours - 1].datetime).getTime() + 60 * 60 * 1000).toISOString() };
    if (average < best.average) best = { start: window[0], end, average };
  }
  return best;
}

export function formatHour(datetime: string) {
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(new Date(datetime));
}

// Splits out the am/pm so callers can render it smaller than the hour —
// at the hero size the full locale string ("12:16 pm") is wide enough to wrap.
export function formatHourParts(datetime: string) {
  const parts = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).formatToParts(new Date(datetime));
  const time = parts.filter((part) => part.type !== "dayPeriod").map((part) => part.value).join("").trim();
  const period = parts.find((part) => part.type === "dayPeriod")?.value ?? "";
  return { time, period };
}
