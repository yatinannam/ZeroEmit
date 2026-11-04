"use client";

import Link from "next/link";
import { useState } from "react";
import { formatHour, formatHourParts, HOUR_MS, istHourOfDay, liveReading, mergeLiveReading, type ForecastPoint } from "../lib/grid";
import { bedtimeBefore, CHARGERS, chargerKw, dayWord, formatDuration, isNightStart, nextOccurrence, planCharge, type Plan } from "../lib/planner";
import { chargeTiming, hourlyPattern, TIMING_BONUS } from "../lib/timing";
import { averageEnergyKwh } from "../lib/personalization";
import { earnsPoints } from "../lib/rewards";
import { kwhForPercent, parsePercent } from "../lib/vehicles";
import { useProfile } from "./use-profile";
import { chargingWindowIcs, downloadIcs } from "../lib/calendar";
import { placeLabel, ZONE_LABELS, zoneOf } from "../lib/places";
import { useGridData } from "./use-grid-data";
import { useCharges } from "./use-charges";
import { useLocationPicker } from "./use-location-picker";
import { isPlanKwh, usePlannerSettings } from "./use-planner-settings";
import { useMinute } from "./use-minute";
import { Icon } from "./icon-set";
import { BottomNav, TopBar } from "./app-shell";
import { LocationModal } from "./location-modal";
import { PageHeader } from "./page-header";
import { ForecastChart } from "./forecast-chart";
import { showToast } from "./toast";

// Without a usual charge to suggest, a typical top-up for a car.
const FALLBACK_KWH = 10;
const formatKwh = (kwh: number) => String(Math.round(kwh * 10) / 10);

// A clock time with a smaller am/pm, as on the Home hero.
function BigTime({ at, now }: { at: number; now?: boolean }) {
  if (now) return <strong>Now</strong>;
  const { time, period } = formatHourParts(new Date(at).toISOString());
  return <strong>{time}<b>{period}</b></strong>;
}

// "7:00 am tomorrow", "11:30 pm tonight".
function whenLabel(at: number, now: number) {
  const day = dayWord(at, now);
  return `${formatHour(new Date(at).toISOString())}${day ? ` ${day}` : ""}`;
}

// Home and Forecast: the way in.
export function PlanChargeLink() {
  return <Link href="/forecast/plan" className="card activity-item plan-link">
    <span className="round-icon"><Icon name="plug" size={19}/></span>
    <span className="activity-text"><strong>Plan a charge</strong><span>Say when you need the car. ZeroEmit finds the cleanest time to plug in.</span></span>
    <Icon name="chevron-right" size={18}/>
  </Link>;
}

