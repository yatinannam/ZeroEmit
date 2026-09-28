"use client";

import { useState } from "react";
import { formatWindow, planByDay } from "../lib/grid";
import { useGridData } from "./use-grid-data";
import { useLocationPicker } from "./use-location-picker";
import { requestNotificationPermission, useNotificationsEnabled } from "./notifications";
import { Icon } from "./icon-set";
import { BottomNav, TopBar } from "./app-shell";
import { LocationModal } from "./location-modal";
import { PageHeader } from "./page-header";
import { ForecastChart } from "./forecast-chart";

type Day = "today" | "tomorrow";
const DAYS: { key: Day; label: string }[] = [{ key: "today", label: "Today" }, { key: "tomorrow", label: "Tomorrow" }];

export function ForecastScreen({ initialDay }: { initialDay: Day }) {
  const { location, locationOpen, openLocation, closeLocation, chooseLocation } = useLocationPicker();
  const [day, setDay] = useState<Day>(initialDay);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const notifsOn = useNotificationsEnabled();
  const { data, loading, error } = useGridData(location);
  const plan = planByDay(data)[day];
  const best = plan.windows[0] ?? null;
  const current = data?.available ? data.current : undefined;

  function chooseDay(next: Day) {
    setDay(next);
    // Keep the choice in the URL so a reload (or the back button) lands on the same day.
    window.history.replaceState(null, "", next === "tomorrow" ? "/forecast?day=tomorrow" : "/forecast");
  }

  async function enableNotifications() {
    const result = await requestNotificationPermission();
    setNotice({ text: result.message, ok: result.granted });
  }

  return <div className="mobile-app">
    <TopBar onChooseLocation={openLocation}/>
    <main className="dashboard-content">
      <PageHeader eyebrow="Carbon forecast" title="Charge when the grid is cleaner." intro="The cleanest times to charge today and tomorrow."/>

      <div className="segmented" role="tablist" aria-label="Forecast day">
        {DAYS.map(({ key, label }) => <button key={key} role="tab" aria-selected={day === key} className={day === key ? "active" : ""} onClick={() => chooseDay(key)}>{label}</button>)}
      </div>

      <section className="card stat-card">
        <div className="recommendation-head">
          <div><h2>Right now</h2>{loading && !data ? <strong className="stat-figure loading-value">…</strong> : current ? <strong className="stat-figure">{Math.round(current.carbonIntensity)} <small>gCO₂/kWh</small></strong> : <strong className="stat-figure unavailable-value">Unavailable</strong>}</div>
          {data?.available && <span className="recommended">{data.forecastIsTypical ? "Typical pattern" : "Live forecast"}</span>}
        </div>

        {!data?.available ? <p className="personal-note">{loading ? "Loading forecast…" : error || "Live forecast data is unavailable right now."}</p>
          : plan.points.length >= 2 ? <>
            <ForecastChart points={plan.points} highlight={best}/>
            {best && <p className="chip-caption"><span className="chip">Best window</span> {formatWindow(best)}</p>}
          </>
          : <p className="personal-note">Today is nearly over — switch to Tomorrow to see the next clean windows.</p>}
      </section>

      <section className="activity">
        <h2>Top charging windows {day === "today" ? "today" : "tomorrow"}</h2>
        {plan.windows.length ? plan.windows.map((slot, index) => (
          <div key={slot.start.datetime} className={`card activity-item${index === 0 ? " activity-item-best" : ""}`}>
            <span className="round-icon"><Icon name={index === 0 ? "bolt" : "clock"} size={18}/></span>
            <div><strong>{formatWindow(slot)}</strong><span>{Math.round(slot.average)} gCO₂/kWh average</span></div>
            <b className={index === 0 ? "tag-best" : "tag-good"}>{index === 0 ? "Best" : "Good"}</b>
          </div>
        )) : <p className="personal-note">{loading && !data ? "Loading…" : "No forecast windows available yet."}</p>}
      </section>

      {notifsOn ? <p className="success-message" role="status"><Icon name="bell" size={16}/> Notifications are on for this device.</p> : <>
        <button className="forecast-button action-button" onClick={enableNotifications}>Enable notifications <Icon name="bell" size={18}/></button>
        {notice && <p className={notice.ok ? "success-message" : "success-message warning-message"} role="status">{notice.text}</p>}
      </>}
    </main>
    <BottomNav/>
    {locationOpen && <LocationModal current={location} onClose={closeLocation} onChoose={chooseLocation}/>}
  </div>;
}
