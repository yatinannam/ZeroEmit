"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useState, type FormEvent } from "react";
import { formatGroupCode, groupInvitePath, MAX_GROUPS_PER_MEMBER, parseGroupCode, validateGroupName, type GroupBoardResponse, type MyGroup } from "../lib/groups";
import { displayNameFrom, validateDisplayName } from "../lib/leaderboard";
import { zoneOf } from "../lib/places";
import { BottomNav, TopBar } from "./app-shell";
import { Icon } from "./icon-set";
import { BoardBody, useBoardData } from "./leaderboard";
import { LocationModal } from "./location-modal";
import { Modal } from "./modal";
import { PageHeader } from "./page-header";
import { showToast } from "./toast";
import { useCharges } from "./use-charges";
import { createGroup, joinGroup, leaveGroup, useGroupsVersion, useMyGroups, type GroupCall } from "./use-groups";
import { joinLeaderboard, useLeaderboardMembership } from "./use-leaderboard";
import { useStoredLocation } from "./use-location";
import { useLocationPicker } from "./use-location-picker";
import { useProfile } from "./use-profile";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

// "#2 of 8 this month · 12 members", or how big it is before any points.
function standing(group: MyGroup) {
  return group.rank ? `#${group.rank} of ${group.ranked} this month · ${plural(group.members, "member")}` : `${plural(group.members, "member")} · no points from you yet this month`;
}

// Create a group, or join one by code. A device that isn't on the
// leaderboard yet joins it in the same step: groups rank leaderboard entries.
// `code` fixes the group to join (opened from an invite or a group's page).
function GroupModal({ mode, code, groupName, onClose, onDone }: { mode: "create" | "join"; code?: string; groupName?: string; onClose: () => void; onDone: (code: string) => void }) {
  const membership = useLeaderboardMembership();
  const { profile, updateProfile } = useProfile();
  const { charges } = useCharges();
  const [place] = useStoredLocation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const displayName = membership ? null : validateDisplayName(form.get("displayName"));
    if (!membership && !displayName) { setError("Use 2 to 20 letters or numbers in your display name, with single spaces."); return; }
    const groupNameValue = mode === "create" ? validateGroupName(form.get("groupName")) : null;
    if (mode === "create" && !groupNameValue) { setError("Use 2 to 30 letters or numbers in the group name, with single spaces."); return; }
    const joinCode = mode === "join" ? code ?? parseGroupCode(form.get("code")) : null;
    if (mode === "join" && !joinCode) { setError("A group code is 6 letters and numbers, like ABC-234."); return; }
    if (!place) return;
    setBusy(true);
    setError(null);
    if (displayName) {
      const joined = await joinLeaderboard(displayName, zoneOf(place), charges);
      if (!joined.ok) { setBusy(false); setError(joined.error); return; }
      if (!profile.name.trim()) updateProfile({ ...profile, name: displayName });
    }
    const attempt = () => (mode === "create" ? createGroup(groupNameValue!) : joinGroup(joinCode!));
    let result: GroupCall<{ code: string; name: string }> = await attempt();
    // The server let this device's entry expire (70 days without a sync):
    // send it again under the same id and key, then try once more.
    if (!result.ok && result.code === "not-member" && membership) {
      const rejoined = await joinLeaderboard(membership.name, zoneOf(place), charges);
      if (rejoined.ok) result = await attempt();
    }
    setBusy(false);
    if (!result.ok) {
      // A first join already put them on the public board; say so, so it's no surprise.
      setError(displayName ? `${result.error} You're on the leaderboard now; you can leave it from Rewards.` : result.error);
      return;
    }
    showToast(mode === "create" ? `${result.value.name} is ready. Share its code to invite people.` : `You've joined ${result.value.name}`);
    onDone(result.value.code);
  }

  const title = mode === "create" ? "Create a group" : groupName ? `Join ${groupName}` : "Join a group";
  return <Modal title={title} onClose={onClose} onSubmit={submit}>
    <p>{mode === "create" ? "An invite-only board for your class, office or housing society. You'll get a code to share." : "Everyone in the group sees each other's display name, region, and this month's Eco points and CO₂ avoided."}</p>
    {!membership && <p className="group-note">Groups rank leaderboard entries, so you&apos;ll join the leaderboard too: your display name, region, Eco points and CO₂ avoided also appear on the public board. You can leave any time.</p>}
    {!membership && <label>Your display name<input name="displayName" type="text" defaultValue={displayNameFrom(profile.name)} placeholder="e.g. Asha" minLength={2} maxLength={20} autoComplete="nickname" required/></label>}
    {mode === "create" && <label>Group name<input name="groupName" type="text" placeholder="e.g. Pune Office EV Club" minLength={2} maxLength={30} required/></label>}
    {mode === "join" && !code && <label>Group code<input name="code" type="text" placeholder="ABC-234" maxLength={9} autoCapitalize="characters" autoComplete="off" spellCheck={false} required className="code-input"/></label>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="primary-button" type="submit" disabled={busy}>{busy ? (mode === "create" ? "Creating…" : "Joining…") : mode === "create" ? "Create group" : "Join group"}</button>
  </Modal>;
}

