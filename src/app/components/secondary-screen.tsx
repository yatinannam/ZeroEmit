"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { bestWindow, formatHour } from "../lib/grid";
import { useGridData } from "./use-grid-data";
import { LEGACY_LOGGED_AT, useCharges } from "./use-charges";
import { useProfile } from "./use-profile";
import { useStoredLocation } from "./use-location";
import { chargesInCurrentMonth, currentStreakDays, pointsToNextReward, totalPoints } from "../lib/rewards";
import { averageEnergyKwh, formatTimeOfDay, typicalChargeTime } from "../lib/personalization";

const content = {
  forecast: { eyebrow: "CARBON FORECAST", title: "Charge when the grid is cleaner.", intro: "See the best windows for your next charge and make a lower-carbon choice." },
  log: { eyebrow: "CHARGING HISTORY", title: "Your charging impact.", intro: "Keep track of every charge and the emissions you avoided." },
  rewards: { eyebrow: "REWARDS", title: "Small choices, real progress.", intro: "Earn points for charging when renewable energy is available." },
  profile: { eyebrow: "YOUR PROFILE", title: "Make every charge count.", intro: "Manage your location, vehicle preferences, and impact goals." },
} as const;

export function SecondaryScreen({ page }: { page: keyof typeof content }) {
  const data = content[page];
  const [city] = useStoredLocation();
  const grid = useGridData(city);
  const { charges, addCharge } = useCharges();
  const { profile, updateProfile } = useProfile();
  const [message, setMessage] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  const points = totalPoints(charges);
  const streak = currentStreakDays(charges);
  const monthCharges = chargesInCurrentMonth(charges);
  const monthKwh = monthCharges.reduce((sum, charge) => sum + charge.energyKwh, 0);
  // Scoped to the selected city — different cities sit on different grids,
  // so a blended cross-city average wouldn't be a meaningful "usual" here.
  const cityCharges = charges.filter((charge) => charge.city === city);
  const typicalEnergy = averageEnergyKwh(cityCharges);
  const typicalTime = typicalChargeTime(cityCharges);

  function submitCharge(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); addCharge({ energyKwh: Number(form.get("energy")), chargedAt: String(form.get("time")), city, carbonIntensity: grid.data?.current?.carbonIntensity ?? null, intensityClass: grid.data?.current?.intensityClass ?? null }); setFormOpen(false); setMessage("Charge saved on this device. Your history is updated."); }
  function submitProfile(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); updateProfile({ name: String(form.get("name") || "").trim(), vehicle: String(form.get("vehicle") || "").trim() }); setFormOpen(false); setMessage("Profile updated on this device."); }
  async function primaryAction() {
    if (page === "forecast") { if ("Notification" in window) { const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission; if (permission === "granted") { window.localStorage.setItem("zeroemit-reminder", "true"); setMessage("Notifications allowed on this device. Automatic charge-window alerts aren't available yet — check the dashboard for the best time to charge."); } else setMessage("Notifications are blocked. Enable them in your browser settings to receive alerts once available."); } else setMessage("This browser does not support notifications."); }
    else if (page === "log") setFormOpen(true);
    else if (page === "rewards") setMessage(`Keep going — your next reward is ${pointsToNextReward(points)} points away.`);
    else setFormOpen(true);
  }
  const actionLabel = page === "forecast" ? "Enable notifications" : page === "log" ? "Log a charge" : page === "rewards" ? "View next reward" : "Edit profile";
  const forecastWindow = grid.data?.available ? bestWindow(grid.data.forecast, 2) : null;
  const cards = page === "forecast"
    ? (grid.data?.available ? [["Current intensity", `${Math.round(grid.data.current?.carbonIntensity || 0)} gCO₂/kWh`, grid.data.current?.isEstimated ? "Estimated · live provider" : "Live provider"], ["Best 2-hour window", forecastWindow ? `${formatHour(forecastWindow.start.datetime)} – ${formatHour(forecastWindow.end.datetime)}` : typicalTime ? `Around ${formatTimeOfDay(typicalTime)}` : "No window available", forecastWindow ? "Calculated from the next 24 hours" : typicalTime ? "Based on your charging history — no live forecast yet" : "Log a charge to see your usual window"]] : [["Current intensity", grid.loading ? "Loading…" : "Unavailable", grid.error || "Live provider data is required"], ["Best 2-hour window", "Unavailable", "Waiting for forecast data"]])
    : page === "log"
    ? [["This month", monthCharges.length ? `${monthCharges.length} charge${monthCharges.length === 1 ? "" : "s"} · ${monthKwh.toFixed(1)} kWh` : "No data yet", monthCharges.length ? "Since the start of this month" : "Log your first charge"], ["Recent charge", charges[0] ? `${charges[0].energyKwh} kWh · ${charges[0].city}` : "No data yet", charges[0] ? (charges[0].loggedAt === LEGACY_LOGGED_AT ? "Logged before this update" : `Logged ${new Date(charges[0].loggedAt).toLocaleDateString()}`) : "Your history will appear here"]]
    : page === "rewards"
    ? [["Eco points", points ? String(points) : "No data yet", points ? "10 pts per charge, +5 for a green window" : "Log a charge to start"], ["Current streak", streak ? `${streak} day${streak === 1 ? "" : "s"}` : "No data yet", streak ? "Keep logging daily to grow it" : "Your streak starts today"]]
    : [["Name", profile.name || "Not set", "Tap edit profile to add your name"], ["Vehicle", profile.vehicle || "Not set", "Add your EV model"], ["Location", city, "Grid data is personalized"], ["Monthly impact", monthCharges.length ? `${monthKwh.toFixed(1)} kWh logged` : "No data yet", monthCharges.length ? "Since the start of this month" : "Log a charge to calculate impact"]];
  return <div className="mobile-app secondary-app"><header className="top-app-bar"><Link href="/" aria-label="Back to home">←</Link><strong>ZeroEmit</strong><span aria-hidden /></header><main className="secondary-content"><p className="eyebrow">{data.eyebrow}</p><h1>{data.title}</h1><p className="secondary-intro">{data.intro}</p><section className="secondary-cards">{cards.map(([label, value, detail]) => <article className="card secondary-card" key={label}><h2>{label}</h2><strong>{value}</strong><span>{detail}</span></article>)}</section><button className="forecast-button action-button" onClick={primaryAction}>{actionLabel} <span>→</span></button>{message && <p className="success-message" role="status">{message}</p>}<Link className="text-link" href="/">Back to dashboard</Link></main>{formOpen && <div className="modal-backdrop" role="presentation" onClick={() => setFormOpen(false)}>{page === "log" ? <form className="modal charge-form" onSubmit={submitCharge} onClick={(event) => event.stopPropagation()}><div className="modal-head"><h2>Log a charge</h2><button type="button" className="modal-close" aria-label="Close" onClick={() => setFormOpen(false)}>×</button></div><label>Energy used (kWh)<input name="energy" type="number" min="0.1" step="0.1" defaultValue={typicalEnergy ? typicalEnergy.toFixed(1) : "18"} required /></label><label>When did you charge?<input name="time" type="time" defaultValue={typicalTime ?? "02:30"} required /></label><button className="forecast-button" type="submit">Save charge</button></form> : <form className="modal charge-form" onSubmit={submitProfile} onClick={(event) => event.stopPropagation()}><div className="modal-head"><h2>Edit profile</h2><button type="button" className="modal-close" aria-label="Close" onClick={() => setFormOpen(false)}>×</button></div><label>Name<input name="name" type="text" defaultValue={profile.name} placeholder="Your name" maxLength={60} /></label><label>Vehicle<input name="vehicle" type="text" defaultValue={profile.vehicle} placeholder="e.g. Tata Nexon EV" maxLength={60} /></label><button className="forecast-button" type="submit">Save profile</button></form>}</div>}</div>;
}
