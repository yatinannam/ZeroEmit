"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import gsap from "gsap";
import { formatUpdatedAt, formatWindow, liveReading, planByDay, planNext24, relativeDay, type ChargeWindow } from "../lib/grid";
import { useGridData } from "./use-grid-data";
import { useLocationPicker } from "./use-location-picker";
import { requestNotificationPermission, useNotificationsEnabled } from "./notifications";
import { Icon } from "./icon-set";
import { BottomNav, TopBar } from "./app-shell";
import { LocationModal } from "./location-modal";
import { PageHeader } from "./page-header";
import { ForecastChart } from "./forecast-chart";
import { AddToCalendarButton, addWindowToCalendar } from "./add-to-calendar";
import { reducedMotion } from "./motion";
import { PlanChargeLink } from "./planner-screen";
import { IntensityLevelChip } from "./intensity-level";

// "next": the 24 hours from now, the default — late in the evening "today"
// has almost nothing left, while the next clean window is what matters.
type Day = "next" | "today" | "tomorrow";
const DAYS: { key: Day; label: string }[] = [{ key: "next", label: "Next 24 h" }, { key: "today", label: "Today" }, { key: "tomorrow", label: "Tomorrow" }];
const DAY_PATHS: Record<Day, string> = { next: "/forecast", today: "/forecast?day=today", tomorrow: "/forecast?day=tomorrow" };

export function ForecastScreen() {
  const { place, ready, locationOpen, openLocation, closeLocation, chooseLocation } = useLocationPicker();
  // The day lives in the URL alone: a tab tap back to plain /forecast must
  // show the next 24 hours even though this screen's state survives that navigation.
  const requestedDay = useSearchParams().get("day");
  const day: Day = requestedDay === "tomorrow" || requestedDay === "today" ? requestedDay : "next";
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const notifsOn = useNotificationsEnabled();
  const { data, loading, error, refresh } = useGridData(ready ? place.state : null);
  const plan = day === "next" ? planNext24(data) : planByDay(data)[day];
  // Over the next 24 hours a window can be today or tomorrow: say which.
  const windowLabel = (slot: ChargeWindow) => {
    const prefix = day === "next" && !slot.start.isNow ? relativeDay(Date.parse(slot.start.datetime)) : "";
    return `${prefix ? `${prefix}, ` : ""}${formatWindow(slot)}`;
  };
  const best = plan.windows[0] ?? null;
  const current = liveReading(data);
  const retry = <button type="button" className="text-button" onClick={refresh}>Try again</button>;

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
    window.history.replaceState(null, "", DAY_PATHS[next]);
  }

  async function enableNotifications() {
    const result = await requestNotificationPermission();
    setNotice({ text: result.message, ok: result.granted });
  }

  return <div className="mobile-app">
    <TopBar onChooseLocation={openLocation}/>
    <main className="dashboard-content">
      <PageHeader eyebrow="Carbon forecast" title="Charge when the grid is cleaner." intro="The cleanest times to charge over the next day."/>

      <div className="segmented" role="group" aria-label="Forecast day">
        {DAYS.map(({ key, label }) => <button key={key} aria-pressed={day === key} className={day === key ? "active" : ""} onClick={() => chooseDay(key)}>{label}</button>)}
      </div>

      <section className="card stat-card">
        <div className="recommendation-head">
          <div><h2>Right now</h2>{loading && !data ? <strong className="stat-figure loading-value">…</strong> : current ? <><strong className="stat-figure">{Math.round(current.carbonIntensity)} <small>gCO₂/kWh</small></strong><IntensityLevelChip value={current.carbonIntensity} data={data} place={place} long/></> : <strong className="stat-figure unavailable-value">Unavailable</strong>}</div>
          {data?.available && <span className="recommended">{data.forecastIsTypical ? "Typical pattern" : "Live forecast"}</span>}
        </div>

        {loading && !data ? <div className="chart-skeleton" role="status" aria-label="Loading forecast"/>
          : !data?.available ? <p className="personal-note">{error || "Live forecast data is unavailable right now."} {retry}</p>
          : plan.points.length >= 2 ? <>
            <ForecastChart points={plan.points} highlight={best}/>
            {best && <p className="chip-caption"><span className="chip">Best window</span> {windowLabel(best)}</p>}
            {best && !best.start.isNow && <AddToCalendarButton window={best} place={place}/>}
          </>
          : <p className="personal-note">{day === "today" ? <>Today is nearly over. <button type="button" className="text-button" onClick={() => chooseDay("next")}>See the next 24 hours</button> for the next clean windows.</> : day === "tomorrow" ? "Tomorrow's forecast isn't out yet. Check back later today." : "The forecast isn't available yet. Check back soon."}</p>}
        {/* A failed update keeps the last good forecast on screen; say so. */}
        {error && data?.available && <p className="personal-note" role="status">{error.replace(/\.?$/, ".")} Showing the last forecast loaded. {retry}</p>}
      </section>

      <PlanChargeLink/>

      <section className="activity" ref={windowsRef}>
        <h2>{day === "next" ? "Cleanest windows ahead" : `Top charging windows ${day}`}</h2>
        {plan.windows.length ? <>
          {plan.windows.map((slot, index) => {
            const className = `card activity-item${index === 0 ? " activity-item-best" : ""}`;
            const row = <><span className="round-icon"><Icon name={index === 0 ? "bolt" : "clock"} size={18}/></span><span className="activity-text"><strong>{windowLabel(slot)}</strong><span>{Math.round(slot.average)} gCO₂/kWh average</span></span><b className={index === 0 ? "tag-best" : "tag-good"}>{index === 0 ? "Best" : "Good"}</b></>;
            // Tapping a window adds it to the calendar — except one already
            // under way, which (like the hero's) has nothing left to remind about.
            return slot.start.isNow ? <div key={slot.start.datetime} className={className}>{row}</div>
              : <button key={slot.start.datetime} type="button" className={className} onClick={() => addWindowToCalendar(slot, place)} aria-label={`Add ${windowLabel(slot)} to your calendar, ${Math.round(slot.average)} gCO₂/kWh average${index === 0 ? ", best window" : ""}`}>{row}</button>;
          })}
          {plan.windows.some((slot) => !slot.start.isNow) && <p className="personal-note">Tap a window to add it to your calendar.</p>}
        </> : loading && !data ? [0, 1, 2].map((index) => <div key={index} className="card activity-item skeleton-item" aria-hidden="true"/>)
        : <p className="personal-note">No forecast windows available yet.{data?.available && <> {retry}</>}</p>}
      </section>

      {data?.available && <p className="data-status forecast-source"><span>Grid data from {data.source}{data.updatedAt ? ` · updated ${formatUpdatedAt(data.updatedAt)}` : ""}</span><button onClick={refresh} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></p>}

      {notifsOn ? <p className="success-message" role="status"><Icon name="bell" size={16}/> Notifications are on for this device.</p> : <>
        <section className="card notify-card">
          <span className="round-icon"><Icon name="bell" size={18}/></span>
          <span><strong>Get a heads-up</strong><small>A notification before each clean window, so you don&apos;t have to check.</small></span>
          <button type="button" className="text-button" onClick={enableNotifications}>Turn on</button>
        </section>
        {notice && <p className={notice.ok ? "success-message" : "success-message warning-message"} role="status">{notice.text}</p>}
      </>}
    </main>
    <BottomNav/>
    {locationOpen && <LocationModal current={place} onClose={closeLocation} onChoose={chooseLocation}/>}
  </div>;
}
