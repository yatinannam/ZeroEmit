"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { displayNameFrom, validateDisplayName, type LeaderboardResponse, type LeaderboardRow, type LeaderboardScope } from "../lib/leaderboard";
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
import { joinedMessage, joinLeaderboard, leaveLeaderboard, useLeaderboardMembership, useLeaderboardVersion } from "./use-leaderboard";

// Shared by the leaderboard page and Profile → Privacy.
export const LEFT_MESSAGE = "You've left the leaderboard";
export const LEAVE_PENDING_MESSAGE = "You've left. Your name will be removed from the board as soon as you're back online.";

// "missing": the server has no such board (a group code that's gone).
export type BoardState<T = LeaderboardResponse> = { status: "loading" } | { status: "ready"; data: T } | { status: "error" } | { status: "unavailable" } | { status: "missing" };

// Fetches a board from `url`; `refresh` bumps (after joining or leaving)
// and accepted syncs (a newly logged charge) reload it. The result is tagged
// with its request so a response never shows under a different board; while
// the same board reloads, the previous result stays up instead of "Loading".
export function useBoardData<T>(url: string, refresh: number): BoardState<T> {
  const version = useLeaderboardVersion();
  const request = `${url}|${refresh}|${version}`;
  const [result, setResult] = useState<{ request: string; view: string; state: BoardState<T> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(url, { cache: "no-store" })
      .then(async (response): Promise<BoardState<T>> => {
        if (response.status === 503) return { status: "unavailable" };
        if (response.status === 404) return { status: "missing" };
        if (!response.ok) return { status: "error" };
        return { status: "ready", data: await response.json() as T };
      })
      .catch((): BoardState<T> => ({ status: "error" }))
      .then((state) => { if (!cancelled) setResult({ request, view: url, state }); });
    return () => { cancelled = true; };
  }, [url, request]);

  if (result?.request === request) return result.state;
  return result?.view === url && result.state.status === "ready" ? result.state : { status: "loading" };
}

function useBoard(scope: LeaderboardScope, me: string | null, refresh: number) {
  const query = new URLSearchParams({ scope });
  if (me) query.set("me", me);
  return useBoardData<LeaderboardResponse>(`/api/leaderboard?${query}`, refresh);
}

