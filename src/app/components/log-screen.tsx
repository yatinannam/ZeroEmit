"use client";

import { FormEvent, useEffect, useEffectEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { intensityAt, istHourOfDay } from "../lib/grid";
import { chargeTiming, hourlyPattern, type ChargeTiming } from "../lib/timing";
import { chargeOutcome, MAX_CHARGE_KWH as MAX_KWH, pointsForCharge } from "../lib/rewards";
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

const pad = (value: number) => String(value).padStart(2, "0");
const localDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const localTime = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

// `quick`: opened from a notification's "Log a charge" button, so open the
// form straight away, set to right now.
export function LogScreen({ quick = false }: { quick?: boolean }) {
  const router = useRouter();
  const { place, location: city, locationOpen, openLocation, closeLocation, chooseLocation } = useLocationPicker();
  const [form, setForm] = useState<{ date: string; time: string; today: string } | null>(null);
  const [formError, setFormError] = useState("");
  const [selected, setSelected] = useState<Charge | null>(null);
  const grid = useGridData(place.state);
  const { charges, addCharge, removeCharge } = useCharges();

  // Scoped to the selected city — different cities sit on different grids,
  // so a blended cross-city average wouldn't be a meaningful "usual" here.
  const cityCharges = charges.filter((charge) => charge.city === city);
  const typicalEnergy = averageEnergyKwh(cityCharges);
  const typicalTime = typicalChargeTime(cityCharges);

  const groups: { heading: string; items: Charge[] }[] = [];
  for (const charge of charges) {
    const heading = dayHeading(charge.loggedAt);
    const last = groups.at(-1);
    if (last?.heading === heading) last.items.push(charge); else groups.push({ heading, items: [charge] });
  }

  function openForm(atNow = false) {
    const now = new Date();
    // Default to the usual charging time when it's already passed today
    // (the common "log last night's charge" case), otherwise to right now.
    const time = !atNow && typicalTime && typicalTime <= localTime(now) ? typicalTime : localTime(now);
    setFormError("");
    setForm({ date: localDate(now), time, today: localDate(now) });
  }

  // Open once, then drop ?quick=1 so a refresh or Back doesn't reopen it.
  const openQuickForm = useEffectEvent(() => { openForm(true); router.replace("/log", { scroll: false }); });
  useEffect(() => {
    if (!quick) return;
    const timer = setTimeout(openQuickForm, 0);
    return () => clearTimeout(timer);
  }, [quick]);

  function submitCharge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const energy = Number(data.get("energy"));
    const time = String(data.get("time"));
    const when = new Date(`${String(data.get("date"))}T${time}`).getTime();
    if (!Number.isFinite(energy) || energy <= 0 || energy > MAX_KWH) { setFormError(`Enter between 0.1 and ${MAX_KWH} kWh.`); return; }
    if (Number.isNaN(when)) { setFormError("Pick a valid date and time."); return; }
    if (when > Date.now()) { setFormError("That time hasn't happened yet — pick a time in the past."); return; }
    const intensity = intensityAt(grid.data, when);
    // Timing against the region's typical day; unknown without grid data.
    const pattern = grid.data?.available ? hourlyPattern(grid.data.forecast) : null;
    const timing: ChargeTiming | undefined = pattern?.some((value) => value !== null) ? chargeTiming(pattern, istHourOfDay(when)) : undefined;
    const charge = { energyKwh: Math.round(energy * 10) / 10, chargedAt: time, city, carbonIntensity: intensity?.carbonIntensity ?? null, intensityClass: intensity?.intensityClass ?? null, intensitySource: intensity?.source, ...(timing ? { timing } : {}), loggedAt: new Date(when).toISOString() };
    const { points, rewards } = chargeOutcome(charges, { ...charge, id: "" });
    const bonus = timing === "best" ? "+10 for charging in one of the day's best windows" : timing === "cleaner" ? "+5 for a cleaner-than-average hour" : null;
    addCharge(charge);
    setForm(null);
    const saved = `Charge saved: +${points} points`;
    const day = dayHeading(charge.loggedAt);
    const dayPhrase = day === "Today" || day === "Yesterday" ? day.toLowerCase() : `on ${day}`;
    showToast(rewards.length ? `${saved}. ${rewards[0]}.` : bonus ? `${saved}, including ${bonus}` : saved);
    void sendNotification("charges", saved, `${charge.energyKwh} kWh ${dayPhrase} at ${formatTimeOfDay(time)}.${bonus ? ` Includes ${bonus}.` : ""}`, "/log");
    if (rewards.length) void sendNotification("rewards", rewards[0], rewards.length > 1 ? `${rewards.slice(1).join(". ")}.` : "Keep charging when the grid is cleaner to earn more.", "/rewards");
  }

  function deleteSelected() {
    if (!selected) return;
    removeCharge(selected.id);
    setSelected(null);
    showToast("Charge deleted");
  }

  return <div className="mobile-app">
    <TopBar onChooseLocation={openLocation}/>
    <main className="dashboard-content">
      <PageHeader eyebrow="Charging history" title="Your charging impact." intro="Keep track of every charge and the emissions you avoided."/>

      <button className="primary-button" onClick={() => openForm()}><Icon name="bolt" size={18}/> Log a charge</button>

      <section className="activity">
        <h2>All charges</h2>
        {groups.length ? groups.map((group) => <div key={group.heading} className="log-group">
          <h3>{group.heading}</h3>
          {group.items.map((charge) => <button key={charge.id} className="card activity-item" onClick={() => setSelected(charge)}>
            <span className="round-icon"><Icon name="bolt" size={19}/></span>
            <div><strong>{charge.energyKwh} kWh</strong><span>{formatTimeOfDay(charge.chargedAt)}{charge.city !== city ? ` · ${charge.city}` : ""}</span></div>
            <b>+{pointsForCharge(charge)} pts</b>
          </button>)}
        </div>) : <p className="personal-note">No charges logged yet. Log your first charge to see your impact.</p>}
      </section>
    </main>
    <BottomNav/>

    {locationOpen && <LocationModal current={place} onClose={closeLocation} onChoose={chooseLocation}/>}

    {form && <Modal title="Log a charge" onClose={() => setForm(null)} onSubmit={submitCharge}>
      <div className="form-row">
        <label>Date<input name="date" type="date" defaultValue={form.date} max={form.today} required/></label>
        <label>Time<input name="time" type="time" defaultValue={form.time} required/></label>
      </div>
      <label>Energy added (kWh)<input name="energy" type="number" inputMode="decimal" min="0.1" max={MAX_KWH} step="0.1" defaultValue={typicalEnergy ? Math.min(typicalEnergy, MAX_KWH).toFixed(1) : "18"} required/></label>
      {formError && <p className="form-error" role="alert">{formError}</p>}
      <button className="primary-button" type="submit">Save charge</button>
    </Modal>}

    {selected && <Modal title={`${selected.energyKwh} kWh charge`} onClose={() => setSelected(null)}>
      <dl className="detail-list">
        <div><dt>When</dt><dd>{dayHeading(selected.loggedAt)}, {formatTimeOfDay(selected.chargedAt)}</dd></div>
        <div><dt>Location</dt><dd>{selected.city}</dd></div>
        <div><dt>Grid intensity</dt><dd>{selected.carbonIntensity !== null ? `${Math.round(selected.carbonIntensity)} gCO₂/kWh${selected.intensitySource === "typical" ? " (typical for that hour)" : ""}` : "Not recorded"}</dd></div>
        <div><dt>Points</dt><dd>+{pointsForCharge(selected)}</dd></div>
      </dl>
      <button className="forecast-button action-button destructive-button" onClick={deleteSelected}><Icon name="trash" size={18}/> Delete charge</button>
    </Modal>}
  </div>;
}
