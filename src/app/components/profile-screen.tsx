"use client";

import { FormEvent, useState } from "react";
import { DEFAULT_CITY } from "../lib/grid";
import { chargesInCurrentMonth, currentStreakDays, estimatedCarbonSavedGrams, totalPoints } from "../lib/rewards";
import { useCharges } from "./use-charges";
import { useProfile } from "./use-profile";
import { useLocationPicker } from "./use-location-picker";
import { notificationsEnabled, requestNotificationPermission } from "./notifications";
import { Icon, type IconName } from "./icon-set";
import { BottomNav, TopBar } from "./app-shell";
import { LocationModal } from "./location-modal";
import { Modal } from "./modal";

const ABOUT_TEXT = "ZeroEmit helps you charge your EV when the grid is running on cleaner power. Best-time recommendations come from live regional grid data where available, or your own charging history otherwise.";
const PRIVACY_TEXT = "Your location, vehicle, and charge history stay on this device — nothing is sent to a server except the city name, which is used to fetch grid data for that region.";

export function ProfileScreen() {
  const { location, setLocation, locationOpen, openLocation, closeLocation, chooseLocation } = useLocationPicker();
  const [editOpen, setEditOpen] = useState(false);
  const [infoModal, setInfoModal] = useState<"about" | "privacy" | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [notifsOn, setNotifsOn] = useState(() => notificationsEnabled());
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
    const result = await requestNotificationPermission();
    setMessage(result.message);
    setNotifsOn(result.granted);
  }

  function deleteAccount() {
    clearCharges();
    resetProfile();
    setLocation(DEFAULT_CITY);
    setDeleteOpen(false);
    setMessage("Your account data has been deleted from this device.");
  }

  const settingsRows: { icon: IconName; label: string; trailing?: string; onClick: () => void }[] = [
    { icon: "bolt", label: "Charging preferences", onClick: () => setEditOpen(true) },
    { icon: "pin", label: "Location", onClick: openLocation },
    { icon: "bell", label: "Notifications", trailing: notifsOn ? "On" : undefined, onClick: enableNotifications },
    { icon: "shield", label: "Privacy", onClick: () => setInfoModal("privacy") },
    { icon: "info", label: "About", onClick: () => setInfoModal("about") },
  ];

  return <div className="mobile-app">
    <TopBar onChooseLocation={openLocation}/>
    <main className="dashboard-content">
      <section className="profile-avatar-block">
        <span className="avatar">{initials}</span>
        <h1>{profile.name || "Add your name"}</h1>
        <button className="location-label location-button" onClick={openLocation}><Icon name="pin" size={14}/> {location}</button>
      </section>

      <section className="metrics-grid">
        <div className="card saved-card"><div><h2>Total carbon avoided</h2><strong>{(savedGrams / 1000).toFixed(1)} <small>kg</small></strong></div><span className="metric-icon"><Icon name="tree"/></span></div>
        <div className="card metric"><h2>Eco points</h2><strong>{points || "—"}</strong></div>
        <div className="card metric"><h2>Streak</h2><strong>{streak ? `${streak}d` : "—"}</strong></div>
      </section>

      <section className="card settings-list">
        {settingsRows.map((row) => <button key={row.label} className="settings-row" onClick={row.onClick}><span className="round-icon"><Icon name={row.icon} size={18}/></span><span>{row.label}</span>{row.trailing && <small className="settings-row-trailing">{row.trailing}</small>}<Icon name="chevron-right" size={18}/></button>)}
      </section>

      <p className="personal-note">{monthCharges.length ? `${monthKwh.toFixed(1)} kWh logged this month across ${monthCharges.length} charge${monthCharges.length === 1 ? "" : "s"}.` : "Log a charge to start tracking your impact."}</p>

      <button className="forecast-button action-button destructive-button" onClick={() => setDeleteOpen(true)}><Icon name="trash" size={18}/> Delete account</button>
      {message && <p className="success-message" role="status">{message}</p>}
    </main>
    <BottomNav/>

    {locationOpen && <LocationModal current={location} onClose={closeLocation} onChoose={chooseLocation}/>}

    {editOpen && <div className="modal-backdrop" role="presentation" onClick={() => setEditOpen(false)}>
      <form className="modal charge-form" onSubmit={submitProfile} onClick={(event) => event.stopPropagation()}>
        <div className="modal-head"><h2>Edit profile</h2><button type="button" className="modal-close" aria-label="Close" onClick={() => setEditOpen(false)}><Icon name="close" size={18}/></button></div>
        <label>Name<input name="name" type="text" defaultValue={profile.name} placeholder="Your name" maxLength={60}/></label>
        <label>Vehicle<input name="vehicle" type="text" defaultValue={profile.vehicle} placeholder="e.g. Tata Nexon EV" maxLength={60}/></label>
        <button className="forecast-button" type="submit">Save profile</button>
      </form>
    </div>}

    {infoModal && <Modal title={infoModal === "about" ? "About ZeroEmit" : "Privacy"} onClose={() => setInfoModal(null)}>
      <p>{infoModal === "about" ? ABOUT_TEXT : PRIVACY_TEXT}</p>
    </Modal>}

    {deleteOpen && <Modal title="Delete account?" onClose={() => setDeleteOpen(false)}>
      <p>ZeroEmit doesn&apos;t have a server account to delete — your profile, location, and charge history are only stored on this device. This clears all of it. It can&apos;t be undone.</p>
      <button className="forecast-button action-button destructive-button" onClick={deleteAccount}><Icon name="trash" size={18}/> Delete account</button>
    </Modal>}
  </div>;
}
