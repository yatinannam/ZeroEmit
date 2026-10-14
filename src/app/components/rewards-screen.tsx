"use client";

import { achievements, currentRewardTier, currentStreakDays, estimatedCarbonSavedGrams, GREEN_CHARGE_BONUS, POINTS_PER_CHARGE, REWARD_TIERS, totalPoints } from "../lib/rewards";
import { useCharges } from "./use-charges";
import { useLocationPicker } from "./use-location-picker";
import { Icon, type IconName } from "./icon-set";
import { BottomNav, TopBar } from "./app-shell";
import { LocationModal } from "./location-modal";
import { PageHeader } from "./page-header";
import { LeaderboardCard } from "./leaderboard";

const BADGE_ICONS: Record<string, IconName> = {
  "first-green": "bolt", "green-10": "check", "streak-7": "fire", "streak-30": "fire",
  "peak-dodger": "clock", "co2-10": "tree", "co2-50": "award", "kwh-100": "target",
};

const EARN_ROWS: { icon: IconName; title: string; detail: string; reward: string }[] = [
  { icon: "history", title: "Log a charge", detail: "Every charge you log", reward: `+${POINTS_PER_CHARGE}` },
  { icon: "bolt", title: "Charge in green hours", detail: "When the grid is running cleanest", reward: `+${GREEN_CHARGE_BONUS} bonus` },
  { icon: "fire", title: "Keep a streak", detail: "Charge on consecutive days", reward: "Badges" },
];

export function RewardsScreen() {
  const { place, locationOpen, openLocation, closeLocation, chooseLocation } = useLocationPicker();
  const { charges } = useCharges();
  const points = totalPoints(charges);
  const streak = currentStreakDays(charges);
  const { current: tier, next: nextTier } = currentRewardTier(points);
  const progressToNext = nextTier ? Math.min(1, (points - tier.threshold) / (nextTier.threshold - tier.threshold)) : 1;
  const savedGrams = estimatedCarbonSavedGrams(charges);
  const badges = achievements(charges, streak);
  const unlockedCount = badges.filter((badge) => badge.unlocked).length;

  return <div className="mobile-app">
    <TopBar onChooseLocation={openLocation}/>
    <main className="dashboard-content">
      <PageHeader eyebrow="Rewards" title="Your eco journey." intro="Level up by charging when the grid is cleaner."/>
      <LeaderboardCard/>

      <section className="card stat-card">
        <div className="recommendation-head"><h2>Eco points</h2>{streak > 0 && <span className="recommended"><Icon name="fire" size={15}/> {streak} day{streak === 1 ? "" : "s"} in a row</span>}</div>
        <strong className="stat-figure">{points || 0} <small>pts</small></strong>
        <div className="tier-row"><b>{tier.name}</b>{nextTier && <span>{points} / {nextTier.threshold} to {nextTier.name}</span>}</div>
        <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.round(progressToNext * 100)}%` }}/></div>
      </section>

      <section className="activity">
        <div className="section-head"><h2>Achievements</h2><span className="chip">{unlockedCount} of {badges.length} unlocked</span></div>
        <div className="metrics-grid badge-grid">
          {badges.map((badge) => <div key={badge.key} className={`card badge-card${badge.unlocked ? "" : " badge-locked"}`}>
            <span className="round-icon badge-icon"><Icon name={BADGE_ICONS[badge.key]} size={22}/></span>
            <strong>{badge.title}</strong>
            {badge.unlocked
              ? <span>Completed</span>
              : <>
                <small className="badge-hint">{badge.description}</small>
                <div className="progress-track badge-progress" aria-hidden="true"><div className="progress-fill" style={{ width: `${Math.round((badge.current / badge.target) * 100)}%` }}/></div>
                <span>{Math.floor(badge.current)} of {badge.target}{badge.unit}</span>
              </>}
          </div>)}
        </div>
      </section>

      <section className="card stat-card earn-card">
        <h2>How to earn</h2>
        <ul className="earn-list">
          {EARN_ROWS.map((row) => <li key={row.title}>
            <span className="round-icon"><Icon name={row.icon} size={18}/></span>
            <span><strong>{row.title}</strong><small>{row.detail}</small></span>
            <b>{row.reward}</b>
          </li>)}
        </ul>
        <h3>Levels</h3>
        <ol className="level-list">
          {REWARD_TIERS.map((level) => <li key={level.name} className={level.name === tier.name ? "level-current" : points >= level.threshold ? "level-reached" : ""}>
            <strong>{level.name}</strong><span>{level.threshold} pts</span>
          </li>)}
        </ol>
      </section>

      <section className="card stat-card">
        <h2>Estimated CO₂ avoided</h2>
        <strong className="stat-figure">{(savedGrams / 1000).toFixed(1)} <small>kg</small></strong>
        <p className="personal-note">Vs. charging without timing it around the grid</p>
      </section>
    </main>
    <BottomNav/>
    {locationOpen && <LocationModal current={place} onClose={closeLocation} onChoose={chooseLocation}/>}
  </div>;
}
