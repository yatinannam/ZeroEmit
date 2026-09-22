"use client";

import { Icon } from "./icon-set";
import type { City } from "../lib/grid";

const CITIES: City[] = ["Chennai, India", "Bengaluru, India", "Mumbai, India"];

export function LocationModal({ current, onClose, onChoose }: { current: City; onClose: () => void; onChoose: (city: City) => void }) {
  return <div className="modal-backdrop" role="presentation" onClick={onClose}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="location-title" onClick={(event) => event.stopPropagation()}>
      <div className="modal-head"><h2 id="location-title">Choose your location</h2><button className="modal-close" aria-label="Close" onClick={onClose}><Icon name="close" size={18}/></button></div>
      <p>Grid forecasts are tailored to your selected city.</p>
      <div className="location-options">{CITIES.map((city) => <button key={city} className={city === current ? "selected" : ""} onClick={() => onChoose(city)}>{city}<span>{city === current ? "Selected" : "Select"}</span></button>)}</div>
    </section>
  </div>;
}