export function PlannerScreen() {
  const { place, ready, location, locationOpen, openLocation, closeLocation, chooseLocation } = useLocationPicker();
  const { data, loading, error, refresh } = useGridData(ready ? place.state : null);
  const { charges } = useCharges();
  const { settings, update } = usePlannerSettings();
  const now = useMinute();
  // What's typed, while it's being typed: a half-typed "1." or an empty box
  // shouldn't snap back to the saved value under the cursor.
  const [kwhDraft, setKwhDraft] = useState<string | null>(null);
  const [timeDraft, setTimeDraft] = useState<string | null>(null);
  const [percentDraft, setPercentDraft] = useState<{ from: string; to: string } | null>(null);
  const { profile } = useProfile();
  // With the EV's battery known (Profile), energy can be asked as a % gain.
  const battery = profile.batteryKwh ?? null;
  const byPercent = battery !== null && settings.byPercent;
  const percentText = percentDraft ?? { from: String(settings.from), to: String(settings.to) };

  const usual = averageEnergyKwh(charges.filter((charge) => charge.city === location));
  const savedKwh = settings.kwh ?? (usual !== null && isPlanKwh(usual) ? Math.round(usual * 10) / 10 : FALLBACK_KWH);
  const kwhText = kwhDraft ?? formatKwh(savedKwh);
  const typedKwh = Number(kwhText);
  const percentKwh = battery !== null ? kwhForPercent(battery, parsePercent(percentText.from) ?? NaN, parsePercent(percentText.to) ?? NaN) : null;
  const kwh = byPercent ? (percentKwh !== null && isPlanKwh(percentKwh) ? percentKwh : null) : kwhText.trim() && isPlanKwh(typedKwh) ? typedKwh : null;
  const percentValid = byPercent && kwh !== null;
  const percentHint = percentKwh === null ? "Enter levels from 0 to 100%, with the wanted level above where the battery is now." : percentKwh < 0.5 ? "That's under 0.5 kWh, too little to plan. Raise the wanted level." : "That's over 150 kWh. Check your EV's battery size in Profile.";
  const kw = chargerKw(settings.charger);
  const readyBy = now ? nextOccurrence(timeDraft ?? settings.readyBy, now) : null;

  // The curve from the hour we're in, with the live reading as "now".
  const points = data?.available && now ? mergeLiveReading({ forecast: data.forecast, current: liveReading(data, now) }, now) : [];
  const plan: Plan | null = kwh !== null && readyBy !== null && points.length ? planCharge({ points, now, kwh, kw, readyBy }) : null;
  // Through the hour after the deadline: the chart's x axis ends where its
  // last point starts, so the charge's last hour needs one more point.
  const chartPoints = readyBy ? points.filter((point) => Date.parse(point.datetime) < readyBy + HOUR_MS) : [];
  const pattern = data?.available ? hourlyPattern(data.forecast) : null;
  // Only a charge that earns points can earn the bonus (lib/rewards.ts).
  const timing = plan?.kind === "plan" && pattern && kwh !== null && earnsPoints({ energyKwh: kwh }) ? chargeTiming(pattern, istHourOfDay(plan.start)) : null;

  function changeKwh(value: string) {
    setKwhDraft(value);
    const parsed = Number(value);
    if (value.trim() && isPlanKwh(parsed)) update({ kwh: parsed });
  }

  // The plan follows what's typed at once; the pair is saved (for next
  // time) once focus leaves both fields with a valid gain.
  function changePercent(field: "from" | "to", value: string) {
    setPercentDraft({ ...percentText, [field]: value });
  }

  function leavePercent() {
    const from = parsePercent(percentText.from);
    const to = parsePercent(percentText.to);
    if (!percentValid || from === null || to === null) return;
    update({ from, to });
    setPercentDraft(null);
  }

  function changeTime(value: string) {
    setTimeDraft(value);
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) update({ readyBy: value });
  }

  function addToCalendar(result: Extract<Plan, { kind: "plan" }>) {
    if (kwh === null || readyBy === null) return;
    const cleaner = result.cleanerPercent ? `, ${result.cleanerPercent}% cleaner than plugging in straight away` : "";
    // A night start is reminded about at bedtime, to set a timer, not to get up.
    const night = isNightStart(result.start);
    const startTime = formatHour(new Date(result.start).toISOString());
    downloadIcs(chargingWindowIcs({
      kind: "plan",
      start: new Date(result.start).toISOString(),
      end: new Date(result.end).toISOString(),
      average: result.average,
      placeLabel: placeLabel(place),
      gridLabel: ZONE_LABELS[zoneOf(place)],
      summary: night ? `EV charger starts at ${startTime}` : "Plug in your EV",
      description: `The cleanest time to add ${formatKwh(kwh)} kWh before ${formatHour(new Date(readyBy).toISOString())} on the ${ZONE_LABELS[zoneOf(place)]}: about ${Math.round(result.average)} gCO₂/kWh on average${cleaner}. Planned with ZeroEmit: https://zero-emit.vercel.app`,
      alarm: night ? `Before bed: plug in and set your EV to start charging at ${startTime}` : "Plug in your EV in 10 minutes",
      alarmMinutesBefore: night ? (result.start - bedtimeBefore(result.start)) / 60_000 : 10,
    }, now), "zeroemit-charge-plan.ics");
    showToast("Calendar event downloaded. Open it to add the reminder.");
  }

  const kwhInvalid = kwh === null;
  const waiting = !now || (loading && !data);

  return <div className="mobile-app">
    <TopBar onChooseLocation={openLocation}/>
    <main className="dashboard-content">
      <Link className="back-link" href="/forecast"><Icon name="arrow-left" size={18}/> Forecast</Link>
      <PageHeader eyebrow="Charge planner" title="Plug in at the cleanest time." intro="Say how much charge you need and when. ZeroEmit picks the cleanest time to start before then."/>

      <div className="planner-layout">
        <section className="card recommendation plan-result" aria-labelledby="plan-result-title">
          <PlanResult plan={plan} waiting={waiting} error={!data?.available ? error || "Grid data is unavailable right now." : ""} retry={refresh} kwh={kwh} kw={kw} now={now} readyBy={readyBy} typical={Boolean(data?.forecastIsTypical)} timing={timing} chartPoints={chartPoints} onCalendar={addToCalendar}/>
        </section>
        <section className="card stat-card planner-form" aria-labelledby="planner-form-title">
          <h2 id="planner-form-title">Your charge</h2>
          <div className="planner-field">
            <label htmlFor={byPercent ? "planner-from" : "planner-kwh"}>Energy to add</label>
            {battery !== null && <div className="segmented" role="group" aria-label="Energy as">
              {([true, false] as const).map((percent) => <button key={String(percent)} type="button" aria-pressed={byPercent === percent} className={byPercent === percent ? "active" : ""} onClick={() => update({ byPercent: percent })}>{percent ? "Battery %" : "kWh"}</button>)}
            </div>}
            {/* What's typed stays until focus leaves both fields: leaving one
                half-done (85 → 80) mustn't snap it back to an older value. */}
            {byPercent ? <div className="form-row planner-percent" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) leavePercent(); }}>
              <span className="input-with-unit"><input id="planner-from" type="number" inputMode="numeric" min="0" max="99" step="1" value={percentText.from} onChange={(event) => changePercent("from", event.target.value)} aria-label="Battery now, %" aria-invalid={kwh === null} aria-describedby="planner-kwh-hint"/><span aria-hidden="true">% now</span></span>
              <span className="input-with-unit"><input type="number" inputMode="numeric" min="1" max="100" step="1" value={percentText.to} onChange={(event) => changePercent("to", event.target.value)} aria-label="Battery wanted, %" aria-invalid={kwh === null} aria-describedby="planner-kwh-hint"/><span aria-hidden="true">% wanted</span></span>
            </div> : <span className="input-with-unit"><input id="planner-kwh" type="number" inputMode="decimal" min="0.5" max="150" step="0.1" value={kwhText} onChange={(event) => changeKwh(event.target.value)} onBlur={() => setKwhDraft(null)} aria-invalid={kwhInvalid} aria-describedby="planner-kwh-hint"/><span aria-hidden="true">kWh</span></span>}
            <small id="planner-kwh-hint" className={kwhInvalid || (byPercent && !percentValid) ? "form-error" : undefined}>{byPercent ? (kwh !== null ? `About ${formatKwh(kwh)} kWh from the grid for your ${battery} kWh battery.` : percentHint) : kwhInvalid ? "Enter between 0.5 and 150 kWh." : usual !== null ? `Your usual charge in ${place.name} is ${formatKwh(usual)} kWh.` : "A small car battery holds about 30 kWh; a scooter about 3."}</small>
          </div>

          <fieldset className="planner-chargers">
            <legend>Charger</legend>
            {CHARGERS.map((charger) => <label key={charger.key} className="charger-option">
              <input type="radio" name="charger" value={charger.key} checked={settings.charger === charger.key} onChange={() => update({ charger: charger.key })}/>
              <strong>{charger.label}</strong>
              <small>{charger.detail}</small>
            </label>)}
          </fieldset>

          <div className="planner-field">
            <label htmlFor="planner-ready-by">Ready by</label>
            <input id="planner-ready-by" type="time" value={timeDraft ?? settings.readyBy} onChange={(event) => changeTime(event.target.value)} onBlur={() => setTimeDraft(null)} aria-describedby="planner-time-hint"/>
            <small id="planner-time-hint">{readyBy ? `Done by ${whenLabel(readyBy, now)}` : now ? "Pick a time." : " "}</small>
          </div>
        </section>
      </div>
      {/* One short line for screen readers as the answer changes, rather than the whole card. */}
      <p className="sr-only" aria-live="polite">{announcement(plan, now)}</p>
      <p className="personal-note planner-footnote">Charging times are estimates at the charger&apos;s full speed; cars slow down near 100%, so leave a little spare time.</p>
    </main>
    <BottomNav/>
    {locationOpen && <LocationModal current={place} onClose={closeLocation} onChoose={chooseLocation}/>}
  </div>;
}

