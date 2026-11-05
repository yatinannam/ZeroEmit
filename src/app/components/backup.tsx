"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent } from "react";
import { BACKUP_TOO_BIG, backupFilename, MAX_BACKUP_BYTES, makeBackup, parseBackup, restorePlan, type ParsedBackup } from "../lib/backup";
import { Icon } from "./icon-set";
import { createLocalStorageStore } from "./local-storage-store";
import { Modal } from "./modal";
import { showToast } from "./toast";

// When this device last saved a backup (ISO), for the Profile row.
const lastBackup = createLocalStorageStore<string | null>("zeroemit-last-backup", (raw) => (Number.isNaN(Date.parse(raw)) ? null : raw), (value) => value ?? "", null);
export function useLastBackup() {
  return useSyncExternalStore(lastBackup.subscribe, lastBackup.getSnapshot, lastBackup.getServerSnapshot);
}

function storageEntries(): [string, string][] {
  try {
    return Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index)).filter((key): key is string => key !== null).map((key) => [key, window.localStorage.getItem(key) ?? ""]);
  } catch { return []; }
}

const shortDate = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

// The file to hand to the share sheet. Chrome on Android only shares a few
// file types, and JSON isn't one of them, so there it goes as plain text
// (restoring reads either). Null when this browser can't share files at all.
function shareableFile(contents: () => string) {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") return null;
  const name = backupFilename();
  const asJson = new File(["{}"], name, { type: "application/json" });
  if (navigator.canShare({ files: [asJson] })) return () => new File([contents()], name, { type: "application/json" });
  const textName = name.replace(/\.json$/, ".txt");
  if (navigator.canShare({ files: [new File(["{}"], textName, { type: "text/plain" })] })) return () => new File([contents()], textName, { type: "text/plain" });
  return null;
}
const backupJson = () => JSON.stringify(makeBackup(storageEntries()));

// Profile → Back up & restore: save everything to a file (or the share sheet,
// to send it to another phone), or bring a file back.
export function BackupModal({ onClose }: { onClose: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const last = useLastBackup();
  const [picked, setPicked] = useState<Extract<ParsedBackup, { ok: true }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const makeShareFile = shareableFile(backupJson);
  const canShare = makeShareFile !== null;

  function file() {
    return new File([backupJson()], backupFilename(), { type: "application/json" });
  }

  function saved() {
    lastBackup.write(new Date().toISOString());
  }

  function download() {
    const backup = file();
    const url = URL.createObjectURL(backup);
    const link = document.createElement("a");
    link.href = url;
    link.download = backup.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    saved();
    showToast("Backup saved. Keep the file somewhere safe.");
  }

  // Straight from the tap: Safari only allows share() inside the gesture.
  async function share() {
    if (!makeShareFile) return;
    try { await navigator.share({ files: [makeShareFile()], title: "ZeroEmit backup" }); saved(); }
    catch (reason) { if ((reason as DOMException).name !== "AbortError") showToast("Couldn't open the share sheet. Save the file instead."); }
  }

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen) return;
    // Before reading it: a phone shouldn't load a whole video to say no.
    if (chosen.size > MAX_BACKUP_BYTES) { setError(BACKUP_TOO_BIG); setPicked(null); return; }
    const result = parseBackup(await chosen.text().catch(() => ""));
    if (!result.ok) { setError(result.error); setPicked(null); return; }
    setError(null);
    setPicked(result);
  }

  function restore() {
    if (!picked) return;
    const current = Object.fromEntries(storageEntries());
    const { set, remove } = restorePlan(current, picked.backup, crypto.randomUUID());
    try {
      Object.entries(set).forEach(([key, value]) => window.localStorage.setItem(key, value));
      remove.forEach((key) => window.localStorage.removeItem(key));
    } catch {
      // Storage full or blocked partway: put back what was there, so the
      // device isn't left half old, half restored.
      try {
        for (const key of [...Object.keys(set), ...remove]) {
          if (key in current) window.localStorage.setItem(key, current[key]);
          else window.localStorage.removeItem(key);
        }
      } catch { /* nothing more to do */ }
      setPicked(null);
      setError("This browser wouldn't let ZeroEmit save the data. Check it isn't in private mode and the phone has space, then try again.");
      return;
    }
    // Every store caches what it read: a full page load (not a client-side
    // navigation) starts the whole app again on the restored data.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a fresh load is the point
    window.location.assign("/");
  }


  // The sheet swaps its content in place; move focus to it so the new title
  // is read out and focus isn't left on a button that's gone.
  const top = useRef<HTMLDivElement>(null);
  const step = picked ? "confirm" : "menu";
  useEffect(() => { top.current?.closest<HTMLElement>(".modal")?.focus(); }, [step]);

  return <Modal title={picked ? "Restore this backup?" : "Back up & restore"} onClose={onClose}>
    <div ref={top} hidden/>
    {picked ? <>
      <p>From {picked.backup.exportedAt ? shortDate(picked.backup.exportedAt) : "an unknown date"}: {picked.charges} {picked.charges === 1 ? "charge" : "charges"}{picked.name ? `, ${picked.name}` : ""}{picked.vehicle ? ` (${picked.vehicle})` : ""}.</p>
      <p className="backup-warning">Restoring replaces everything ZeroEmit has on this device: charges, profile, settings and leaderboard entry. A leaderboard entry in the backup moves to this phone, and drops off the phone it came from.</p>
      <div className="share-actions">
        <button type="button" className="primary-button" onClick={restore}>Restore backup</button>
        <button type="button" className="forecast-button action-button" onClick={() => setPicked(null)}>Cancel</button>
      </div>
    </> : <>
      <p>There&apos;s no account: your charges, profile and leaderboard entry live only on this device. Save a backup file to keep them safe, or to move to a new phone.</p>
      <div className="share-actions">
        {canShare && <button type="button" className="primary-button" onClick={share}><Icon name="share" size={18}/> Send to another phone</button>}
        <button type="button" className={canShare ? "forecast-button action-button" : "primary-button"} onClick={download}><Icon name="download" size={18}/> Save backup file</button>
        <button type="button" className="forecast-button action-button" onClick={() => fileInput.current?.click()}><Icon name="history" size={18}/> Restore from a file</button>
      </div>
      <input ref={fileInput} type="file" accept="application/json,.json,text/plain,.txt" hidden onChange={choose}/>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="backup-note">{last ? `Last backup: ${shortDate(last)}.` : "No backup saved from this device yet."} The file includes your leaderboard key, which proves the entry is yours, so keep it private.</p>
    </>}
  </Modal>;
}
