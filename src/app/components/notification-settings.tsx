"use client";

import { useState } from "react";
import { Modal } from "./modal";
import { Icon } from "./icon-set";
import { showToast } from "./toast";
import { NOTIFICATION_KINDS, requestNotificationPermission, sendTestNotification, useNotificationPermission, useNotificationPrefs, type Permission } from "./notifications";

const STATUS: Record<Permission, string> = {
  granted: "Notifications are on for this device. Choose which ones you want.",
  default: "Turn on notifications to get alerts from ZeroEmit on this device.",
  denied: "Notifications are blocked for this site. Allow them in your browser's site settings to turn them on.",
  unsupported: "This browser can't show notifications. On iPhone, add ZeroEmit to your Home Screen and open it from there.",
};

export function NotificationSettings({ onClose }: { onClose: () => void }) {
  const permission = useNotificationPermission();
  const { prefs, setPref } = useNotificationPrefs();
  const [error, setError] = useState("");

  async function turnOn() {
    const result = await requestNotificationPermission();
    setError(result.granted ? "" : result.message);
  }

  async function sendTest() {
    await sendTestNotification();
    showToast("Test notification sent");
  }

  return <Modal title="Notifications" onClose={onClose}>
    <p>{STATUS[permission]}</p>
    {permission === "default" && <button className="primary-button" onClick={turnOn}><Icon name="bell" size={18}/> Turn on notifications</button>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="toggle-list">
      {NOTIFICATION_KINDS.map((kind) => <label key={kind.key} className="toggle-row">
        <span><strong>{kind.label}</strong><small>{kind.detail}</small></span>
        <input type="checkbox" role="switch" className="switch" checked={prefs[kind.key]} onChange={(event) => setPref(kind.key, event.target.checked)}/>
      </label>)}
    </div>
    {permission === "granted" && <button className="forecast-button action-button" onClick={sendTest}>Send a test notification</button>}
  </Modal>;
}