function announcement(plan: Plan | null, now: number) {
  if (plan?.kind === "plan") return plan.startsNow ? "Best time: plug in now." : `Best time: plug in at ${whenLabel(plan.start, now)}${plan.cleanerPercent ? `, ${plan.cleanerPercent}% cleaner than now` : ""}.`;
  if (plan?.kind === "short") return "Not enough time before then. Plug in now.";
  return "";
}

type ResultProps = {
  plan: Plan | null; waiting: boolean; error: string; retry: () => void; kwh: number | null; kw: number; now: number; readyBy: number | null; typical: boolean;
  timing: ReturnType<typeof chargeTiming> | null; chartPoints: ForecastPoint[]; onCalendar: (plan: Extract<Plan, { kind: "plan" }>) => void;
};

function PlanResult({ plan, waiting, error, retry, kwh, kw, now, readyBy, typical, timing, chartPoints, onCalendar }: ResultProps) {
  const title = <h2 id="plan-result-title">Best time to plug in</h2>;
  if (waiting) return <>{title}<div className="time-range"><strong className="loading-value">Loading…</strong></div><div className="chart-skeleton" aria-hidden="true"/></>;
  if (error) return <>{title}<p className="personal-note">{error.replace(/\.?$/, ".")} <button type="button" className="text-button" onClick={retry}>Try again</button></p></>;
  if (!plan || kwh === null || readyBy === null) return <>{title}<p className="personal-note">{kwh === null ? "Enter how much charge you need to see the best time." : "Pick a ready-by time to see the best time."}</p></>;
  if (plan.kind === "no-data") return <>{title}<p className="personal-note">There isn&apos;t enough grid data to plan this charge yet. <button type="button" className="text-button" onClick={retry}>Try again</button></p></>;
  if (plan.kind === "beyond") return <>{title}<p className="personal-note">The forecast doesn&apos;t reach that far yet. Try an earlier ready-by time, or check back later.</p></>;
  if (plan.kind === "short") {
    return <>
      <div className="recommendation-head">{title}<span className="recommended"><Icon name="bolt" size={15}/> Charge now</span></div>
      <div className="time-range"><BigTime at={now} now/></div>
      <p className="plan-summary">Adding {formatKwh(kwh)} kWh takes {formatDuration(plan.durationMs)} at about {kw} kW, but there&apos;s only {formatDuration(plan.availableMs)} until {whenLabel(readyBy, now)}.</p>
      <p className="personal-note">{plan.kwhByDeadline > 0 ? `Plug in now to add about ${formatKwh(plan.kwhByDeadline)} kWh by then.` : "Pick a later ready-by time."}</p>
    </>;
  }

  const bonus = timing && timing !== "other" ? TIMING_BONUS[timing] : 0;
  const night = !plan.startsNow && isNightStart(plan.start);
  const startTime = formatHour(new Date(plan.start).toISOString());
  const startDay = dayWord(plan.start, now);
  const lead = plan.startsNow ? "Plugging in now is the cleanest time before your deadline." : night ? `Plug in before bed and set your car or charger to start at ${startTime}${startDay === "tonight" ? " tonight" : ""}.` : `Plug in at ${whenLabel(plan.start, now)}.`;
  return <>
    <div className="recommendation-head">{title}<span className="recommended"><Icon name="bolt" size={15}/> {plan.startsNow ? "Charge now" : plan.cleanerPercent ? `${plan.cleanerPercent}% cleaner` : "Recommended"}</span></div>
    <div className="time-range"><BigTime at={plan.start} now={plan.startsNow}/><span>–</span><BigTime at={plan.end}/></div>
    <p className="plan-summary">{lead} {formatDuration(plan.durationMs)} at about {kw} kW, done {readyBy - plan.end < 60_000 ? "right on time" : `by ${whenLabel(plan.end, now)}`}.</p>
    {/* What this plan averages next to plugging in straight away, and what that difference saves. */}
    <dl className="plan-stats">
      <div><dt>Planned</dt><dd>{Math.round(plan.average)} <small>g/kWh</small></dd></div>
      <div><dt>If now</dt><dd>{Math.round(plan.nowAverage)} <small>g/kWh</small></dd></div>
      <div><dt>Saved</dt><dd>{plan.savedGrams >= 50 ? <>{(plan.savedGrams / 1000).toFixed(1)} <small>kg CO₂</small></> : "—"}</dd></div>
    </dl>
    {chartPoints.length >= 2 && <ForecastChart points={chartPoints} highlight={null} span={{ start: plan.start, end: plan.end }}/>}
    {bonus > 0 && <p className="chip-caption"><span className="chip">+{bonus} bonus</span> {timing === "best" ? "Starts in one of the day's cleanest windows." : "Starts at a cleaner-than-average hour."} Log the charge afterwards to earn it.</p>}
    {!plan.startsNow && <>
      <button type="button" className="text-button calendar-button" onClick={() => onCalendar(plan)}><Icon name="calendar" size={16}/> Add to calendar</button>
      <p className="personal-note">{night ? "The calendar reminder comes at 9:30 pm, so you can set the timer before bed." : `Or set your car or charger to start at ${startTime}.`}</p>
    </>}
    {typical && <p className="personal-note">Based on your region&apos;s typical day, from the last two weeks of grid data.</p>}
  </>;
}
