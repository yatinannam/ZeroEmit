"use client";

import { FormEvent, useState } from "react";
import { chargesInMonth, currentStreakDays, estimatedCarbonSavedGrams, impactSummary, totalPoints } from "../lib/rewards";
import { LEGACY_LOGGED_AT, useCharges } from "./use-charges";
import { useProfile } from "./use-profile";
import { useLocationPicker } from "./use-location-picker";
import { clearNotificationFlag, resetNotificationPrefs, useNotificationPermission } from "./notifications";
import { NotificationSettings } from "./notification-settings";
import { removePushSubscription } from "./push-client";
import { showToast } from "./toast";
import { Icon, type IconName } from "./icon-set";
import { BottomNav, TopBar } from "./app-shell";
import { LocationModal } from "./location-modal";
import { Modal } from "./modal";
import { ShareImpactModal } from "./share-card";
import { useThemeChoice, type ThemeChoice } from "./theme";

const THEME_OPTIONS: { key: ThemeChoice; label: string }[] = [{ key: "system", label: "System" }, { key: "light", label: "Light" }, { key: "dark", label: "Dark" }];

type Summary = ReturnType<typeof impactSummary>;
const IMPACT_ROWS: { label: string; value: (summary: Summary) => string }[] = [
  { label: "Energy charged", value: (s) => (s.count ? `${s.kwh.toFixed(1)} kWh` : "—") },
  { label: "CO₂ avoided", value: (s) => (s.count ? `${s.co2Kg.toFixed(1)} kg` : "—") },
  { label: "Green-charge rate", value: (s) => (s.greenRate === null ? "—" : `${Math.round(s.greenRate * 100)}%`) },
  { label: "Charges", value: (s) => String(s.count) },
];

const ABOUT_TEXT = "ZeroEmit helps you charge your EV when the grid is running on cleaner power. Best-time recommendations come from live regional grid data where available, or your own charging history otherwise.";
const PRIVACY_TEXT = "Your vehicle and charge history stay on this device. ZeroEmit's server gets your state, to fetch grid data for its region. If you use your current location, your coordinates are only used on this device to find the nearest city. If you turn on scheduled notifications, the server also keeps your city name, which notifications you want, and your streak count and last charge date, so it can send reminders; turning them off or deleting your account removes that.";