// Rewards page: the device's groups, and the way to make or join one.
export function GroupsCard() {
  const router = useRouter();
  const groups = useMyGroups();
  const [modal, setModal] = useState<"create" | "join" | null>(null);
  const list = groups.status === "ready" ? groups.groups : [];
  const atLimit = list.length >= MAX_GROUPS_PER_MEMBER;

  return <>
    <section className="card stat-card groups-card" aria-labelledby="groups-title">
      <div className="recommendation-head"><h2 id="groups-title">Groups</h2><span className="chip">Invite only</span></div>
      {groups.status === "loading" ? <div className="card activity-item skeleton-item" aria-hidden="true"/>
        : groups.status === "error" ? <p className="personal-note">Couldn&apos;t load your groups. <button type="button" className="text-button" onClick={groups.retry}>Try again</button></p>
        : list.length ? <ul className="group-list">{list.map((group) => <li key={group.code}>
          <Link className="group-row" href={`/rewards/groups?code=${group.code}`}>
            <span className="round-icon"><Icon name="users" size={18}/></span>
            <span className="group-text"><strong>{group.name}</strong><small>{standing(group)}</small></span>
            <Icon name="chevron-right" size={18}/>
          </Link>
        </li>)}</ul>
        : <p className="personal-note groups-intro">Challenge friends, classmates or colleagues on a board of your own. Create a group and share its code, or join one with a code you were sent.</p>}
      <div className="group-actions">
        {!atLimit && <button type="button" className="primary-button" onClick={() => setModal("create")}><Icon name="plus" size={18}/> Create a group</button>}
        <button type="button" className="forecast-button action-button" onClick={() => setModal("join")}>Join with a code</button>
      </div>
    </section>
    {modal && <GroupModal mode={modal} onClose={() => setModal(null)} onDone={(code) => { setModal(null); router.push(`/rewards/groups?code=${code}`); }}/>}
  </>;
}

