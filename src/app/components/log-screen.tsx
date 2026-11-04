"use client";

import Link from "next/link";
import { FormEvent, MouseEvent, useEffect, useEffectEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { DAY_MS, intensityAt, istHourOfDay } from "../lib/grid";
import { chargeTiming, defaultChargeMoment, hourlyPattern, localDate, type ChargeTiming } from "../lib/timing";
import { chargeCost, formatRupees } from "../lib/cost";
import { useProfile } from "./use-profile";
import { baselineFromPattern, chargeOutcome, earnsPoints, MAX_CHARGE_KWH as MAX_KWH, MIN_POINTS_KWH, pointsForCharge } from "../lib/rewards";
import { sendNotification } from "./notifications";
import { showToast } from "./toast";
import { averageEnergyKwh, dayHeading, formatTimeOfDay, typicalChargeTime } from "../lib/personalization";
import { useGridData } from "./use-grid-data";
import { useCharges, type Charge } from "./use-charges";
import { useLocationPicker } from "./use-location-picker";
import { Icon } from "./icon-set";
import { BottomNav, TopBar } from "./app-shell";
import { LocationModal } from "./location-modal";
import { Modal } from "./modal";
import { PageHeader } from "./page-header";
import { kwhForPercent, parsePercent } from "../lib/vehicles";
import { istMonthKey } from "../lib/leaderboard";
import { periodLabel } from "../lib/recap";
import { impactSummary } from "../lib/rewards";

// How far back a charge can be logged: enough to catch up on a missed month,
// while a mistyped year (1999 for 2026) is caught instead of saved.
const MAX_BACKDATE_DAYS = 30;
// The list shows this many charges at first, then more on request.
const PAGE_SIZE = 50;
// What each charge's chip says next to its points: how it was timed.
const TIMING_TAGS: Record<string, string> = { best: "Best", cleaner: "Cleaner", other: "", untimed: "", small: "" };

// `quick`: opened from a notification's "Log a charge" button, so open the
// form straight away, set to right now.
export function LogScreen({ quick = false }: { quick?: boolean }) {
  const router = useRouter();
  const { profile } = useProfile();
  const { place, ready, location: city, locationOpen, openLocation, closeLocation, chooseLocation } = useLocationPicker();
  // `energy` is set only when the form comes back after a location change,
  // so what was typed survives the trip to the location sheet. `mode`: logged
  // as battery % (with the EV's battery size from Profile) or as kWh.
  const [form, setForm] = useState<{ date: string; time: string; today: string; earliest: string; energy?: string; mode: "percent" | "kwh"; from: string; to: string } | null>(null);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [formError, setFormError] = useState("");
  const [selected, setSelected] = useState<Charge | null>(null);
  const grid = useGridData(ready ? place.state : null);
  const { charges, ready: chargesReady, addCharge, removeCharge, restoreCharge } = useCharges();
  // A charge saved before the grid answers would keep no intensity or
  // timing for good (no bonus, no CO₂), so Save waits for it — but only so
  // long: offline, a charge without grid data beats no charge at all.
  const gridPending = grid.loading && !grid.data;
  const [gridWaitOver, setGridWaitOver] = useState(false);
  const savePending = gridPending && !gridWaitOver;
  useEffect(() => {
    if (!form || !gridPending) return;
    const timer = setTimeout(() => setGridWaitOver(true), 8000);
    return () => clearTimeout(timer);
  }, [form, gridPending]);

  // Scoped to the selected city — different cities sit on different grids,
  // so a blended cross-city average wouldn't be a meaningful "usual" here.
  const cityCharges = charges.filter((charge) => charge.city === city);
  const typicalEnergy = averageEnergyKwh(cityCharges);
  const battery = profile.batteryKwh ?? null;
  // The kWh a battery % gain works out to, shown live under the two fields.
  const percentKwh = form && battery ? kwhForPercent(battery, parsePercent(form.from) ?? NaN, parsePercent(form.to) ?? NaN) : null;
  const typicalTime = typicalChargeTime(cityCharges);

  // A section per month (IST, as the recap and leaderboard count them),
  // with the whole month's totals even when only part of it is shown yet.
  const groups: { month: string; items: Charge[] }[] = [];
  for (const charge of charges.slice(0, shown)) {
    const month = istMonthKey(charge.loggedAt);
    const last = groups.at(-1);
    if (last?.month === month) last.items.push(charge); else groups.push({ month, items: [charge] });
  }
  const monthTotals = (month: string) => impactSummary(charges.filter((charge) => istMonthKey(charge.loggedAt) === month));

  function openForm(atNow = false) {
    const now = new Date();
    // Default to the usual charging time on the last day it came round —
    // today once it's passed, otherwise yesterday (the common "log last
    // night's charge" case) — or, with no usual time, to right now.
    const { date, time } = defaultChargeMoment(atNow ? null : typicalTime, now);
    setFormError("");
    setForm({ date, time, today: localDate(now), earliest: localDate(new Date(now.getTime() - MAX_BACKDATE_DAYS * DAY_MS)), mode: battery ? "percent" : "kwh", from: "20", to: "80" });
  }

  // Open once, then drop ?quick=1 so a refresh or Back doesn't reopen it.
  // Waits for a place (`ready`): on first launch the setup screen comes first,
  // and a form opened behind it would trap the keyboard there.
  const openQuickForm = useEffectEvent(() => { openForm(true); router.replace("/log", { scroll: false }); });
  useEffect(() => {
    if (!quick || !ready) return;
    const timer = setTimeout(openQuickForm, 0);
    return () => clearTimeout(timer);
  }, [quick, ready]);

  // The charge is saved under the selected location, so the form shows it.
  // Changing it swaps the form for the location sheet (two dialogs at once
  // would fight over focus and Escape), keeping what was typed so far.
  function changeLocation(event: MouseEvent<HTMLButtonElement>) {
    const fields = event.currentTarget.form;
    if (form && fields) {
      const typed = new FormData(fields);
      setForm({ ...form, date: String(typed.get("date")), time: String(typed.get("time")), energy: typed.get("energy") === null ? form.energy : String(typed.get("energy")) });
    }
    openLocation();
  }

  function submitCharge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savePending) return;
    const data = new FormData(event.currentTarget);
    const byPercent = form?.mode === "percent" && battery !== null;
    const from = byPercent ? parsePercent(form.from) : null;
    const to = byPercent ? parsePercent(form.to) : null;
    if (byPercent && (from === null || to === null || percentKwh === null)) { setFormError("Enter battery levels from 0 to 100%, with the second above the first."); return; }
    const energy = byPercent ? percentKwh! : Number(data.get("energy"));
    const time = String(data.get("time"));
    const when = new Date(`${String(data.get("date"))}T${time}`).getTime();
    if (!Number.isFinite(energy) || energy <= 0 || energy > MAX_KWH) { setFormError(`Enter between 0.1 and ${MAX_KWH} kWh.`); return; }
    if (Number.isNaN(when)) { setFormError("Pick a valid date and time."); return; }
    if (when > Date.now()) { setFormError("That time hasn't happened yet — pick a time in the past."); return; }
    if (when < Date.now() - (MAX_BACKDATE_DAYS + 1) * DAY_MS) { setFormError(`Charges can be logged up to ${MAX_BACKDATE_DAYS} days back.`); return; }
    const intensity = intensityAt(grid.data, when);
    // Timing against the region's typical day; unknown without grid data.
    const pattern = grid.data?.available ? hourlyPattern(grid.data.forecast) : null;
    const timing: ChargeTiming | undefined = pattern?.some((value) => value !== null) ? chargeTiming(pattern, istHourOfDay(when)) : undefined;
    // The region's average that day: what CO₂ avoided is measured against.
    const baseline = baselineFromPattern(pattern);
    const charge = { energyKwh: Math.round(energy * 10) / 10, chargedAt: time, city, carbonIntensity: intensity?.carbonIntensity ?? null, intensityClass: intensity?.intensityClass ?? null, intensitySource: intensity?.source, ...(timing ? { timing } : {}), ...(baseline !== null ? { baselineIntensity: Math.round(baseline) } : {}), ...(byPercent ? { percentFrom: from!, percentTo: to! } : {}), loggedAt: new Date(when).toISOString() };
    const { points, rewards } = chargeOutcome(charges, { ...charge, id: "" });
    // A charge too small to earn points says so instead of "+0 points".
    const counts = earnsPoints(charge);
    const bonus = !counts ? null : timing === "best" ? "+10 for charging in one of the day's best windows" : timing === "cleaner" ? "+5 for a cleaner-than-average hour" : null;
    addCharge(charge);
    setForm(null);
    const saved = counts ? `Charge saved: +${points} points` : `Charge saved. Charges under ${MIN_POINTS_KWH} kWh don't earn points`;
    const day = dayHeading(charge.loggedAt);
    const dayPhrase = day === "Today" || day === "Yesterday" ? day.toLowerCase() : `on ${day}`;
    // Saved without grid data (it timed out or failed), the charge keeps no
    // timing bonus or CO₂ figure for good — say so rather than drop them quietly.
    const noGrid = !grid.data?.available ? " — grid data unavailable, so no timing bonus or CO₂ estimate" : "";
    showToast(rewards.length ? `${saved}${noGrid}. ${rewards[0]}.` : bonus ? `${saved}, including ${bonus}` : `${saved}${noGrid}`);
    void sendNotification("charges", saved, `${charge.energyKwh} kWh ${dayPhrase} at ${formatTimeOfDay(time)}.${bonus ? ` Includes ${bonus}.` : ""}`, "/log");
    if (rewards.length) void sendNotification("rewards", rewards[0], rewards.length > 1 ? `${rewards.slice(1).join(". ")}.` : "Keep charging when the grid is cleaner to earn more.", "/rewards");
  }

  function deleteSelected() {
    if (!selected) return;
    const deleted = selected;
    removeCharge(deleted.id);
    setSelected(null);
    showToast("Charge deleted", { label: "Undo", run: () => restoreCharge(deleted) });
  }

  return <div className="mobile-app">
    <TopBar onChooseLocation={openLocation}/>
    <main className="dashboard-content">
      <PageHeader eyebrow="Charging history" title="Your charging impact." intro="Keep track of every charge and the emissions you avoided."/>

      {charges.length > 0 && <button className="primary-button" onClick={() => openForm()}><Icon name="bolt" size={18}/> Log a charge</button>}

      <section className="activity">
        <h2>All charges</h2>
        {!chargesReady ? [0, 1, 2].map((index) => <div key={index} className="card activity-item skeleton-item" aria-hidden="true"/>) : groups.length ? groups.map((group) => {
          const totals = monthTotals(group.month);
          return <div key={group.month} className="log-group">
            <h3>{group.month.startsWith("1970") ? "Earlier" : periodLabel(group.month)}<small>{totals.count} {totals.count === 1 ? "charge" : "charges"} · {totals.kwh.toFixed(1)} kWh · {totals.co2Kg.toFixed(1)} kg CO₂ avoided</small></h3>
            {group.items.map((charge) => {
              const timing = earnsPoints(charge) ? charge.timing ?? "untimed" : "small";
              return <button key={charge.id} className={`card activity-item log-item log-${timing}`} onClick={() => setSelected(charge)}>
                <span className="round-icon"><Icon name="bolt" size={19}/></span>
                <span className="activity-text"><strong>{charge.energyKwh} kWh{charge.percentTo !== undefined && <small> · {charge.percentFrom}% → {charge.percentTo}%</small>}</strong><span>{dayHeading(charge.loggedAt)}, {formatTimeOfDay(charge.chargedAt)}{charge.city !== city ? ` · ${charge.city}` : ""}</span></span>
                <b>+{pointsForCharge(charge)}{TIMING_TAGS[timing] && <small> {TIMING_TAGS[timing]}</small>}</b>
              </button>;
            })}
          </div>;
        }) : null}
        {charges.length > shown && <button className="forecast-button" onClick={() => setShown((n) => n + PAGE_SIZE)}>Show older charges</button>}
        {chargesReady && !charges.length && <section className="card empty-state"><span className="round-icon"><Icon name="bolt" size={22}/></span><strong>No charges yet</strong><p>Log each charge to earn Eco points and see the CO₂ you avoid.</p><button className="primary-button" onClick={() => openForm()}>Log your first charge</button></section>}
      </section>
    </main>
    <BottomNav/>

    {locationOpen && <LocationModal current={place} onClose={closeLocation} onChoose={chooseLocation}/>}

    {form && !locationOpen && <Modal title="Log a charge" onClose={() => setForm(null)} onSubmit={submitCharge}>
      <div className="form-row">
        <label>Date<input name="date" type="date" defaultValue={form.date} min={form.earliest} max={form.today} required onChange={() => setFormError("")}/></label>
        <label>Time<input name="time" type="time" defaultValue={form.time} required onChange={() => setFormError("")}/></label>
      </div>
      {battery !== null && <div className="segmented" role="radiogroup" aria-label="Log the charge as">
        {(["percent", "kwh"] as const).map((mode) => <button key={mode} type="button" role="radio" aria-checked={form.mode === mode} className={form.mode === mode ? "active" : ""} onClick={() => { setFormError(""); setForm({ ...form, mode }); }}>{mode === "percent" ? "Battery %" : "kWh"}</button>)}
      </div>}
      {form.mode === "percent" && battery !== null ? <>
        <div className="form-row">
          <label>Battery before (%)<input name="from" type="number" inputMode="numeric" min="0" max="99" step="1" value={form.from} required onChange={(event) => { setFormError(""); setForm({ ...form, from: event.target.value }); }}/></label>
          <label>Battery after (%)<input name="to" type="number" inputMode="numeric" min="1" max="100" step="1" value={form.to} required onChange={(event) => { setFormError(""); setForm({ ...form, to: event.target.value }); }}/></label>
        </div>
        <p className="form-hint" aria-live="polite">{percentKwh !== null ? `About ${percentKwh} kWh from the grid for your ${profile.vehicle || "EV"}'s ${battery} kWh battery, with about 10% lost as heat while charging.` : "The battery after charging should be above where it started."}</p>
      </> : <label>Energy added (kWh)<input name="energy" type="number" inputMode="decimal" min="0.1" max={MAX_KWH} step="0.1" defaultValue={form.energy ?? (typicalEnergy ? Math.min(typicalEnergy, MAX_KWH).toFixed(1) : "18")} required onChange={() => setFormError("")}/></label>}
      {battery === null && <p className="form-hint">Prefer battery %? <Link className="text-button" href="/profile">Pick your EV in Profile</Link></p>}
      <p className="form-location">Location: {city} · <button type="button" className="text-button" aria-label={`Change location, ${city}`} onClick={changeLocation}>Change</button></p>
      {formError && <p className="form-error" role="alert">{formError}</p>}
      <button className="primary-button" type="submit" disabled={savePending}>{savePending ? "Getting grid data…" : "Save charge"}</button>
    </Modal>}

    {selected && <Modal title={`${selected.energyKwh} kWh charge`} onClose={() => setSelected(null)}>
      <dl className="detail-list">
        <div><dt>When</dt><dd>{dayHeading(selected.loggedAt)}, {formatTimeOfDay(selected.chargedAt)}</dd></div>
        {selected.percentTo !== undefined && <div><dt>Battery</dt><dd>{selected.percentFrom}% → {selected.percentTo}%</dd></div>}
        <div><dt>Location</dt><dd>{selected.city}</dd></div>
        <div><dt>Grid intensity</dt><dd>{selected.carbonIntensity !== null ? `${Math.round(selected.carbonIntensity)} gCO₂/kWh${selected.intensitySource === "typical" ? " (typical for that hour)" : ""}` : "Not recorded"}</dd></div>
        <div><dt>Points</dt><dd>+{pointsForCharge(selected)}{!earnsPoints(selected) && ` (under ${MIN_POINTS_KWH} kWh)`}</dd></div>
        <div><dt>Est. cost</dt><dd>{formatRupees(chargeCost(selected.energyKwh, profile.pricePerKwh))}</dd></div>
      </dl>
      <button className="forecast-button action-button destructive-button" onClick={deleteSelected}><Icon name="trash" size={18}/> Delete charge</button>
    </Modal>}
  </div>;
}
