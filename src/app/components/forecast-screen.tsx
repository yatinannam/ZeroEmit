"use client";

import { useState } from "react";
import { formatHour, relativeDayLabel, topWindows } from "../lib/grid";
import { useGridData } from "./use-grid-data";
import { useLocationPicker } from "./use-location-picker";
import { notificationsEnabled, requestNotificationPermission } from "./notifications";
import { Icon } from "./icon-set";
import { BottomNav, TopBar } from "./app-shell";
import { LocationModal } from "./location-modal";
import { PageHeader } from "./page-header";
import { ForecastChart } from "./forecast-chart";

export function ForecastScreen() {
  const { location, locationOpen, openLocation, closeLocation, chooseLocation } = useLocationPicker();
  const [message, setMessage] = useState("");
  const [notifsOn, setNotifsOn] = useState(() => notificationsEnabled());
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
    const result = await requestNotificationPermission();
    setMessage(result.message);
    setNotifsOn(result.granted);
  }

  return <div className="mobile-app">
    <TopBar onChooseLocation={openLocation}/>
    <main className="dashboard-content">
      <PageHeader eyebrow="Carbon forecast" title="Charge when the grid is cleaner." intro="See the best windows for your next charge over the next 24 hours."/>

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

      {notifsOn ? <p className="success-message" role="status"><Icon name="bell" size={16}/> Notifications are on for this device.</p> : <button className="forecast-button action-button" onClick={enableNotifications}>Enable notifications <Icon name="arrow" size={18}/></button>}
      {!notifsOn && message && <p className="success-message" role="status">{message}</p>}
    </main>
    <BottomNav/>
    {locationOpen && <LocationModal current={location} onClose={closeLocation} onChoose={chooseLocation}/>}
  </div>;
}
