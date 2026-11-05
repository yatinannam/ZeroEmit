"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { formatHourParts, formatUpdatedAt, liveReading, planNext24, relativeDay } from "../lib/grid";
import { useGridData } from "./use-grid-data";
import { useCharges } from "./use-charges";
import { useProfile } from "./use-profile";
import { useLocationPicker } from "./use-location-picker";
import { currentStreakDays, estimatedCarbonSavedGrams, totalPoints } from "../lib/rewards";
import { averageChargeIntensity } from "../lib/personalization";
import { chargeTiming, hourlyPattern } from "../lib/timing";
import { istHourOfDay } from "../lib/grid";
import { Icon } from "./icon-set";
import { BottomNav, TopBar } from "./app-shell";
import { LocationModal } from "./location-modal";
import { InstallPrompt } from "./install-prompt";
import { AddToCalendarButton } from "./add-to-calendar";
import { StationsCard } from "./stations";
import { forgetChargerLocation } from "./use-charger-location";
import { CountUp } from "./motion";
import { RecapBanner } from "./recap-banner";
import { IntensityLevelChip } from "./intensity-level";

// The page is prerendered at build time, so the greeting can't be computed
// during render — it would bake in the build machine's hour and mismatch on
// hydration. The `null` server snapshot renders a blank line until the client
// fills in the real time of day.
const noopSubscribe = () => () => {};
function greetingForNow() {
  const hour = new Date().getHours();
  return hour >= 5 && hour < 12 ? "Good morning" : hour >= 12 && hour < 17 ? "Good afternoon" : "Good evening";
}

function HeroTime({ datetime, isNow }: { datetime: string; isNow?: boolean }) {
  if (isNow) return <strong>Now</strong>;
  const { time, period } = formatHourParts(datetime);
  return <strong>{time}<b>{period}</b></strong>;
}

