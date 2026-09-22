"use client";

import Link from "next/link";
import { useState } from "react";
import { bestWindow, formatHour, formatHourParts, relativeDayLabel } from "../lib/grid";
import { useGridData } from "./use-grid-data";
import { useCharges } from "./use-charges";
import { useStoredLocation } from "./use-location";
import { currentStreakDays, totalPoints } from "../lib/rewards";
import { averageChargeIntensity, formatTimeOfDay, typicalChargeTime } from "../lib/personalization";
import { Icon } from "./icon-set";
import { BottomNav, TopBar } from "./app-shell";
import { LocationModal } from "./location-modal";

export function Dashboard() {
  const [location, setLocation] = useStoredLocation();
  const [locationOpen, setLocationOpen] = useState(false);
  const { data, loading, error, refresh } = useGridData(location);
  const { charges } = useCharges();
  const energyLogged = charges.reduce((total, charge) => total + charge.energyKwh, 0);
  const points = totalPoints(charges);
  const streak = currentStreakDays(charges);
  const current = data?.available ? data.current : undefined;
  const recommendedWindow = data?.available ? bestWindow(data.forecast, 2) : null;
  // Different cities sit on different regional grids with very different
  // baselines, so "usual" personalization is scoped to the selected city
  // rather than blended across everywhere the user has ever charged.
  const cityCharges = charges.filter((charge) => charge.city === location);
  const avgChargeIntensity = averageChargeIntensity(cityCharges);
  const typicalTime = typicalChargeTime(cityCharges);
  const intensityDiff = current && avgChargeIntensity !== null ? Math.round(current.carbonIntensity - avgChargeIntensity) : null;
  const recommendedStart = recommendedWindow ? formatHourParts(recommendedWindow.start.datetime) : null;
  const recommendedEnd = recommendedWindow ? formatHourParts(recommendedWindow.end.datetime) : null;
  // A typical-pattern window can land almost a full day out — surface that
  // instead of letting a bare time read as "later today" when it isn't.
  const recommendedDay = recommendedWindow ? relativeDayLabel(recommendedWindow.start.datetime) : null;
  return <div className="mobile-app">
    <TopBar onChooseLocation={() => setLocationOpen(true)}/>
    <main className="dashboard-content">
      <section className="greeting"><button className="location-label location-button" onClick={() => setLocationOpen(true)}><Icon name="pin" size={16}/> {location}</button><h1>Good morning</h1></section>
      <section className="recommendation card"><div className="recommendation-head"><h2>Best time to charge</h2>{recommendedWindow && <span className="recommended"><Icon name="bolt" size={15}/> {data?.forecastIsTypical ? "Typical pattern" : "Recommended"}{recommendedDay && recommendedDay !== "Today" ? ` · ${recommendedDay}` : ""}</span>}</div><div className="time-range">{loading ? <strong className="loading-value">Loading...</strong> : recommendedStart && recommendedEnd ? <><strong>{recommendedStart.time}<b>{recommendedStart.period}</b></strong><span>–</span><strong>{recommendedEnd.time}<b>{recommendedEnd.period}</b></strong></> : <strong className="unavailable-value">Unavailable</strong>}</div><div className="intensity"><span className="co2">CO₂</span> Current Intensity: <strong>{current ? `${Math.round(current.carbonIntensity)} gCO₂/kWh` : "Unavailable"}</strong></div>{intensityDiff !== null && (intensityDiff === 0 ? <p className="personal-note">About the same as your usual charging window</p> : <p className="personal-note">{Math.abs(intensityDiff)} gCO₂/kWh {intensityDiff < 0 ? "cleaner" : "higher"} than your usual charging window</p>)}<Link className="forecast-button" href="/forecast">View live forecast <Icon name="arrow" size={18}/></Link></section>
      <section className="data-status" role={error ? "alert" : "status"}><span>{error || (current ? `Live data from ${data?.source}${current.isEstimated ? " · estimated" : ""}${data?.updatedAt ? ` · updated ${new Date(data.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}` : "Waiting for live grid data...")}</span><button onClick={refresh} disabled={loading}>{loading ? "Refreshing..." : "Refresh"}</button></section>
      <section className="metrics-grid"><Link href="/log" className="card saved-card"><div><h2>Energy logged</h2><strong>{energyLogged ? energyLogged.toFixed(1) : "—"} <small>{energyLogged ? "kWh" : "No charges yet"}</small></strong></div><span className="metric-icon"><Icon name="tree"/></span></Link><Link href="/rewards" className="card metric"><h2>Eco Points</h2><strong>{points || "—"}</strong></Link><Link href="/forecast" className="card metric"><h2>Renewable</h2><strong>—</strong></Link></section>
      <section className="timeline-row"><Link href="/rewards" className="streak-card"><h2>Current Streak</h2><div><strong>{streak || "—"}</strong><span>{streak ? "day streak" : "Start today"}</span></div><Icon name="fire" size={104}/></Link><Link href="/forecast" className="card next-window"><h2>Next Charging Window</h2><div><span className="round-icon"><Icon name="clock" size={18}/></span><p>{recommendedWindow ? <><strong>{recommendedDay && recommendedDay !== "Today" ? `${recommendedDay}, ` : ""}{formatHour(recommendedWindow.start.datetime)} – {formatHour(recommendedWindow.end.datetime)}</strong><span>{Math.round(recommendedWindow.average)} gCO₂/kWh average{data?.forecastIsTypical ? " · typical" : ""}</span></> : typicalTime ? <><strong>Around {formatTimeOfDay(typicalTime)}</strong><span>Based on your charging history</span></> : <><strong>Not available</strong><span>Check back when forecast loads</span></>}</p></div></Link></section>
      <section className="activity"><h2>Recent Activity</h2><Link href="/log" className="card activity-item"><span className="round-icon"><Icon name="bolt" size={19}/></span><div>{charges[0] ? <><strong>{charges[0].energyKwh} kWh logged</strong><span>{charges[0].city} · {charges[0].chargedAt}</span></> : <><strong>No charges logged yet</strong><span>Log your first charge to see your impact.</span></>}</div><b>{charges[0] ? "View history" : "Log charge"}</b></Link></section>
    </main><BottomNav/>
    {locationOpen && <LocationModal current={location} onClose={() => setLocationOpen(false)} onChoose={(next) => { setLocation(next); setLocationOpen(false); }}/>}
  </div>;
}
