"use client";
import { useEffect, useSyncExternalStore } from "react";

// One toast at a time: a newer one replaces the current one rather than
// stacking, so a burst of events never buries the screen.
type Toast = { id: number; text: string };
let current: Toast | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function showToast(text: string) {
  current = { id: nextId++, text };
  emit();
}

function dismiss(id: number) {
  if (current?.id !== id) return;
  current = null;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function ToastHost() {
  const toast = useSyncExternalStore(subscribe, () => current, () => null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => dismiss(toast.id), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  return <div className="toast-region" aria-live="polite">
    {toast && <button key={toast.id} className="toast" onClick={() => dismiss(toast.id)}>{toast.text}</button>}
  </div>;
}
