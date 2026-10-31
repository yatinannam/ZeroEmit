"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import gsap from "gsap";
import { formatWindow, planByDay } from "../lib/grid";
import { useGridData } from "./use-grid-data";
import { useLocationPicker } from "./use-location-picker";
import { requestNotificationPermission, useNotificationsEnabled } from "./notifications";
import { Icon } from "./icon-set";
import { BottomNav, TopBar } from "./app-shell";
import { LocationModal } from "./location-modal";
import { PageHeader } from "./page-header";
import { ForecastChart } from "./forecast-chart";
import { AddToCalendarButton } from "./add-to-calendar";
import { reducedMotion } from "./motion";

type Day = "today" | "tomorrow";
const DAYS: { key: Day; label: string }[] = [{ key: "today", label: "Today" }, { key: "tomorrow", label: "Tomorrow" }];

export function ForecastScreen() {
  const { place, ready, locationOpen, openLocation, closeLocation, chooseLocation } = useLocationPicker();
  // The day lives in the URL alone: a tab tap back to plain /forecast must
  // show Today even though this screen's state survives that navigation.
  const day: Day = useSearchParams().get("day") === "tomorrow" ? "tomorrow" : "today";
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const notifsOn = useNotificationsEnabled();
  const { data, loading, error } = useGridData(ready ? place.state : null);
  const plan = planByDay(data)[day];
  const best = plan.windows[0] ?? null;
  const current = data?.available ? data.current : undefined;

  // Switching day deals the new windows in, one after another.
  const windowsRef = useRef<HTMLElement>(null);
  const switchedDay = useRef(false);
  useLayoutEffect(() => {
    if (!switchedDay.current || !windowsRef.current || reducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.from(".activity-item", { y: 10, opacity: 0, duration: 0.35, ease: "power2.out", stagger: 0.05, clearProps: "transform,opacity" });
    }, windowsRef);
    return () => ctx.revert();
  }, [day]);

  function chooseDay(next: Day) {
    switchedDay.current = true;
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

      <div className="segmented" role="group" aria-label="Forecast day">
        {DAYS.map(({ key, label }) => <button key={key} aria-pressed={day === key} className={day === key ? "active" : ""} onClick={() => chooseDay(key)}>{label}</button>)}
      </div>

      <section className="card stat-card">
        <div className="recommendation-head">
          <div><h2>Right now</h2>{loading && !data ? <strong className="stat-figure loading-value">…</strong> : current ? <strong className="stat-figure">{Math.round(current.carbonIntensity)} <small>gCO₂/kWh</small></strong> : <strong className="stat-figure unavailable-value">Unavailable</strong>}</div>
          {data?.available && <span className="recommended">{data.forecastIsTypical ? "Typical pattern" : "Live forecast"}</span>}
        </div>

        {loading && !data ? <div className="chart-skeleton" role="status" aria-label="Loading forecast"/>
          : !data?.available ? <p className="personal-note">{error || "Live forecast data is unavailable right now."}</p>
          : plan.points.length >= 2 ? <>
            <ForecastChart points={plan.points} highlight={best}/>
            {best && <p className="chip-caption"><span className="chip">Best window</span> {formatWindow(best)}</p>}
            {best && !best.start.isNow && <AddToCalendarButton window={best} place={place}/>}
          </>
          : <p className="personal-note">{day === "today" ? "Today is nearly over — switch to Tomorrow to see the next clean windows." : "Tomorrow's forecast isn't out yet. Check back later today."}</p>}
      </section>

      <section className="activity" ref={windowsRef}>
        <h2>Top charging windows {day === "today" ? "today" : "tomorrow"}</h2>
        {plan.windows.length ? plan.windows.map((slot, index) => (
          <div key={slot.start.datetime} className={`card activity-item${index === 0 ? " activity-item-best" : ""}`}>
            <span className="round-icon"><Icon name={index === 0 ? "bolt" : "clock"} size={18}/></span>
            <div><strong>{formatWindow(slot)}</strong><span>{Math.round(slot.average)} gCO₂/kWh average</span></div>
            <b className={index === 0 ? "tag-best" : "tag-good"}>{index === 0 ? "Best" : "Good"}</b>
          </div>
        )) : loading && !data ? [0, 1, 2].map((index) => <div key={index} className="card activity-item skeleton-item" aria-hidden="true"/>)
        : <p className="personal-note">No forecast windows available yet.</p>}
      </section>

      {notifsOn ? <p className="success-message" role="status"><Icon name="bell" size={16}/> Notifications are on for this device.</p> : <>
        <button className="forecast-button action-button" onClick={enableNotifications}>Enable notifications <Icon name="bell" size={18}/></button>
        {notice && <p className={notice.ok ? "success-message" : "success-message warning-message"} role="status">{notice.text}</p>}
      </>}
    </main>
    <BottomNav/>
    {locationOpen && <LocationModal current={place} onClose={closeLocation} onChoose={chooseLocation}/>}
  </div>;
}