function LeaderboardItem({ row }: { row: LeaderboardRow }) {
  return <li className={row.isMe ? "leaderboard-row leaderboard-me" : "leaderboard-row"}>
    <span className={`leaderboard-rank${row.rank <= 3 ? ` leaderboard-top${row.rank}` : ""}`}>{row.rank}</span>
    <span className="leaderboard-name">
      <strong>{row.name}{row.isMe && " (you)"}</strong>
      <small>{ZONE_LABELS[row.zone].replace(/ grid$/, "")} · {row.co2Kg.toFixed(1)} kg CO₂ avoided</small>
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

// `empty`: what to say when nobody has a point yet this month.
export function BoardBody({ state, limit, retry, empty = "Nobody is on the leaderboard yet this month. Join and invite friends who charge an EV." }: { state: BoardState<LeaderboardResponse>; limit: number; retry: () => void; empty?: string }) {
  if (state.status === "loading") return <p className="personal-note">Loading the leaderboard…</p>;
  if (state.status !== "ready") return <p className="personal-note">Couldn&apos;t load the leaderboard. <button type="button" className="text-button" onClick={retry}>Try again</button></p>;
  const { rows, me, total } = state.data;
  // Only members with points this month are listed.
  const notYet = me !== null && me.points === 0;
  if (!rows.length) return <p className="personal-note">{notYet ? "You're in. Log a charge this month to appear on the board." : empty}</p>;
  return <>
    {me && (notYet ? <p className="leaderboard-summary">You&apos;re in. Log a charge this month to appear on the board.</p> : <p className="leaderboard-summary">You&apos;re <b>#{me.rank}</b> of {total} this month</p>)}
    <LeaderboardList rows={rows.slice(0, limit)} me={notYet ? null : me}/>
  </>;
}

// Joining, or with `currentName` renaming an entry this device already has
// (the same member route: a new name under the same id and key).
function NameModal({ currentName, onClose, onDone }: { currentName?: string; onClose: () => void; onDone: () => void }) {
  const { profile, updateProfile } = useProfile();
  const { charges } = useCharges();
  const [place] = useStoredLocation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const renaming = currentName !== undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = validateDisplayName(new FormData(event.currentTarget).get("name"));
    if (!name) { setError("Use 2 to 20 letters or numbers, with single spaces."); return; }
    if (!place) return;
    if (renaming && name === currentName) { onClose(); return; }
    setBusy(true);
    const result = await joinLeaderboard(name, zoneOf(place), charges);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    // No name on the profile yet: the one just chosen is the best guess.
    if (!profile.name.trim()) updateProfile({ ...profile, name });
    showToast(renaming ? `You're now on the board as ${name}` : joinedMessage(result));
    onDone();
  }

  return <Modal title={renaming ? "Change your display name" : "Join the leaderboard"} onClose={onClose} onSubmit={submit}>
    {!renaming && <p>Other ZeroEmit users will see your display name, your grid region, and this month&apos;s Eco points and CO₂ avoided. Nothing else is shown to anyone. If scheduled notifications are on, the server also links your entry to them (your city, streak and weekly totals) to tell you about your rank.</p>}
    <label>Display name<input name="name" type="text" defaultValue={renaming ? currentName : displayNameFrom(profile.name)} placeholder="e.g. Asha" minLength={2} maxLength={20} autoComplete="nickname" required/></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="primary-button" type="submit" disabled={busy}>{busy ? (renaming ? "Saving…" : "Joining…") : renaming ? "Save name" : "Join"}</button>
  </Modal>;
}

// "On the board as Asha · Change", for a device that has joined.
function BoardName({ name, onChange }: { name: string; onChange: () => void }) {
  return <p className="personal-note">On the board as <b>{name}</b> · <button type="button" className="text-button" onClick={onChange}>Change<span className="sr-only"> display name</span></button></p>;
}

// Rewards page: the user's rank and the top 5 for All India. `after` (the
// groups card) shows below it, and hides with it when there's no leaderboard.
export function LeaderboardCard({ after }: { after?: ReactNode }) {
  const membership = useLeaderboardMembership();
  const [joinOpen, setJoinOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const state = useBoard("all", membership?.id ?? null, refresh);
  if (state.status === "unavailable") return null;

  // The join form sits outside the card: inside it, the card's small
  // uppercase section-label style would apply to the form's title too.
  return <>
    <section className="card stat-card leaderboard-card">
      <div className="recommendation-head"><h2>Leaderboard</h2><span className="chip">This month</span></div>
      <BoardBody state={state} limit={5} retry={() => setRefresh((n) => n + 1)}/>
      {membership ? <BoardName name={membership.name} onChange={() => setRenameOpen(true)}/> : <button className="primary-button" onClick={() => setJoinOpen(true)}>Join the leaderboard</button>}
      <Link className="forecast-button" href="/rewards/leaderboard">See full leaderboard <Icon name="arrow" size={18}/></Link>
    </section>
    {after}
    {joinOpen && <NameModal onClose={() => setJoinOpen(false)} onDone={() => { setJoinOpen(false); setRefresh((n) => n + 1); }}/>}
    {renameOpen && membership && <NameModal currentName={membership.name} onClose={() => setRenameOpen(false)} onDone={() => { setRenameOpen(false); setRefresh((n) => n + 1); }}/>}
  </>;
}

// /rewards/leaderboard: top 50, All India or the user's region.
export function LeaderboardScreen() {
  const { place, locationOpen, openLocation, closeLocation, chooseLocation } = useLocationPicker();
  const membership = useLeaderboardMembership();
  const zone = place ? zoneOf(place) : null;
  const [regional, setRegional] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const state = useBoard(regional && zone ? zone : "all", membership?.id ?? null, refresh);

  async function leave() {
    setLeaveOpen(false);
    showToast(await leaveLeaderboard() ? LEFT_MESSAGE : LEAVE_PENDING_MESSAGE);
    setRefresh((n) => n + 1);
  }

  return <div className="mobile-app">
    <TopBar onChooseLocation={openLocation}/>
    <main className="dashboard-content">
      <Link className="back-link" href="/rewards"><Icon name="arrow-left" size={18}/> Rewards</Link>
      <PageHeader eyebrow="Leaderboard" title="Cleaner charging, together." intro="Ranked by Eco points earned this month. Resets on the 1st."/>
      {state.status === "unavailable" ? <p className="personal-note">The leaderboard isn&apos;t available right now.</p> : <>
        <div className="segmented" role="group" aria-label="Leaderboard area">
          <button aria-pressed={!regional} className={regional ? "" : "active"} onClick={() => setRegional(false)}>All India</button>
          <button aria-pressed={regional} className={regional ? "active" : ""} onClick={() => setRegional(true)}>{zone ? ZONE_LABELS[zone] : "My region"}</button>
        </div>
        <section className="card stat-card leaderboard-card"><BoardBody state={state} limit={50} retry={() => setRefresh((n) => n + 1)}/></section>
        {membership && <BoardName name={membership.name} onChange={() => setRenameOpen(true)}/>}
        {membership
          ? <button className="forecast-button action-button" onClick={() => setLeaveOpen(true)}>Leave the leaderboard</button>
          : <button className="primary-button" onClick={() => setJoinOpen(true)}>Join the leaderboard</button>}
        <p className="personal-note">Rankings use Eco points from the charges people log, counting up to 2 charges a day.</p>
      </>}
    </main>
    <BottomNav/>
    {locationOpen && <LocationModal current={place} onClose={closeLocation} onChoose={chooseLocation}/>}
    {joinOpen && <NameModal onClose={() => setJoinOpen(false)} onDone={() => { setJoinOpen(false); setRefresh((n) => n + 1); }}/>}
    {renameOpen && membership && <NameModal currentName={membership.name} onClose={() => setRenameOpen(false)} onDone={() => { setRenameOpen(false); setRefresh((n) => n + 1); }}/>}
    {leaveOpen && <Modal title="Leave the leaderboard?" onClose={() => setLeaveOpen(false)}>
      <p>Your name and this month&apos;s points come off the public board. You can join again later.</p>
      <button className="forecast-button action-button destructive-button" onClick={leave}>Leave the leaderboard</button>
    </Modal>}
  </div>;
}
