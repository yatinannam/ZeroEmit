"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { bestWindow, formatHour, type City } from "../lib/grid";
import { useGridData } from "./use-grid-data";
import { useCharges } from "./use-charges";

const content = {
  forecast: { eyebrow: "CARBON FORECAST", title: "Charge when the grid is cleaner.", intro: "See the best windows for your next charge and make a lower-carbon choice.", cards: [["Current intensity", "", "Live provider data required"], ["Best 2-hour window", "", "Calculated from the next 24 hours"]] },
  log: { eyebrow: "CHARGING HISTORY", title: "Your charging impact.", intro: "Keep track of every charge and the emissions you avoided.", cards: [["This month", "No data yet", "Log your first charge"], ["Recent charge", "No data yet", "Your history will appear here"]] },
  rewards: { eyebrow: "REWARDS", title: "Small choices, real progress.", intro: "Earn points for charging when renewable energy is available.", cards: [["Eco points", "No data yet", "Log a charge to start"], ["Current streak", "No data yet", "Your streak starts today"]] },
  profile: { eyebrow: "YOUR PROFILE", title: "Make every charge count.", intro: "Manage your location, vehicle preferences, and impact goals.", cards: [["Location", "", "Grid data is personalized"], ["Monthly impact", "No data yet", "Log a charge to calculate impact"]] },
} as const;

export function SecondaryScreen({ page }: { page: keyof typeof content }) {
  const data = content[page];
  const [city] = useState<City>(() => { const saved = typeof window === "undefined" ? null : window.localStorage.getItem("zeroemit-location"); return saved === "Bengaluru, India" || saved === "Mumbai, India" ? saved : "Chennai, India"; });
  const grid = useGridData(city);
  const { addCharge } = useCharges();
  const [message, setMessage] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  function submitCharge(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); addCharge({ energyKwh: Number(form.get("energy")), chargedAt: String(form.get("time")), city, carbonIntensity: grid.data?.current?.carbonIntensity ?? null }); setFormOpen(false); setMessage("Charge saved on this device. Your history is updated."); }
  async function primaryAction() {
    if (page === "forecast") { if ("Notification" in window) { const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission; if (permission === "granted") { window.localStorage.setItem("zeroemit-reminder", "true"); setMessage("Notifications enabled. Your reminder preference is saved on this device."); } else setMessage("Notifications are blocked. Enable them in your browser settings to receive reminders."); } else setMessage("This browser does not support notifications."); }
    else if (page === "log") setFormOpen(true);
    else if (page === "rewards") setMessage("Keep going — your next reward is 160 points away.");
    else setMessage("Profile settings are ready to customize.");
  }
  const actionLabel = page === "forecast" ? "Set charging reminder" : page === "log" ? "Log a charge" : page === "rewards" ? "View next reward" : "Edit profile";
  const cards = page === "forecast" ? (grid.data?.available ? [["Current intensity", `${Math.round(grid.data.current?.carbonIntensity || 0)} gCO₂/kWh`, grid.data.current?.isEstimated ? "Estimated · live provider" : "Live provider"], ["Best 2-hour window", bestWindow(grid.data.forecast, 2) ? `${formatHour(bestWindow(grid.data.forecast, 2)!.start.datetime)} – ${formatHour(bestWindow(grid.data.forecast, 2)!.end.datetime)}` : "No window available", "Calculated from the next 24 hours"]] : [["Current intensity", grid.loading ? "Loading…" : "Unavailable", grid.error || "Live provider data is required"], ["Best 2-hour window", "Unavailable", "Waiting for forecast data"]]) : page === "profile" ? [["Location", city, "Grid data is personalized"], ["Monthly impact", "No data yet", "Log a charge to calculate impact"]] : data.cards;
  return <div className="mobile-app secondary-app"><header className="top-app-bar"><Link href="/" aria-label="Back to home">←</Link><strong>ZeroEmit</strong><span aria-hidden /></header><main className="secondary-content"><p className="eyebrow">{data.eyebrow}</p><h1>{data.title}</h1><p className="secondary-intro">{data.intro}</p><section className="secondary-cards">{cards.map(([label, value, detail]) => <article className="card secondary-card" key={label}><h2>{label}</h2><strong>{value}</strong><span>{detail}</span></article>)}</section><button className="forecast-button action-button" onClick={primaryAction}>{actionLabel} <span>→</span></button>{message && <p className="success-message" role="status">{message}</p>}<Link className="text-link" href="/">Back to dashboard</Link></main>{formOpen && <div className="modal-backdrop" role="presentation" onClick={() => setFormOpen(false)}><form className="modal charge-form" onSubmit={submitCharge} onClick={(event) => event.stopPropagation()}><div className="modal-head"><h2>Log a charge</h2><button type="button" className="modal-close" aria-label="Close" onClick={() => setFormOpen(false)}>×</button></div><label>Energy used (kWh)<input name="energy" type="number" min="0.1" step="0.1" defaultValue="18" required /></label><label>When did you charge?<input name="time" type="time" defaultValue="02:30" required /></label><button className="forecast-button" type="submit">Save charge</button></form></div>}</div>;
}
