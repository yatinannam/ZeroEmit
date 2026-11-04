"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { chargesInMonth, currentStreakDays, estimatedCarbonSavedGrams, impactSummary, totalPoints } from "../lib/rewards";
import { LEGACY_LOGGED_AT, useCharges } from "./use-charges";
import { useProfile } from "./use-profile";
import { useLocationPicker } from "./use-location-picker";
import { clearNotificationFlag, NOTIFICATION_KINDS, resetNotificationPrefs, serverPushAvailable, useNotificationPermission, useNotificationPrefs } from "./notifications";
import { useHydrated } from "./use-hydrated";
import { NotificationSettings } from "./notification-settings";
import { removePushSubscription } from "./push-client";
import { showToast } from "./toast";
import { Icon, type IconName } from "./icon-set";
import { BottomNav, TopBar } from "./app-shell";
import { LocationModal } from "./location-modal";
import { Modal } from "./modal";
import { equivalentsSentence } from "../lib/equivalents";
import { OTHER_VEHICLE, parseBatteryKwh, vehicleByKey, VEHICLE_GROUPS, VEHICLES } from "../lib/vehicles";
import { usePlannerSettings } from "./use-planner-settings";
import { BackupModal, useLastBackup } from "./backup";
import { chargeCost, DEFAULT_PRICE_PER_KWH, formatRupees, parsePricePerKwh } from "../lib/cost";
import { useThemeChoice, type ThemeChoice } from "./theme";
import { resetIntroSeen } from "./location-gate";
import { leaveLeaderboard, useLeaderboardMembership } from "./use-leaderboard";
import { LEAVE_PENDING_MESSAGE, LEFT_MESSAGE } from "./leaderboard";
import { CountUp } from "./motion";
import { forgetChargerLocation } from "./use-charger-location";
import { resetPlannerSettings } from "./use-planner-settings";

// The Profile & vehicle field to focus: the one the user tapped to fill in.
type EditField = "name" | "vehicle" | "price";

