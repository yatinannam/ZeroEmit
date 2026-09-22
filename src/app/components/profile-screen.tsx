"use client";

import { FormEvent, useState } from "react";
import { DEFAULT_CITY } from "../lib/grid";
import { chargesInCurrentMonth, currentStreakDays, estimatedCarbonSavedGrams, totalPoints } from "../lib/rewards";
import { useCharges } from "./use-charges";
import { useProfile } from "./use-profile";
import { useStoredLocation } from "./use-location";
import { Icon, type IconName } from "./icon-set";
import { BottomNav, TopBar } from "./app-shell";
import { LocationModal } from "./location-modal";

const ABOUT_TEXT = "ZeroEmit helps you charge your EV when the grid is running on cleaner power. Best-time recommendations come from live regional grid data where available, or your own charging history otherwise.";
const PRIVACY_TEXT = "Your location, vehicle, and charge history stay on this device — nothing is sent to a server except the city name, which is used to fetch grid data for that region.";

export function ProfileScreen() {
  const [location, setLocation] = useStoredLocation();
  const [locationOpen, setLocationOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [infoModal, setInfoModal] = useState<"about" | "privacy" | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [message, setMessage] = useState("");
  const { charges, clearCharges } = useCharges();
  const { profile, updateProfile, resetProfile } = useProfile();

  const points = totalPoints(charges);
  const streak = currentStreakDays(charges);
  const savedGrams = estimatedCarbonSavedGrams(charges);
  const monthCharges = chargesInCurrentMonth(charges);
  const monthKwh = monthCharges.reduce((sum, charge) => sum + charge.energyKwh, 0);
  const initials = profile.name.trim() ? profile.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0].toUpperCase()).join("") : "?";

  function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    updateProfile({ name: String(form.get("name") || "").trim(), vehicle: String(form.get("vehicle") || "").trim() });
    setEditOpen(false);
    setMessage("Profile updated on this device.");
  }

  async function enableNotifications() {
    if (!("Notification" in window)) { setMessage("This browser does not support notifications."); return; }
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    setMessage(permission === "granted" ? "Notifications allowed on this device." : "Notifications are blocked. Enable them in your browser settings.");
  }

  function resetData() {
    clearCharges();
    resetProfile();
    setLocation(DEFAULT_CITY);
    setResetOpen(false);
    setMessage("All local data has been cleared.");
  }

  const settingsRows: { icon: IconName; label: string; onClick: () => void }[] = [
    { icon: "bolt", label: "Charging preferences", onClick: () => setEditOpen(true) },
    { icon: "pin", label: "Location", onClick: () => setLocationOpen(true) },
    { icon: "bell", label: "Notifications", onClick: enableNotifications },
    { icon: "shield", label: "Privacy", onClick: () => setInfoModal("privacy") },
    { icon: "info", label: "About", onClick: () => setInfoModal("about") },
  ];

  return <div className="mobile-app">
    <TopBar onChooseLocation={() => setLocationOpen(true)}/>
    <main className="dashboard-content">
      <section className="profile-avatar-block">
        <span className="avatar">{initials}</span>
        <h1>{profile.name || "Add your name"}</h1>
        <button className="location-label location-button" onClick={() => setLocationOpen(true)}><Icon name="pin" size={14}/> {location}</button>
      </section>

      <section className="metrics-grid">
        <div className="card saved-card"><div><h2>Total carbon avoided</h2><strong>{(savedGrams / 1000).toFixed(1)} <small>kg</small></strong></div><span className="metric-icon"><Icon name="tree"/></span></div>
        <div className="card metric"><h2>Eco points</h2><strong>{points || "—"}</strong></div>
        <div className="card metric"><h2>Streak</h2><strong>{streak ? `${streak}d` : "—"}</strong></div>
      </section>

      <section className="card settings-list">
        {settingsRows.map((row) => <button key={row.label} className="settings-row" onClick={row.onClick}><span className="round-icon"><Icon name={row.icon} size={18}/></span><span>{row.label}</span><Icon name="chevron-right" size={18}/></button>)}
      </section>

      <p className="personal-note">{monthCharges.length ? `${monthKwh.toFixed(1)} kWh logged this month across ${monthCharges.length} charge${monthCharges.length === 1 ? "" : "s"}.` : "Log a charge to start tracking your impact."}</p>

      <button className="forecast-button action-button destructive-button" onClick={() => setResetOpen(true)}><Icon name="trash" size={18}/> Reset my data</button>
      {message && <p className="success-message" role="status">{message}</p>}
    </main>
    <BottomNav/>

    {locationOpen && <LocationModal current={location} onClose={() => setLocationOpen(false)} onChoose={(next) => { setLocation(next); setLocationOpen(false); }}/>}

    {editOpen && <div className="modal-backdrop" role="presentation" onClick={() => setEditOpen(false)}>
      <form className="modal charge-form" onSubmit={submitProfile} onClick={(event) => event.stopPropagation()}>
        <div className="modal-head"><h2>Edit profile</h2><button type="button" className="modal-close" aria-label="Close" onClick={() => setEditOpen(false)}><Icon name="close" size={18}/></button></div>
        <label>Name<input name="name" type="text" defaultValue={profile.name} placeholder="Your name" maxLength={60}/></label>
        <label>Vehicle<input name="vehicle" type="text" defaultValue={profile.vehicle} placeholder="e.g. Tata Nexon EV" maxLength={60}/></label>
        <button className="forecast-button" type="submit">Save profile</button>
      </form>
    </div>}

    {infoModal && <div className="modal-backdrop" role="presentation" onClick={() => setInfoModal(null)}>
      <section className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head"><h2>{infoModal === "about" ? "About ZeroEmit" : "Privacy"}</h2><button className="modal-close" aria-label="Close" onClick={() => setInfoModal(null)}><Icon name="close" size={18}/></button></div>
        <p>{infoModal === "about" ? ABOUT_TEXT : PRIVACY_TEXT}</p>
      </section>
    </div>}

    {resetOpen && <div className="modal-backdrop" role="presentation" onClick={() => setResetOpen(false)}>
      <section className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head"><h2>Reset my data?</h2><button className="modal-close" aria-label="Close" onClick={() => setResetOpen(false)}><Icon name="close" size={18}/></button></div>
        <p>This clears your profile, location, and charge history from this device. It can&apos;t be undone.</p>
        <button className="forecast-button action-button destructive-button" onClick={resetData}><Icon name="trash" size={18}/> Clear everything</button>
      </section>
    </div>}
  </div>;
}