export function ProfileScreen() {
  const { place, location, setPlace, locationOpen, openLocation, closeLocation, chooseLocation } = useLocationPicker();
  const [editOpen, setEditOpen] = useState(false);
  const [infoModal, setInfoModal] = useState<"about" | "privacy" | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [theme, setTheme] = useThemeChoice();
  const permission = useNotificationPermission();
  const { charges, clearCharges } = useCharges();
  const { profile, updateProfile, resetProfile } = useProfile();

  const points = totalPoints(charges);
  const streak = currentStreakDays(charges);
  const savedGrams = estimatedCarbonSavedGrams(charges);
  const thisMonth = impactSummary(chargesInMonth(charges));
  const lastMonth = impactSummary(chargesInMonth(charges, 1));
  // Setup date if recorded; otherwise (installs from before it was) the first charge.
  const oldestCharge = charges.at(-1);
  const since = profile.joinedAt ?? (oldestCharge && oldestCharge.loggedAt !== LEGACY_LOGGED_AT ? oldestCharge.loggedAt : null);
  const sinceLabel = since ? new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" }).format(new Date(since)) : null;
  const initials = profile.name.trim() ? profile.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0].toUpperCase()).join("") : "?";

  function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    updateProfile({ ...profile, name: String(form.get("name") || "").trim(), vehicle: String(form.get("vehicle") || "").trim() });
    setEditOpen(false);
    showToast("Profile updated");
  }

  function deleteAccount() {
    clearCharges();
    resetProfile();
    clearNotificationFlag();
    resetNotificationPrefs();
    void removePushSubscription();
    setPlace(null);
    setDeleteOpen(false);
    showToast("Your data has been deleted from this device");
  }

  const settingsRows: { icon: IconName; label: string; trailing?: string; onClick: () => void }[] = [
    { icon: "user", label: "Profile & vehicle", onClick: () => setEditOpen(true) },
    { icon: "pin", label: "Location", onClick: openLocation },
    { icon: "bell", label: "Notifications", trailing: permission === "granted" ? "On" : permission === "denied" ? "Blocked" : "Off", onClick: () => setNotificationsOpen(true) },
    { icon: "moon", label: "Appearance", trailing: THEME_OPTIONS.find((option) => option.key === theme)?.label, onClick: () => setAppearanceOpen(true) },
    { icon: "shield", label: "Privacy", onClick: () => setInfoModal("privacy") },
    { icon: "info", label: "About", onClick: () => setInfoModal("about") },
  ];

  return <div className="mobile-app">
    <TopBar onChooseLocation={openLocation}/>
    <main className="dashboard-content">
      <section className="profile-avatar-block">
        <span className="avatar">{initials}</span>
        <h1>{profile.name || "Add your name"}</h1>
        <p className="profile-vehicle">{profile.vehicle || "Add your EV in Profile & vehicle"}</p>
        <button className="location-label location-button" onClick={openLocation}><Icon name="pin" size={14}/> {location}</button>
        {sinceLabel && <p className="profile-since">Charging with ZeroEmit since {sinceLabel}</p>}
      </section>

      <section className="metrics-grid">
        <div className="card saved-card"><div><h2>Total carbon avoided</h2><strong>{(savedGrams / 1000).toFixed(1)} <small>kg</small></strong></div><span className="metric-icon"><Icon name="tree"/></span></div>
        <div className="card metric"><h2>Eco points</h2><strong>{points || "—"}</strong></div>
        <div className="card metric"><h2>Streak</h2><strong>{streak ? <>{streak} <small>day{streak === 1 ? "" : "s"}</small></> : "—"}</strong></div>
      </section>

      <section className="card stat-card impact-card">
        <h2>Your impact</h2>
        <table className="impact-table">
          <thead><tr><td/><th scope="col">This month</th><th scope="col">Last month</th></tr></thead>
          <tbody>{IMPACT_ROWS.map((row) => <tr key={row.label}><th scope="row">{row.label}</th><td>{row.value(thisMonth)}</td><td>{row.value(lastMonth)}</td></tr>)}</tbody>
        </table>
        {charges.length ? <button className="forecast-button action-button" onClick={() => setShareOpen(true)}><Icon name="share" size={18}/> Share my impact</button> : <p className="personal-note">Log a charge to start tracking your impact.</p>}
      </section>

      <section className="card settings-list">
        {settingsRows.map((row) => <button key={row.label} className="settings-row" onClick={row.onClick}><span className="round-icon"><Icon name={row.icon} size={18}/></span><span>{row.label}</span>{row.trailing && <small className={row.trailing === "On" ? "settings-row-trailing settings-row-on" : "settings-row-trailing"}>{row.trailing}</small>}<Icon name="chevron-right" size={18}/></button>)}
      </section>

      <button className="forecast-button action-button destructive-button" onClick={() => setDeleteOpen(true)}><Icon name="trash" size={18}/> Delete account</button>
    </main>
    <BottomNav/>

    {locationOpen && <LocationModal current={place} onClose={closeLocation} onChoose={chooseLocation}/>}

    {editOpen && <Modal title="Profile & vehicle" onClose={() => setEditOpen(false)} onSubmit={submitProfile}>
      <label>Name<input name="name" type="text" defaultValue={profile.name} placeholder="Your name" maxLength={60} autoComplete="name"/></label>
      <label>Vehicle<input name="vehicle" type="text" defaultValue={profile.vehicle} placeholder="e.g. Tata Nexon EV" maxLength={60}/></label>
      <button className="primary-button" type="submit">Save profile</button>
    </Modal>}

    {notificationsOpen && <NotificationSettings onClose={() => setNotificationsOpen(false)}/>}

    {shareOpen && <ShareImpactModal charges={charges} name={profile.name.trim().split(/\s+/)[0] ?? ""} onClose={() => setShareOpen(false)}/>}

    {appearanceOpen && <Modal title="Appearance" onClose={() => setAppearanceOpen(false)}>
      <p>System follows your phone&apos;s light or dark setting.</p>
      <div className="segmented" role="radiogroup" aria-label="Theme">
        {THEME_OPTIONS.map((option) => <button key={option.key} role="radio" aria-checked={theme === option.key} className={theme === option.key ? "active" : ""} onClick={() => setTheme(option.key)}>{option.label}</button>)}
      </div>
    </Modal>}

    {infoModal && <Modal title={infoModal === "about" ? "About ZeroEmit" : "Privacy"} onClose={() => setInfoModal(null)}>
      <p>{infoModal === "about" ? ABOUT_TEXT : PRIVACY_TEXT}</p>
    </Modal>}

    {deleteOpen && <Modal title="Delete account?" onClose={() => setDeleteOpen(false)}>
      <p>ZeroEmit doesn&apos;t have a server account to delete — your profile, location, charge history and notification choices are only stored on this device. This clears all of it and starts you from setup. It can&apos;t be undone.</p>
      <button className="forecast-button action-button destructive-button" onClick={deleteAccount}><Icon name="trash" size={18}/> Delete account</button>
    </Modal>}
  </div>;
}