// The EV picker: a preset fills in the name and battery; "Other" asks for
// both. Old profiles with a typed-in vehicle and no preset start on "Other".
function VehicleFields({ vehicle, vehicleKey, batteryKwh }: { vehicle: string; vehicleKey?: string; batteryKwh?: number }) {
  const [choice, setChoice] = useState(vehicleKey ?? (vehicle ? OTHER_VEHICLE : ""));
  const preset = vehicleByKey(choice);
  return <>
    <label>Your EV<select name="vehicleKey" value={choice} onChange={(event) => setChoice(event.target.value)}>
      <option value="">Choose your EV</option>
      {VEHICLE_GROUPS.map((group) => <optgroup key={group.kind} label={group.label}>{VEHICLES.filter((item) => item.kind === group.kind).map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</optgroup>)}
      <option value={OTHER_VEHICLE}>Other</option>
    </select></label>
    {preset && <p className="form-hint">Battery about {preset.batteryKwh} kWh, so you can log charges by battery %.</p>}
    {choice === OTHER_VEHICLE && <div className="form-row">
      <label>Vehicle name<input name="vehicle" type="text" defaultValue={vehicle} placeholder="e.g. Tata Nexon EV" maxLength={60}/></label>
      <label>Battery (kWh)<input name="batteryKwh" type="number" inputMode="decimal" step="0.1" min="1" max="135" defaultValue={vehicleKey === OTHER_VEHICLE || !vehicleKey ? batteryKwh ?? "" : ""} placeholder="e.g. 30"/></label>
    </div>}
  </>;
}

const THEME_OPTIONS: { key: ThemeChoice; label: string }[] = [{ key: "system", label: "System" }, { key: "light", label: "Light" }, { key: "dark", label: "Dark" }];

type Summary = ReturnType<typeof impactSummary>;
const IMPACT_ROWS: { label: string; value: (summary: Summary, pricePerKwh: number) => string }[] = [
  { label: "Energy charged", value: (s) => (s.count ? `${s.kwh.toFixed(1)} kWh` : "—") },
  { label: "CO₂ avoided", value: (s) => (s.count ? `${s.co2Kg.toFixed(1)} kg` : "—") },
  { label: "Green-charge rate", value: (s) => (s.greenRate === null ? "—" : `${Math.round(s.greenRate * 100)}%`) },
  { label: "Charges", value: (s) => String(s.count) },
  { label: "Charging cost", value: (s, price) => (s.count ? formatRupees(chargeCost(s.kwh, price)) : "—") },
];

const ABOUT_TEXT = "ZeroEmit helps you charge your EV when the grid is running on cleaner power. Best-time recommendations come from live regional grid data where available, or your own charging history otherwise.";
const PRIVACY_TEXT = "Your vehicle and charge history stay on this device. ZeroEmit's server gets your state, to fetch grid data for its region, and your city, to find public chargers near the city centre in its copy of OpenStreetMap's charger map. Choosing your location during setup only picks the nearest city, on this device. If you tap \"Use my location\" for chargers, your position, rounded to about 1 km on this device, is sent to ZeroEmit's server to search that copy; it isn't stored or linked to you. If you turn on scheduled notifications, the server also keeps your city name, which notifications you want, your streak count and last charge date, this week's charge count, CO₂ avoided and green share, the badge you're closest to, and (if you've joined the leaderboard) your leaderboard entry's ID, which links these notifications to your public entry. It uses them only to send your reminders; turning notifications off or deleting your account removes them. If you join the leaderboard, your display name, grid region and this month's Eco points and CO₂ avoided are visible to other ZeroEmit users; leaving removes them. If you create or join a group, the same details appear on that group's board, which anyone with its code can see; leaving the group or the leaderboard takes them off.";

export function ProfileScreen() {
  const router = useRouter();
  const { place, ready, location, setPlace, locationOpen, openLocation, closeLocation, chooseLocation } = useLocationPicker();
  // null: closed. `focus`: the field to put the cursor in, if the user tapped one.
  const [editing, setEditing] = useState<{ focus?: EditField } | null>(null);
  const [infoModal, setInfoModal] = useState<"about" | "privacy" | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const lastBackup = useLastBackup();
  const [theme, setTheme] = useThemeChoice();
  const permission = useNotificationPermission();
  const { prefs } = useNotificationPrefs();
  const hydrated = useHydrated();
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leaderboardMember = useLeaderboardMembership();
  const { charges, ready: chargesReady, clearCharges } = useCharges();
  const { profile, updateProfile, resetProfile } = useProfile();
  const { settings: plannerSettings, update: updatePlanner } = usePlannerSettings();

  const points = totalPoints(charges);
  const streak = currentStreakDays(charges);
  const savedGrams = estimatedCarbonSavedGrams(charges);
  const price = profile.pricePerKwh ?? DEFAULT_PRICE_PER_KWH;
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
    // A blank or out-of-range price clears it (back to the typical tariff).
    const key = String(form.get("vehicleKey") || "");
    const preset = vehicleByKey(key);
    const vehicle = preset ? preset.name : key === OTHER_VEHICLE ? String(form.get("vehicle") || "").trim() : "";
    const batteryKwh = preset ? preset.batteryKwh : key === OTHER_VEHICLE ? parseBatteryKwh(form.get("batteryKwh")) ?? undefined : undefined;
    updateProfile({ ...profile, name: String(form.get("name") || "").trim(), vehicle, vehicleKey: key || undefined, batteryKwh, pricePerKwh: parsePricePerKwh(form.get("price")) ?? undefined });
    // A new EV only changes the planner's charger when the one set can't be
    // its own: a scooter charger for a car, or a car's charger for a scooter.
    if (preset && key !== profile.vehicleKey) {
      const scooter = preset.kind === "scooter";
      if (scooter && plannerSettings.charger !== "scooter") updatePlanner({ charger: "scooter" });
      else if (!scooter && plannerSettings.charger === "scooter") updatePlanner({ charger: "socket" });
    }
    setEditing(null);
    showToast("Profile updated");
  }

  function deleteAccount() {
    clearCharges();
    resetProfile();
    clearNotificationFlag();
    resetNotificationPrefs();
    void removePushSubscription();
    void leaveLeaderboard();
    resetIntroSeen();
    forgetChargerLocation();
    resetPlannerSettings();
    // Small per-device records with no store of their own: today's clean-grid
    // alert and the last leaderboard score sent.
    for (const key of ["zeroemit-clean-alert", "zeroemit-leaderboard-synced", "zeroemit-last-backup"]) { try { window.localStorage.removeItem(key); } catch { /* storage unavailable */ } }
    setPlace(null);
    setDeleteOpen(false);
    // Setup starts again over Home, not over this page scrolled to the bottom.
    router.replace("/");
    showToast("Your data has been deleted from this device");
  }

  // "On" only if some notification the user can see is switched on, not just
  // because the browser allows them.
  const notificationsOn = NOTIFICATION_KINDS.some((kind) => (serverPushAvailable || !kind.serverOnly) && prefs[kind.key]);
  const notificationsLabel = permission === "denied" ? "Blocked" : permission === "granted" && notificationsOn ? "On" : "Off";

  // Arrow keys move between the theme options, as in any radio group.
  function onThemeKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = THEME_OPTIONS.findIndex((option) => option.key === theme);
    const next = THEME_OPTIONS[(index + step + THEME_OPTIONS.length) % THEME_OPTIONS.length];
    setTheme(next.key);
    event.currentTarget.querySelector<HTMLElement>(`[data-theme-option="${next.key}"]`)?.focus();
  }

  const settingsRows: { icon: IconName; label: string; trailing?: string; onClick: () => void }[] = [
    { icon: "user", label: "Profile & vehicle", onClick: () => setEditing({}) },
    { icon: "pin", label: "Location", onClick: openLocation },
    { icon: "bell", label: "Notifications", trailing: hydrated ? notificationsLabel : undefined, onClick: () => setNotificationsOpen(true) },
    { icon: "download", label: "Back up & restore", trailing: hydrated ? (lastBackup ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(lastBackup)) : "Never") : undefined, onClick: () => setBackupOpen(true) },
    { icon: "moon", label: "Appearance", trailing: hydrated ? THEME_OPTIONS.find((option) => option.key === theme)?.label : undefined, onClick: () => setAppearanceOpen(true) },
    { icon: "shield", label: "Privacy", onClick: () => setInfoModal("privacy") },
    { icon: "info", label: "About", onClick: () => setInfoModal("about") },
  ];

  return <div className="mobile-app">
    <TopBar onChooseLocation={openLocation}/>
    <main className="dashboard-content">
      <section className="profile-avatar-block">
        {/* The avatar, name and EV all open Profile & vehicle: that's where a new
            user looks to fill them in. The avatar is a tap target only; the name
            and EV buttons are the keyboard and screen-reader route. */}
        <button type="button" className="avatar avatar-button" tabIndex={-1} aria-hidden="true" onClick={() => setEditing({ focus: profile.name ? undefined : "name" })}>{initials === "?" ? <Icon name="user" size={40}/> : initials}<span className="avatar-edit"><Icon name="pencil" size={14}/></span></button>
        <h1><button type="button" className={profile.name ? "profile-edit" : "profile-edit profile-edit-empty"} onClick={() => setEditing({ focus: "name" })}>{chargesReady ? <>{profile.name || "Add your name"}{profile.name && <span className="sr-only">, edit</span>}<Icon name="pencil" size={16}/></> : "\u00a0"}</button></h1>
        <p className="profile-vehicle"><button type="button" className={profile.vehicle ? "profile-edit" : "profile-edit profile-edit-empty"} onClick={() => setEditing({ focus: "vehicle" })}>{chargesReady ? (profile.vehicle ? <>{profile.vehicle}<span className="sr-only">, edit vehicle</span></> : "Add your EV") : "\u00a0"}</button></p>
        <button className="location-label location-button" aria-label={ready ? `Change location, ${location}` : "Change location"} onClick={openLocation}><Icon name="pin" size={14}/> {ready ? location : ""}</button>
        {sinceLabel && <p className="profile-since">Charging with ZeroEmit since {sinceLabel}</p>}
      </section>

      <section className="metrics-grid">
        <Link href="/rewards" className="card saved-card"><div><h2>Total carbon avoided</h2><strong><CountUp value={savedGrams / 1000} decimals={1}/> <small>kg</small></strong></div><span className="metric-icon"><Icon name="leaf"/></span></Link>
        <Link href="/rewards" className="card metric"><h2>Eco points</h2><strong><CountUp value={points}/></strong></Link>
        <Link href="/rewards" className="card metric"><h2>Streak</h2><strong><CountUp value={streak}/> <small>day{streak === 1 ? "" : "s"}</small></strong></Link>
      </section>

      <section className="card stat-card impact-card">
        <h2>Your impact</h2>
        <table className="impact-table">
          <thead><tr><td/><th scope="col">This month</th><th scope="col">Last month</th></tr></thead>
          <tbody>{IMPACT_ROWS.map((row) => <tr key={row.label}><th scope="row">{row.label}</th><td>{row.value(thisMonth, price)}</td><td>{row.value(lastMonth, price)}</td></tr>)}</tbody>
        </table>
        <p className="personal-note">Cost at {formatRupees(price)} per kWh{profile.pricePerKwh ? "." : ", a typical home tariff."} <button type="button" className="text-button" onClick={() => setEditing({ focus: "price" })}>{profile.pricePerKwh ? "Change price" : "Set your price"}</button></p>
        {equivalentsSentence(savedGrams / 1000) && <p className="equivalents">In total: {equivalentsSentence(savedGrams / 1000)!.replace(/^Like/, "like")}</p>}
        {!chargesReady ? null : charges.length ? <div className="hero-actions profile-recap-actions">
          <Link className="forecast-button" href="/recap"><Icon name="sparkle" size={18}/> Monthly recap</Link>
          <Link className="forecast-button" href="/recap?period=all"><Icon name="share" size={18}/> Share all-time</Link>
        </div> : <p className="personal-note">No charges yet. <Link className="text-button" href="/log?quick=1">Log your first charge</Link></p>}
      </section>

      <section className="card settings-list">
        {settingsRows.map((row) => <button key={row.label} className="settings-row" onClick={row.onClick}><span className="round-icon"><Icon name={row.icon} size={18}/></span><span>{row.label}</span>{row.trailing && <small className={row.trailing === "On" ? "settings-row-trailing settings-row-on" : "settings-row-trailing"}>{row.trailing}</small>}<Icon name="chevron-right" size={18}/></button>)}
      </section>

      <button className="forecast-button action-button destructive-button" onClick={() => setDeleteOpen(true)}><Icon name="trash" size={18}/> Delete my data</button>
    </main>
    <BottomNav/>

    {locationOpen && <LocationModal current={place} onClose={closeLocation} onChoose={chooseLocation}/>}

    {editing && <Modal title="Profile & vehicle" onClose={() => setEditing(null)} onSubmit={submitProfile} initialFocus={editing.focus && (editing.focus === "vehicle" ? `select[name="vehicleKey"]` : `input[name="${editing.focus}"]`)}>
      <label>Name<input name="name" type="text" defaultValue={profile.name} placeholder="Your name" maxLength={60} autoComplete="name"/></label>
      <VehicleFields vehicle={profile.vehicle} vehicleKey={profile.vehicleKey} batteryKwh={profile.batteryKwh}/>
      <label>Electricity price (₹ per kWh)<input name="price" type="number" inputMode="decimal" step="0.01" min="1" max="60" defaultValue={profile.pricePerKwh ?? ""} placeholder={String(DEFAULT_PRICE_PER_KWH)}/></label>
      <button className="primary-button" type="submit">Save profile</button>
    </Modal>}

    {notificationsOpen && <NotificationSettings onClose={() => setNotificationsOpen(false)}/>}

    {backupOpen && <BackupModal onClose={() => setBackupOpen(false)}/>}


    {appearanceOpen && <Modal title="Appearance" onClose={() => setAppearanceOpen(false)}>
      <p>System follows your phone&apos;s light or dark setting.</p>
      <div className="segmented" role="radiogroup" aria-label="Theme" onKeyDown={onThemeKey}>
        {THEME_OPTIONS.map((option) => <button key={option.key} role="radio" aria-checked={theme === option.key} tabIndex={theme === option.key ? 0 : -1} data-theme-option={option.key} className={theme === option.key ? "active" : ""} onClick={() => setTheme(option.key)}>{option.label}</button>)}
      </div>
    </Modal>}

    {infoModal && <Modal title={infoModal === "about" ? "About ZeroEmit" : "Privacy"} onClose={() => setInfoModal(null)}>
      <p>{infoModal === "about" ? ABOUT_TEXT : PRIVACY_TEXT}</p>
      {infoModal === "privacy" && leaderboardMember && <button className="forecast-button action-button" onClick={() => { setInfoModal(null); setLeaveOpen(true); }}>Leave the leaderboard</button>}
    </Modal>}

    {leaveOpen && <Modal title="Leave the leaderboard?" onClose={() => setLeaveOpen(false)}>
      <p>Your name and this month&apos;s points come off the public board. You can join again later.</p>
      <button className="forecast-button action-button destructive-button" onClick={() => { setLeaveOpen(false); void leaveLeaderboard().then((done) => showToast(done ? LEFT_MESSAGE : LEAVE_PENDING_MESSAGE)); }}>Leave the leaderboard</button>
    </Modal>}

    {deleteOpen && <Modal title="Delete your data?" onClose={() => setDeleteOpen(false)}>
      <p>ZeroEmit doesn&apos;t have an account to sign in to. This clears your profile, location, charge history, notification choices and leaderboard entry, and starts you from setup. It can&apos;t be undone.</p>
      <button className="forecast-button action-button destructive-button" onClick={deleteAccount}><Icon name="trash" size={18}/> Delete my data</button>
    </Modal>}
  </div>;
}
