"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { validateDisplayName, type LeaderboardResponse, type LeaderboardRow, type LeaderboardScope } from "../lib/leaderboard";
import { ZONE_LABELS, zoneOf } from "../lib/places";
import { BottomNav, TopBar } from "./app-shell";
import { Icon } from "./icon-set";
import { LocationModal } from "./location-modal";
import { Modal } from "./modal";
import { PageHeader } from "./page-header";
import { showToast } from "./toast";
import { useCharges } from "./use-charges";
import { useStoredLocation } from "./use-location";
import { useLocationPicker } from "./use-location-picker";
import { useProfile } from "./use-profile";
import { joinLeaderboard, leaveLeaderboard, useLeaderboardMembership } from "./use-leaderboard";

type BoardState = { status: "loading" } | { status: "ready"; data: LeaderboardResponse } | { status: "error" } | { status: "unavailable" };

// Fetches the board for `scope`; `refresh` bumps force a reload (after joining
// or leaving). The result is tagged with its request so a stale response never
// shows under a newer scope.
function useBoard(scope: LeaderboardScope, me: string | null, refresh: number): BoardState {
  const request = `${scope}|${me ?? ""}|${refresh}`;
  const [result, setResult] = useState<{ request: string; state: BoardState } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ scope });
    if (me) query.set("me", me);
    fetch(`/api/leaderboard?${query}`, { cache: "no-store" })
      .then(async (response): Promise<BoardState> => {
        if (response.status === 503) return { status: "unavailable" };
        if (!response.ok) return { status: "error" };
        return { status: "ready", data: await response.json() as LeaderboardResponse };
      })
      .catch((): BoardState => ({ status: "error" }))
      .then((state) => { if (!cancelled) setResult({ request, state }); });
    return () => { cancelled = true; };
  }, [scope, me, request]);

  return result?.request === request ? result.state : { status: "loading" };
}

function LeaderboardItem({ row }: { row: LeaderboardRow }) {
  return <li className={row.isMe ? "leaderboard-row leaderboard-me" : "leaderboard-row"}>
    <span className={`leaderboard-rank${row.rank <= 3 ? ` leaderboard-top${row.rank}` : ""}`}>{row.rank}</span>
    <span className="leaderboard-name">
      <strong>{row.name}{row.isMe && " (you)"}</strong>
      <small>{ZONE_LABELS[row.zone]} · {row.co2Kg.toFixed(1)} kg CO₂ avoided</small>
    </span>
    <b className="leaderboard-points">{row.points}<small> pts</small></b>
  </li>;
}

// The top `rows`, plus the user's own row after a gap when it isn't among them.
function LeaderboardList({ rows, me }: { rows: LeaderboardRow[]; me: LeaderboardRow | null }) {
  const showMe = me !== null && !rows.some((row) => row.isMe);
  return <ol className="leaderboard-list">
    {rows.map((row) => <LeaderboardItem key={`${row.rank}-${row.name}`} row={row}/>)}
    {showMe && <li className="leaderboard-gap" aria-hidden="true">…</li>}
    {showMe && <LeaderboardItem row={me}/>}
  </ol>;
}

function BoardBody({ state, limit }: { state: BoardState; limit: number }) {
  if (state.status === "loading") return <p className="personal-note">Loading the leaderboard…</p>;
  if (state.status !== "ready") return <p className="personal-note">Couldn&apos;t load the leaderboard. Check your connection and try again.</p>;
  const { rows, me, total } = state.data;
  if (!rows.length) return <p className="personal-note">Nobody is on the leaderboard yet this month. Join and invite friends who charge an EV.</p>;
  return <>
    {me && <p className="leaderboard-summary">You&apos;re <b>#{me.rank}</b> of {total} this month</p>}
    <LeaderboardList rows={rows.slice(0, limit)} me={me}/>
  </>;
}

function JoinModal({ onClose, onJoined }: { onClose: () => void; onJoined: () => void }) {
  const { profile } = useProfile();
  const { charges } = useCharges();
  const [place] = useStoredLocation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = validateDisplayName(new FormData(event.currentTarget).get("name"));
    if (!name) { setError("Use 2 to 20 letters or numbers, with single spaces."); return; }
    if (!place) return;
    setBusy(true);
    const result = await joinLeaderboard(name, zoneOf(place), charges);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    showToast(`You're #${result.rank} on the leaderboard this month`);
    onJoined();
  }

  return <Modal title="Join the leaderboard" onClose={onClose} onSubmit={submit}>
    <p>Other ZeroEmit users will see your display name, your grid region, and this month&apos;s Eco points and CO₂ avoided. Nothing else leaves this device.</p>
    <label>Display name<input name="name" type="text" defaultValue={profile.name.trim().split(/\s+/)[0] ?? ""} placeholder="e.g. Asha" minLength={2} maxLength={20} autoComplete="nickname" required/></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="primary-button" type="submit" disabled={busy}>{busy ? "Joining…" : "Join"}</button>
  </Modal>;
}

