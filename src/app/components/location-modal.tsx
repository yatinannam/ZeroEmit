"use client";

import { Modal } from "./modal";
import { LocationSearch } from "./location-search";
import type { Place } from "../lib/places";

export function LocationModal({ current, onClose, onChoose }: { current: Place; onClose: () => void; onChoose: (place: Place) => void }) {
  return <Modal title="Choose your location" onClose={onClose}>
    <p>Grid data comes from your state&apos;s regional grid. Your exact location stays on this device.</p>
    <LocationSearch current={current} onChoose={onChoose}/>
  </Modal>;
}
