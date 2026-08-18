"use client";

import Link from "next/link";
import { useState } from "react";
import { bestWindow, formatHour, type City } from "../lib/grid";
import { useGridData } from "./use-grid-data";
import { useCharges } from "./use-charges";

type IconName = "pin" | "user" | "bolt" | "arrow" | "tree" | "fire" | "clock" | "home" | "chart" | "history" | "award";
function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const paths: Record<IconName, React.ReactNode> = {
    pin: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>, user: <><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></>, bolt: <path d="m13 2-8 11h6l-1 9 8-11h-6l1-9Z"/>, arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>, tree: <><path d="M12 21V10"/><path d="m7 14 5-4 5 4"/><path d="m8 9 4-4 4 4"/><path d="M5 21h14"/></>, fire: <path d="M12 22c4.4 0 7-3 7-7 0-3.5-2.1-6.2-5-9 .1 2.1-1 3.4-2.2 4.3C11.8 7.5 10.6 5.7 11 3 7.8 5.2 5 9.2 5 14c0 4.5 2.8 8 7 8Z"/>, clock: <><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></>, home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10Z"/><path d="M9 21v-6h6v6"/></>, chart: <><path d="M4 19V5M4 19h17M7 15l4-4 3 2 5-6"/></>, history: <><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5M12 7v5l3 2"/></>, award: <><circle cx="12" cy="8" r="5"/><path d="m9 13-1 8 4-2 4 2-1-8"/></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function BottomNav() {
  const items: [string, IconName, string][] = [["/", "home", "Home"], ["/forecast", "chart", "Forecast"], ["/log", "history", "Log"], ["/rewards", "award", "Rewards"], ["/profile", "user", "Profile"]];
  return <nav className="bottom-nav" aria-label="Primary navigation">{items.map(([href, icon, label]) => <Link key={href} className={href === "/" ? "active" : ""} href={href}><Icon name={icon}/><span>{label}</span></Link>)}</nav>;
}

export function Dashboard() {
  const [location, setLocation] = useState<City>(() => { const saved = typeof window === "undefined" ? null : window.localStorage.getItem("zeroemit-location"); return saved === "Bengaluru, India" || saved === "Mumbai, India" ? saved : "Chennai, India"; });
  const [locationOpen, setLocationOpen] = useState(false);
  const { data, loading, error, refresh } = useGridData(location);
  const { charges } = useCharges();
  const energyLogged = charges.reduce((total, charge) => total + charge.energyKwh, 0);
  const current = data?.available ? data.current : undefined;
  const recommendedWindow = data?.available ? bestWindow(data.forecast, 2) : null;
  function chooseLocation(next: City) { setLocation(next); globalThis.localStorage.setItem("zeroemit-location", next); setLocationOpen(false); }
  return <div className="mobile-app">
    <header className="top-app-bar"><button aria-label="Choose location" onClick={() => setLocationOpen(true)}><Icon name="pin"/></button><strong>ZeroEmit</strong><Link aria-label="Profile" href="/profile"><Icon name="user"/></Link></header>
    <main className="dashboard-content">
      <section className="greeting"><button className="location-label location-button" onClick={() => setLocationOpen(true)}><Icon name="pin" size={16}/> {location}</button><h1>Good morning</h1></section>
      <section className="recommendation card"><div className="recommendation-head"><h2>Best time to charge</h2>{recommendedWindow && <span className="recommended"><Icon name="bolt" size={15}/> Recommended</span>}</div><div className="time-range">{loading ? <strong className="loading-value">Loading...</strong> : recommendedWindow ? <><strong>{formatHour(recommendedWindow.start.datetime)}</strong><span>–</span><strong>{formatHour(recommendedWindow.end.datetime)}</strong></> : <strong className="unavailable-value">Unavailable</strong>}</div><div className="intensity"><span className="co2">CO₂</span> Current Intensity: <strong>{current ? `${Math.round(current.carbonIntensity)} gCO₂/kWh` : "Unavailable"}</strong></div><Link className="forecast-button" href="/forecast">View live forecast <Icon name="arrow" size={18}/></Link></section>
      <section className="data-status" role={error ? "alert" : "status"}><span>{error || (current ? `Live data from ${data?.source}${current.isEstimated ? " · estimated" : ""}${data?.updatedAt ? ` · updated ${new Date(data.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}` : "Waiting for live grid data...")}</span><button onClick={refresh} disabled={loading}>{loading ? "Refreshing..." : "Refresh"}</button></section>
      <section className="metrics-grid"><Link href="/log" className="card saved-card"><div><h2>Energy logged</h2><strong>{energyLogged ? energyLogged.toFixed(1) : "—"} <small>{energyLogged ? "kWh" : "No charges yet"}</small></strong></div><span className="metric-icon"><Icon name="tree"/></span></Link><Link href="/rewards" className="card metric"><h2>Eco Points</h2><strong>—</strong></Link><Link href="/forecast" className="card metric"><h2>Renewable</h2><strong>—</strong></Link></section>
      <section className="timeline-row"><Link href="/rewards" className="streak-card"><h2>Current Streak</h2><div><strong>—</strong><span>Start today</span></div><Icon name="fire" size={104}/></Link><Link href="/forecast" className="card next-window"><h2>Next Charging Window</h2><div><span className="round-icon"><Icon name="clock" size={18}/></span><p>{recommendedWindow ? <><strong>{formatHour(recommendedWindow.start.datetime)} – {formatHour(recommendedWindow.end.datetime)}</strong><span>{Math.round(recommendedWindow.average)} gCO₂/kWh average</span></> : <><strong>Not available</strong><span>Check back when forecast loads</span></>}</p></div></Link></section>
      <section className="activity"><h2>Recent Activity</h2><Link href="/log" className="card activity-item"><span className="round-icon"><Icon name="bolt" size={19}/></span><div>{charges[0] ? <><strong>{charges[0].energyKwh} kWh logged</strong><span>{charges[0].city} · {charges[0].chargedAt}</span></> : <><strong>No charges logged yet</strong><span>Log your first charge to see your impact.</span></>}</div><b>{charges[0] ? "View history" : "Log charge"}</b></Link></section>
    </main><BottomNav/>
    {locationOpen && <div className="modal-backdrop" role="presentation" onClick={() => setLocationOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="location-title" onClick={(event) => event.stopPropagation()}><div className="modal-head"><h2 id="location-title">Choose your location</h2><button className="modal-close" aria-label="Close" onClick={() => setLocationOpen(false)}>×</button></div><p>Grid forecasts are tailored to your selected city.</p><div className="location-options">{(["Chennai, India", "Bengaluru, India", "Mumbai, India"] as City[]).map((city) => <button key={city} className={city === location ? "selected" : ""} onClick={() => chooseLocation(city)}>{city}<span>{city === location ? "Selected" : "Select"}</span></button>)}</div></section></div>}
  </div>;
}
