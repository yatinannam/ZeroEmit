"use client";

import { useState } from "react";
import { formatHour, relativeDayLabel, topWindows } from "../lib/grid";
import { useGridData } from "./use-grid-data";
import { useStoredLocation } from "./use-location";
import { Icon } from "./icon-set";
import { BottomNav, TopBar } from "./app-shell";
import { LocationModal } from "./location-modal";
import { ForecastChart } from "./forecast-chart";

export function ForecastScreen() {
  const [location, setLocation] = useStoredLocation();
  const [locationOpen, setLocationOpen] = useState(false);
  const [message, setMessage] = useState("");
  const { data, loading, error } = useGridData(location);

  const windows = data?.available ? topWindows(data.forecast, 2, 2) : [];
  const current = data?.available ? data.current : undefined;

  // A typical-pattern window can land almost a full day out — a bare time
  // reads as imminent, so a same-day window stays unlabeled and anything
  // further out gets "Tomorrow"/weekday prefixed onto the time range.
  function windowLabel(start: string, end: string) {
    const day = relativeDayLabel(start);
    const range = `${formatHour(start)} – ${formatHour(end)}`;
    return day === "Today" ? range : `${day}, ${range}`;
  }

  async function enableNotifications() {
    if (!("Notification" in window)) { setMessage("This browser does not support notifications."); return; }
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission === "granted") { window.localStorage.setItem("zeroemit-reminder", "true"); setMessage("Notifications allowed on this device. Automatic charge-window alerts aren't available yet — check back here for the best time to charge."); }
    else setMessage("Notifications are blocked. Enable them in your browser settings to receive alerts once available.");
  }

  return <div className="mobile-app">
    <TopBar onChooseLocation={() => setLocationOpen(true)}/>
    <main className="dashboard-content">
      <section className="page-header">
        <p className="eyebrow">Carbon forecast</p>
        <h1>Charge when the grid is cleaner.</h1>
        <p className="secondary-intro">See the best windows for your next charge over the next 24 hours.</p>
      </section>

      <section className="card stat-card">
        <div className="recommendation-head">
          <div><h2>Current</h2>{loading ? <strong className="stat-figure loading-value">…</strong> : current ? <strong className="stat-figure">{Math.round(current.carbonIntensity)} <small>gCO₂/kWh</small></strong> : <strong className="stat-figure unavailable-value">Unavailable</strong>}</div>
          {data?.available && <span className="recommended">{data.forecastIsTypical ? "Typical pattern" : "Live forecast"}</span>}
        </div>

        {data?.available ? <>
          <ForecastChart points={data.forecast} bestStartIndex={windows[0]?.startIndex ?? null} bestLength={2}/>
          {windows[0] && <p className="chip-caption"><span className="chip">Best window</span> {windowLabel(windows[0].start.datetime, windows[0].end.datetime)}</p>}
        </> : <p className="personal-note">{error || "Live forecast data is unavailable right now."}</p>}
      </section>

      <section className="activity">
        <h2>Top charging windows</h2>
        {windows.length ? windows.map((slot, index) => (
          <div key={slot.startIndex} className={`card activity-item${index === 0 ? " activity-item-best" : ""}`}>
            <span className="round-icon"><Icon name={index === 0 ? "bolt" : "clock"} size={18}/></span>
            <div><strong>{windowLabel(slot.start.datetime, slot.end.datetime)}</strong><span>{Math.round(slot.average)} gCO₂/kWh average</span></div>
            <b className={index === 0 ? "tag-best" : "tag-good"}>{index === 0 ? "Best" : "Good"}</b>
          </div>
        )) : <p className="personal-note">No forecast windows available yet.</p>}
      </section>

      <button className="forecast-button action-button" onClick={enableNotifications}>Enable notifications <Icon name="arrow" size={18}/></button>
      {message && <p className="success-message" role="status">{message}</p>}
    </main>
    <BottomNav/>
    {locationOpen && <LocationModal current={location} onClose={() => setLocationOpen(false)} onChoose={(next) => { setLocation(next); setLocationOpen(false); }}/>}
  </div>;
}