// Home, in four blocks: the next clean window (with what to do about it),
// one strip of progress, logging, and the nearest chargers. Details live on
// their own tabs.
export function Dashboard() {
  const { place, ready, location, locationOpen, openLocation, closeLocation, chooseLocation } = useLocationPicker();
  const { data, loading, error, refresh } = useGridData(ready ? place.state : null);
  const { charges } = useCharges();
  const { profile } = useProfile();
  const greeting = useSyncExternalStore(noopSubscribe, greetingForNow, () => null);
  const firstName = profile.name.trim().split(/\s+/)[0];
  const points = totalPoints(charges);
  const streak = currentStreakDays(charges);
  const savedKg = estimatedCarbonSavedGrams(charges) / 1000;
  const current = liveReading(data);
  // The hero looks 24 hours ahead from now, not just at what's left of
  // today: at 10 pm the useful answer is tomorrow's dip, not 11 pm.
  const nextBest = planNext24(data).windows[0] ?? null;
  const nextDay = nextBest && !nextBest.start.isNow ? relativeDay(Date.parse(nextBest.start.datetime)) : "";
  // Different cities sit on different regional grids with very different
  // baselines, so "usual" personalization is scoped to the selected city
  // rather than blended across everywhere the user has ever charged.
  const avgChargeIntensity = averageChargeIntensity(charges.filter((charge) => charge.city === location));
  const updatedAt = data?.updatedAt ? formatUpdatedAt(data.updatedAt) : "";
  const intensityDiff = current && avgChargeIntensity !== null ? Math.round(current.carbonIntensity - avgChargeIntensity) : null;
  const heroPill = nextBest?.start.isNow ? "Charge now" : nextDay || "Recommended";
  // The live reading can beat the region's usual cleanest hours, but the
  // timing bonus goes by those usual hours: say so rather than imply points.
  const pattern = data?.available ? hourlyPattern(data.forecast) : null;
  const nowEarnsBest = Boolean(pattern && nextBest?.start.isNow && chargeTiming(pattern, istHourOfDay(Date.parse(nextBest.start.datetime))) === "best");
  const heroNote = !nextBest ? "" : nextBest.start.isNow ? `The grid is cleaner right now than at any other time in the next 24 hours.${nowEarnsBest ? "" : " It isn't one of your region's usual cleanest hours, so there's no best-window bonus."}` : `${Math.round(nextBest.average)} gCO₂/kWh on average: the cleanest 2 hours in the next 24${data?.forecastIsTypical ? ", from your region's typical day" : ""}.`;

  return <div className="mobile-app">
    <TopBar onChooseLocation={openLocation}/>
    <main className="dashboard-content">
      <section className="greeting"><button className="location-label location-button" aria-label={ready ? `Change location, ${location}` : "Change location"} onClick={openLocation}><Icon name="pin" size={16}/> {ready ? location : ""}</button><h1>{greeting ? `${greeting}${firstName ? `, ${firstName}` : ""}` : " "}</h1></section>

      <RecapBanner/>

      <section className="recommendation card">
        <div className="recommendation-head"><h2>Next clean window</h2>{nextBest && <span className="recommended"><Icon name="bolt" size={15}/> {heroPill}</span>}</div>
        <div className="time-range">{loading && !data ? <strong className="loading-value">Loading…</strong> : nextBest ? <><HeroTime datetime={nextBest.start.datetime} isNow={nextBest.start.isNow}/><span>–</span><HeroTime datetime={nextBest.end.datetime}/></> : <strong className="unavailable-value">Unavailable</strong>}</div>
        {loading && !data && <div className="hero-skeleton" aria-hidden="true"><span/><span/><span/></div>}
        {heroNote && <p className="personal-note">{heroNote}</p>}
        {nextBest && !nextBest.start.isNow && <AddToCalendarButton window={nextBest} place={place}/>}
        <div className="intensity">Right now <strong>{current ? `${Math.round(current.carbonIntensity)} gCO₂/kWh` : loading && !data ? "Loading…" : "Unavailable"}</strong>{current && <IntensityLevelChip value={current.carbonIntensity} data={data} place={place}/>}</div>
        {intensityDiff !== null && <p className="personal-note">{intensityDiff === 0 ? "About the same as your usual charging window." : `${Math.abs(intensityDiff)} gCO₂/kWh ${intensityDiff < 0 ? "lower" : "higher"} than your usual charging window.`}</p>}
        <div className="hero-actions">
          <Link className="forecast-button" href="/forecast/plan"><Icon name="plug" size={18}/> Plan a charge</Link>
          <Link className="forecast-button" href="/forecast"><Icon name="chart" size={18}/> Forecast</Link>
        </div>
      </section>

      {/* Only when something's wrong: a quiet "updated 10 pm" lives on Forecast. */}
      {error && <section className="data-status" role="alert"><span>{data?.available && updatedAt ? `${error.replace(/\.?$/, ".")} Showing data from ${updatedAt}.` : error}</span><button onClick={refresh} disabled={loading}>{loading ? "Refreshing…" : "Try again"}</button></section>}

      <Link href="/rewards" className="card stat-strip" aria-label={`Rewards: ${points} Eco points, ${savedKg.toFixed(1)} kilograms of CO₂ avoided, ${streak}-day streak`}>
        <span><small>Eco points</small><strong><CountUp value={points}/></strong></span>
        <span><small>CO₂ avoided</small><strong><CountUp value={savedKg} decimals={1}/><em> kg</em></strong></span>
        <span><small>Streak</small><strong><Icon name="fire" size={18}/><CountUp value={streak}/><em> {streak === 1 ? "day" : "days"}</em></strong></span>
      </Link>

      <Link className="primary-button" href="/log?quick=1"><Icon name="bolt" size={18}/> Log a charge</Link>

      <InstallPrompt/>

      <StationsCard place={place} ready={ready}/>
    </main><BottomNav/>
    {/* Picking a city also points the chargers card back at its centre, so
        it doesn't keep showing "Chargers near you" for the old spot. */}
    {locationOpen && <LocationModal current={place} onClose={closeLocation} onChoose={(next) => { chooseLocation(next); forgetChargerLocation(); }}/>}
  </div>;
}