// Share sheet where there is one (phones), the clipboard otherwise.
async function shareInvite(code: string, name: string) {
  const url = new URL(groupInvitePath(code), window.location.origin).href;
  const text = `Join my ZeroEmit group "${name}" and see who charges cleanest this month. Code ${formatGroupCode(code)}.`;
  if (navigator.share) {
    try { await navigator.share({ title: `Join ${name} on ZeroEmit`, text, url }); return; }
    catch (error) { if ((error as DOMException).name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(`${text} ${url}`); showToast("Invite link copied"); }
  catch { showToast(`Share this code: ${formatGroupCode(code)}`); }
}

async function copyCode(code: string) {
  try { await navigator.clipboard.writeText(formatGroupCode(code)); showToast("Code copied"); }
  catch { showToast(`The code is ${formatGroupCode(code)}`); }
}

// /rewards/groups?code=ABC234: one group's board. `joining` (from an invite
// link, ?join=) opens the join sheet straight away for someone not in it.
export function GroupScreen({ rawCode, joining }: { rawCode: string | null; joining: boolean }) {
  const router = useRouter();
  const { place, ready, locationOpen, openLocation, closeLocation, chooseLocation } = useLocationPicker();
  const membership = useLeaderboardMembership();
  const myGroups = useMyGroups();
  const groupsVersion = useGroupsVersion();
  const [refresh, setRefresh] = useState(0);
  const [joinOpen, setJoinOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const code = parseGroupCode(rawCode);
  const url = code ? `/api/leaderboard/groups?code=${code}${membership ? `&me=${membership.id}` : ""}` : null;
  const state = useBoardData<GroupBoardResponse>(url, refresh + groupsVersion);
  const group = state.status === "ready" ? state.data.group : null;
  // Known once this device's own list has loaded (or it has no entry at all).
  const isMember = myGroups.status === "ready" ? myGroups.groups.some((mine) => mine.code === code) : myGroups.status === "idle" ? false : null;

  // From an invite: open the join sheet once it's clear this device isn't in
  // the group, then drop ?join= so a refresh or Back doesn't reopen it. On a
  // new device, only after first-run setup (`ready`): a sheet under the
  // setup screen would trap the keyboard there.
  const openInvite = useEffectEvent(() => { setJoinOpen(true); router.replace(`/rewards/groups?code=${code}`, { scroll: false }); });
  useEffect(() => {
    if (!joining || !ready || !group || isMember !== false) return;
    const timer = setTimeout(openInvite, 0);
    return () => clearTimeout(timer);
  }, [joining, ready, group, isMember]);

  async function leave() {
    if (!code) return;
    setLeaveOpen(false);
    const result = await leaveGroup(code);
    if (!result.ok) { showToast(result.error); return; }
    showToast(`You've left ${group?.name ?? "the group"}`);
    router.push("/rewards");
  }

  const notFound = !code || state.status === "missing";
  return <div className="mobile-app">
    <TopBar onChooseLocation={openLocation}/>
    <main className="dashboard-content">
      <Link className="back-link" href="/rewards"><Icon name="arrow-left" size={18}/> Rewards</Link>
      {notFound ? <>
        <PageHeader eyebrow="Group" title="No group with that code." intro="Check the code with whoever sent it. A group closes after four months without any activity."/>
        <Link className="primary-button" href="/rewards">Back to Rewards</Link>
      </> : state.status === "unavailable" ? <PageHeader eyebrow="Group" title="Groups aren't available right now." intro="Try again later."/>
      : <>
        <PageHeader eyebrow="Group challenge" title={group?.name ?? " "} intro="Ranked by Eco points earned this month. Resets on the 1st."/>
        <section className="card stat-card leaderboard-card">
          <div className="recommendation-head"><h2>This month</h2>{group && <span className="chip">{plural(group.members, "member")}</span>}</div>
          <BoardBody state={state} limit={50} retry={() => setRefresh((n) => n + 1)} empty="Nobody in this group has a point yet this month. Log a charge to get on the board."/>
        </section>
        {group && isMember && <section className="card stat-card invite-card" aria-labelledby="invite-title">
          <h2 id="invite-title">Invite people</h2>
          <button type="button" className="group-code" onClick={() => copyCode(group.code)} aria-label={`Group code ${formatGroupCode(group.code)}. Copy`}><span>{formatGroupCode(group.code)}</span><Icon name="copy" size={18}/></button>
          <p className="personal-note">Anyone with the code can join (up to 50 people) and see this board.</p>
          <button type="button" className="primary-button" onClick={() => shareInvite(group.code, group.name)}><Icon name="share" size={18}/> Share invite</button>
        </section>}
        {group && isMember === false && <button type="button" className="primary-button" onClick={() => setJoinOpen(true)}><Icon name="users" size={18}/> Join this group</button>}
        {group && myGroups.status === "error" && <p className="personal-note">Couldn&apos;t check whether you&apos;re in this group. <button type="button" className="text-button" onClick={myGroups.retry}>Try again</button></p>}
        {group && isMember && <button type="button" className="forecast-button action-button" onClick={() => setLeaveOpen(true)}>Leave group</button>}
      </>}
    </main>
    <BottomNav/>
    {locationOpen && <LocationModal current={place} onClose={closeLocation} onChoose={chooseLocation}/>}
    {joinOpen && code && <GroupModal mode="join" code={code} groupName={group?.name} onClose={() => setJoinOpen(false)} onDone={() => { setJoinOpen(false); setRefresh((n) => n + 1); }}/>}
    {leaveOpen && <Modal title={`Leave ${group?.name ?? "this group"}?`} onClose={() => setLeaveOpen(false)}>
      <p>You come off this group&apos;s board. You stay on the public leaderboard and in your other groups, and you can rejoin with the code.</p>
      <button type="button" className="forecast-button action-button destructive-button" onClick={leave}>Leave group</button>
    </Modal>}
  </div>;
}

// /rewards/groups with no code: just the list.
export function GroupsHub() {
  const { place, locationOpen, openLocation, closeLocation, chooseLocation } = useLocationPicker();
  return <div className="mobile-app">
    <TopBar onChooseLocation={openLocation}/>
    <main className="dashboard-content">
      <Link className="back-link" href="/rewards"><Icon name="arrow-left" size={18}/> Rewards</Link>
      <PageHeader eyebrow="Group challenges" title="Charge cleaner with your crew." intro="Invite-only monthly boards for a class, an office or a housing society."/>
      <GroupsCard/>
    </main>
    <BottomNav/>
    {locationOpen && <LocationModal current={place} onClose={closeLocation} onChoose={chooseLocation}/>}
  </div>;
}
