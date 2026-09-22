"use client";

import { currentRewardTier, currentStreakDays, estimatedCarbonSavedGrams, totalPoints } from "../lib/rewards";
import { useCharges } from "./use-charges";
import { useLocationPicker } from "./use-location-picker";
import { Icon } from "./icon-set";
import { BottomNav, TopBar } from "./app-shell";
import { LocationModal } from "./location-modal";
import { PageHeader } from "./page-header";

const ACHIEVEMENTS = [
  { key: "first-charge", title: "First Green Charge", icon: "bolt", test: (chargeCount: number) => chargeCount >= 1 },
  { key: "streak-7", title: "7 Day Streak", icon: "fire", test: (_: number, streak: number) => streak >= 7 },
] as const;

export function RewardsScreen() {
  const { location, locationOpen, openLocation, closeLocation, chooseLocation } = useLocationPicker();
  const { charges } = useCharges();
  const points = totalPoints(charges);
  const streak = currentStreakDays(charges);
  const { current: tier, next: nextTier } = currentRewardTier(points);
  const progressToNext = nextTier ? Math.min(1, (points - tier.threshold) / (nextTier.threshold - tier.threshold)) : 1;
  const savedGrams = estimatedCarbonSavedGrams(charges);

  return <div className="mobile-app">
    <TopBar onChooseLocation={openLocation}/>
    <main className="dashboard-content">
      <PageHeader eyebrow="Rewards" title="Your eco journey." intro="Level up by charging when the grid is cleaner."/>

      <section className="card stat-card">
        <div className="recommendation-head"><h2>Eco points</h2>{streak > 0 && <span className="recommended"><Icon name="fire" size={15}/> {streak} day streak</span>}</div>
        <strong className="stat-figure">{points || 0} <small>pts</small></strong>
        <div className="tier-row"><b>{tier.name}</b>{nextTier && <span>{points} / {nextTier.threshold} to {nextTier.name}</span>}</div>
        <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.round(progressToNext * 100)}%` }}/></div>
      </section>

      <section className="activity">
        <h2>Achievements</h2>
        <div className="metrics-grid">
          {ACHIEVEMENTS.map((achievement) => {
            const unlocked = achievement.test(charges.length, streak);
            return <div key={achievement.key} className={`card badge-card${unlocked ? "" : " badge-locked"}`}>
              <span className="round-icon badge-icon"><Icon name={achievement.icon} size={22}/></span>
              <strong>{achievement.title}</strong>
              <span>{unlocked ? "Completed" : "Locked"}</span>
            </div>;
          })}
        </div>
      </section>

      <section className="card stat-card">
        <h2>Estimated CO₂ avoided</h2>
        <strong className="stat-figure">{(savedGrams / 1000).toFixed(1)} <small>kg</small></strong>
        <p className="personal-note">Vs. charging without timing it around the grid</p>
      </section>
    </main>
    <BottomNav/>
    {locationOpen && <LocationModal current={location} onClose={closeLocation} onChoose={chooseLocation}/>}
  </div>;
}
