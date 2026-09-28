"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { formatHourParts, formatWindow, IST_TIME_ZONE, planByDay } from "../lib/grid";
import { useGridData } from "./use-grid-data";
import { useCharges } from "./use-charges";
import { useProfile } from "./use-profile";
import { useLocationPicker } from "./use-location-picker";
import { currentStreakDays, estimatedCarbonSavedGrams, totalPoints } from "../lib/rewards";
import { averageChargeIntensity, dayHeading, formatTimeOfDay, typicalChargeTime } from "../lib/personalization";
import { Icon } from "./icon-set";
import { BottomNav, TopBar } from "./app-shell";
import { LocationModal } from "./location-modal";

// The page is prerendered at build time, so the greeting can't be computed
// during render — it would bake in the build machine's hour and mismatch on
// hydration. The `null` server snapshot renders a blank line until the client
// fills in the real time of day.
const noopSubscribe = () => () => {};
function greetingForNow() {
  const hour = new Date().getHours();
  return hour >= 5 && hour < 12 ? "Good morning" : hour >= 12 && hour < 17 ? "Good afternoon" : "Good evening";
}

// Providers stamp the latest reading with the hour it's for, which can be
// slightly ahead of the real clock — never show an "updated" time in the future.
function readingTime(iso: string) {
  return new Date(Math.min(Date.parse(iso), Date.now())).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: IST_TIME_ZONE });
}

function HeroTime({ datetime, isNow }: { datetime: string; isNow?: boolean }) {
  if (isNow) return <strong>Now</strong>;
  const { time, period } = formatHourParts(datetime);
  return <strong>{time}<b>{period}</b></strong>;
}

export function Dashboard() {
  const { location, locationOpen, openLocation, closeLocation, chooseLocation } = useLocationPicker();
  const { data, loading, error, refresh } = useGridData(location);
  const { charges } = useCharges();
  const { profile } = useProfile();
  const greeting = useSyncExternalStore(noopSubscribe, greetingForNow, () => null);
  const firstName = profile.name.trim().split(/\s+/)[0];
  const energyLogged = charges.reduce((total, charge) => total + charge.energyKwh, 0);
  const points = totalPoints(charges);
  const streak = currentStreakDays(charges);
  const savedKg = estimatedCarbonSavedGrams(charges) / 1000;
  const current = data?.available ? data.current : undefined;
  const { today, tomorrow } = planByDay(data);
  const todayBest = today.windows[0] ?? null;
  const tomorrowBest = tomorrow.windows[0] ?? null;
  // Different cities sit on different regional grids with very different
  // baselines, so "usual" personalization is scoped to the selected city
  // rather than blended across everywhere the user has ever charged.
  const cityCharges = charges.filter((charge) => charge.city === location);
  const avgChargeIntensity = averageChargeIntensity(cityCharges);
  const typicalTime = typicalChargeTime(cityCharges);
  const intensityDiff = current && avgChargeIntensity !== null ? Math.round(current.carbonIntensity - avgChargeIntensity) : null;
  const heroPill = todayBest?.start.isNow ? "Charge now" : data?.forecastIsTypical ? "Typical pattern" : "Forecast";

  return <div className="mobile-app">
    <TopBar onChooseLocation={openLocation}/>
    <main className="dashboard-content">
      <section className="greeting"><button className="location-label location-button" onClick={openLocation}><Icon name="pin" size={16}/> {location}</button><h1>{greeting ? `${greeting}${firstName ? `, ${firstName}` : ""}` : " "}</h1></section>

      <section className="recommendation card">
        <div className="recommendation-head"><h2>Best time to charge today</h2>{todayBest && <span className="recommended"><Icon name="bolt" size={15}/> {heroPill}</span>}</div>
        <div className="time-range">{loading && !data ? <strong className="loading-value">Loading…</strong> : todayBest ? <><HeroTime datetime={todayBest.start.datetime} isNow={todayBest.start.isNow}/><span>–</span><HeroTime datetime={todayBest.end.datetime}/></> : <strong className="unavailable-value">Unavailable</strong>}</div>
        {todayBest && <p className="personal-note">{todayBest.start.isNow ? "The grid is cleaner right now than at any other time left today." : `${Math.round(todayBest.average)} gCO₂/kWh on average — the cleanest stretch left today.`}</p>}
        <div className="intensity"><span className="co2">CO₂</span> Right now <strong>{current ? `${Math.round(current.carbonIntensity)} gCO₂/kWh` : "Unavailable"}</strong></div>
        {intensityDiff !== null && <p className="personal-note">{intensityDiff === 0 ? "About the same as your usual charging window" : `${Math.abs(intensityDiff)} gCO₂/kWh ${intensityDiff < 0 ? "cleaner" : "higher"} than your usual charging window`}</p>}
        <Link className="forecast-button" href="/forecast">See full forecast <Icon name="arrow" size={18}/></Link>
      </section>

      <section className="data-status" role={error ? "alert" : "status"}><span>{error || (current ? `Live data from ${data?.source}${current.isEstimated ? " · estimated" : ""}${data?.updatedAt ? ` · updated ${readingTime(data.updatedAt)}` : ""}` : "Waiting for live grid data…")}</span><button onClick={refresh} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></section>

      <section className="metrics-grid">
        <Link href="/log" className="card saved-card"><div><h2>Energy logged</h2><strong>{energyLogged ? energyLogged.toFixed(1) : "—"} <small>{energyLogged ? "kWh" : "No charges yet"}</small></strong></div><span className="metric-icon"><Icon name="tree"/></span></Link>
        <Link href="/rewards" className="card metric"><h2>Eco points</h2><strong>{points || "—"}</strong></Link>
        <Link href="/rewards" className="card metric"><h2>CO₂ avoided</h2><strong>{charges.length ? <>{savedKg.toFixed(1)} <small>kg</small></> : "—"}</strong></Link>
      </section>

      <section className="timeline-row">
        <Link href="/rewards" className="streak-card"><h2>Current streak</h2><div><strong>{streak || "—"}</strong><span>{streak ? `day${streak === 1 ? "" : "s"} in a row` : "Start today"}</span></div><Icon name="fire" size={104}/></Link>
        <Link href="/forecast?day=tomorrow" className="card next-window"><h2>Tomorrow&apos;s best</h2><div><span className="round-icon"><Icon name="clock" size={18}/></span><p>{tomorrowBest ? <><strong>{formatWindow(tomorrowBest)}</strong><span>{Math.round(tomorrowBest.average)} gCO₂/kWh avg{data?.forecastIsTypical ? " · typical" : ""}</span></> : typicalTime ? <><strong>Around {formatTimeOfDay(typicalTime)}</strong><span>Your usual charging time</span></> : <><strong>Not available yet</strong><span>Check back when the forecast loads</span></>}</p></div></Link>
      </section>

      <section className="activity"><h2>Recent activity</h2><Link href="/log" className="card activity-item"><span className="round-icon"><Icon name="bolt" size={19}/></span><div>{charges[0] ? <><strong>{charges[0].energyKwh} kWh logged</strong><span>{dayHeading(charges[0].loggedAt)}, {formatTimeOfDay(charges[0].chargedAt)}{charges[0].city !== location ? ` · ${charges[0].city}` : ""}</span></> : <><strong>No charges logged yet</strong><span>Log your first charge to see your impact.</span></>}</div><b>{charges[0] ? "View history" : "Log charge"}</b></Link></section>
    </main><BottomNav/>
    {locationOpen && <LocationModal current={location} onClose={closeLocation} onChoose={chooseLocation}/>}
  </div>;
}
