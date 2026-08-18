"use client";
import { useState } from "react";

export type Charge = { id: string; energyKwh: number; chargedAt: string; city: string; carbonIntensity: number | null };
const STORAGE_KEY = "zeroemit-charges";
function readCharges(): Charge[] { if (typeof window === "undefined") return []; try { const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } }
export function useCharges() {
  const [charges, setCharges] = useState<Charge[]>(readCharges);
  function addCharge(charge: Omit<Charge, "id">) { const next = [{ ...charge, id: crypto.randomUUID() }, ...charges]; setCharges(next); window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
  return { charges, addCharge };
}
