"use client";

import { Modal } from "./modal";
import type { City } from "../lib/grid";

const CITIES: City[] = ["Chennai, India", "Bengaluru, India", "Mumbai, India"];

export function LocationModal({ current, onClose, onChoose }: { current: City; onClose: () => void; onChoose: (city: City) => void }) {
  return <Modal title="Choose your location" onClose={onClose}>
    <p>Grid forecasts are tailored to your selected city.</p>
    <div className="location-options">{CITIES.map((city) => <button key={city} className={city === current ? "selected" : ""} onClick={() => onChoose(city)}>{city}<span>{city === current ? "Selected" : "Select"}</span></button>)}</div>
  </Modal>;
}
