"use client";

import { achievements, currentRewardTier, currentStreakDays, estimatedCarbonSavedGrams, POINTS_PER_CHARGE, REWARD_TIERS, totalPoints } from "../lib/rewards";
import { TIMING_BONUS } from "../lib/timing";
import { EQUIVALENTS_NOTE, equivalentsSentence } from "../lib/equivalents";
import { useCharges } from "./use-charges";
import { useLocationPicker } from "./use-location-picker";
import { Icon, type IconName } from "./icon-set";
import { BottomNav, TopBar } from "./app-shell";
import { LocationModal } from "./location-modal";
import { PageHeader } from "./page-header";
import { LeaderboardCard } from "./leaderboard";
import { CountUp, ProgressFill } from "./motion";

const BADGE_ICONS: Record<string, IconName> = {
  "first-green": "bolt", "green-10": "check", "streak-7": "fire", "streak-30": "fire",
  "peak-dodger": "clock", "co2-10": "leaf", "co2-50": "tree", "kwh-100": "target",
};

const EARN_ROWS: { icon: IconName; title: string; detail: string; reward: string }[] = [
  { icon: "history", title: "Log a charge", detail: "Every charge you log", reward: `+${POINTS_PER_CHARGE}` },
  { icon: "bolt", title: "Charge in a best window", detail: "One of the day's 3 cleanest 2-hour windows for your region", reward: `+${TIMING_BONUS.best} bonus` },
  { icon: "clock", title: "Charge at a cleaner hour", detail: "Any hour cleaner than your region's daily average", reward: `+${TIMING_BONUS.cleaner} bonus` },
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
      <section className="card stat-card">
        <div className="recommendation-head"><h2>Eco points</h2>{streak > 0 && <span className="recommended"><Icon name="fire" size={15}/> {streak} day{streak === 1 ? "" : "s"} in a row</span>}</div>
        <strong className="stat-figure"><CountUp value={points}/> <small>pts</small></strong>
        <div className="tier-row"><b>{tier.name}</b>{nextTier && <span>{points} / {nextTier.threshold} to {nextTier.name}</span>}</div>
        <div className="progress-track" role="progressbar" aria-label={nextTier ? `Progress to ${nextTier.name}` : "Top level reached"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressToNext * 100)}><ProgressFill percent={progressToNext * 100}/></div>
      </section>

      <LeaderboardCard/>

      <section className="activity">
        <div className="section-head"><h2>Achievements</h2><span className="chip">{unlockedCount} of {badges.length} unlocked</span></div>
        <div className="metrics-grid badge-grid">
          {badges.map((badge) => <div key={badge.key} className={`card badge-card${badge.unlocked ? "" : " badge-locked"}`}>
            <span className="round-icon badge-icon"><Icon name={BADGE_ICONS[badge.key] ?? "award"} size={22}/></span>
            <strong>{badge.title}</strong>
            {badge.unlocked
              ? <span>Completed</span>
              : <>
                <small className="badge-hint">{badge.description}</small>
                <div className="progress-track badge-progress" aria-hidden="true"><ProgressFill percent={(badge.current / badge.target) * 100}/></div>
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
        <strong className="stat-figure"><CountUp value={savedGrams / 1000} decimals={1}/> <small>kg</small></strong>
        <p className="personal-note">Vs. charging without timing it around the grid</p>
        {equivalentsSentence(savedGrams / 1000) && <p className="equivalents">{equivalentsSentence(savedGrams / 1000)}</p>}
        {equivalentsSentence(savedGrams / 1000) && <p className="personal-note equivalents-note">{EQUIVALENTS_NOTE}</p>}
      </section>
    </main>
    <BottomNav/>
    {locationOpen && <LocationModal current={place} onClose={closeLocation} onChoose={chooseLocation}/>}
  </div>;
}