// Rewards page: the user's rank and the top 5 for All India.
export function LeaderboardCard() {
  const membership = useLeaderboardMembership();
  const [joinOpen, setJoinOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const state = useBoard("all", membership?.id ?? null, refresh);
  if (state.status === "unavailable") return null;

  return <section className="card stat-card leaderboard-card">
    <div className="recommendation-head"><h2>Leaderboard</h2><span className="chip">This month</span></div>
    <BoardBody state={state} limit={5}/>
    {!membership && <button className="primary-button" onClick={() => setJoinOpen(true)}>Join the leaderboard</button>}
    <Link className="forecast-button" href="/rewards/leaderboard">See full leaderboard <Icon name="arrow" size={18}/></Link>
    {joinOpen && <JoinModal onClose={() => setJoinOpen(false)} onJoined={() => { setJoinOpen(false); setRefresh((n) => n + 1); }}/>}
  </section>;
}

// /rewards/leaderboard: top 50, All India or the user's region.
export function LeaderboardScreen() {
  const { place, locationOpen, openLocation, closeLocation, chooseLocation } = useLocationPicker();
  const membership = useLeaderboardMembership();
  const zone = place ? zoneOf(place) : null;
  const [regional, setRegional] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const state = useBoard(regional && zone ? zone : "all", membership?.id ?? null, refresh);

  async function leave() {
    await leaveLeaderboard();
    showToast("You've left the leaderboard");
    setRefresh((n) => n + 1);
  }

  return <div className="mobile-app">
    <TopBar onChooseLocation={openLocation}/>
    <main className="dashboard-content">
      <Link className="back-link" href="/rewards"><Icon name="arrow-left" size={18}/> Rewards</Link>
      <PageHeader eyebrow="Leaderboard" title="Cleaner charging, together." intro="Ranked by Eco points earned this month. Resets on the 1st."/>
      {state.status === "unavailable" ? <p className="personal-note">The leaderboard isn&apos;t available right now.</p> : <>
        <div className="segmented" role="tablist" aria-label="Leaderboard area">
          <button role="tab" aria-selected={!regional} className={regional ? "" : "active"} onClick={() => setRegional(false)}>All India</button>
          <button role="tab" aria-selected={regional} className={regional ? "active" : ""} onClick={() => setRegional(true)}>{zone ? ZONE_LABELS[zone] : "My region"}</button>
        </div>
        <section className="card stat-card leaderboard-card"><BoardBody state={state} limit={50}/></section>
        {membership
          ? <button className="forecast-button action-button" onClick={leave}>Leave the leaderboard</button>
          : <button className="primary-button" onClick={() => setJoinOpen(true)}>Join the leaderboard</button>}
        <p className="personal-note">Rankings use Eco points from the charges people log, counting up to 2 charges a day.</p>
      </>}
    </main>
    <BottomNav/>
    {locationOpen && <LocationModal current={place} onClose={closeLocation} onChoose={chooseLocation}/>}
    {joinOpen && <JoinModal onClose={() => setJoinOpen(false)} onJoined={() => { setJoinOpen(false); setRefresh((n) => n + 1); }}/>}
  </div>;
}
