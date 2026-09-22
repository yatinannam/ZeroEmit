"use client";

import { FormEvent, useState } from "react";
import { pointsForCharge } from "../lib/rewards";
import { averageEnergyKwh, typicalChargeTime } from "../lib/personalization";
import { useGridData } from "./use-grid-data";
import { LEGACY_LOGGED_AT, useCharges } from "./use-charges";
import { useLocationPicker } from "./use-location-picker";
import { Icon } from "./icon-set";
import { BottomNav, TopBar } from "./app-shell";
import { LocationModal } from "./location-modal";
import { PageHeader } from "./page-header";

export function LogScreen() {
  const { location: city, locationOpen, openLocation, closeLocation, chooseLocation } = useLocationPicker();
  const [formOpen, setFormOpen] = useState(false);
  const [message, setMessage] = useState("");
  const grid = useGridData(city);
  const { charges, addCharge } = useCharges();

  // Scoped to the selected city — different cities sit on different grids,
  // so a blended cross-city average wouldn't be a meaningful "usual" here.
  const cityCharges = charges.filter((charge) => charge.city === city);
  const typicalEnergy = averageEnergyKwh(cityCharges);
  const typicalTime = typicalChargeTime(cityCharges);

  function submitCharge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    addCharge({ energyKwh: Number(form.get("energy")), chargedAt: String(form.get("time")), city, carbonIntensity: grid.data?.current?.carbonIntensity ?? null, intensityClass: grid.data?.current?.intensityClass ?? null });
    setFormOpen(false);
    setMessage("Charge saved on this device. Your history is updated.");
  }

  return <div className="mobile-app">
    <TopBar onChooseLocation={openLocation}/>
    <main className="dashboard-content">
      <PageHeader eyebrow="Charging history" title="Your charging impact." intro="Keep track of every charge and the emissions you avoided."/>

      <button className="forecast-button action-button" onClick={() => setFormOpen(true)}>Log a charge <Icon name="arrow" size={18}/></button>
      {message && <p className="success-message" role="status">{message}</p>}

      <section className="activity">
        <h2>All charges</h2>
        {charges.length ? charges.map((charge) => <div key={charge.id} className="card activity-item">
          <span className="round-icon"><Icon name="bolt" size={19}/></span>
          <div><strong>{charge.energyKwh} kWh logged</strong><span>{charge.city} · {charge.chargedAt}{charge.loggedAt !== LEGACY_LOGGED_AT ? ` · ${new Date(charge.loggedAt).toLocaleDateString()}` : ""}</span></div>
          <b>+{pointsForCharge(charge)} pts</b>
        </div>) : <p className="personal-note">No charges logged yet. Log your first charge to see your impact.</p>}
      </section>
    </main>
    <BottomNav/>

    {locationOpen && <LocationModal current={city} onClose={closeLocation} onChoose={chooseLocation}/>}

    {formOpen && <div className="modal-backdrop" role="presentation" onClick={() => setFormOpen(false)}>
      <form className="modal charge-form" onSubmit={submitCharge} onClick={(event) => event.stopPropagation()}>
        <div className="modal-head"><h2>Log a charge</h2><button type="button" className="modal-close" aria-label="Close" onClick={() => setFormOpen(false)}><Icon name="close" size={18}/></button></div>
        <label>Energy used (kWh)<input name="energy" type="number" min="0.1" step="0.1" defaultValue={typicalEnergy ? typicalEnergy.toFixed(1) : "18"} required/></label>
        <label>When did you charge?<input name="time" type="time" defaultValue={typicalTime ?? "02:30"} required/></label>
        <button className="forecast-button" type="submit">Save charge</button>
      </form>
    </div>}
  </div>;
}
