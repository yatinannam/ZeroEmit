// Popular EVs in India with their usable battery size, so a charge can be
// logged as "20% → 80%" instead of a kWh figure most drivers never see.
// Sizes are approximate (variants and model years differ); "other" lets a
// driver enter their own.
export type VehicleKind = "car" | "scooter" | "three-wheeler";
export type VehiclePreset = { key: string; name: string; batteryKwh: number; kind: VehicleKind };

export const VEHICLES: VehiclePreset[] = [
  { key: "tata-nexon-45", name: "Tata Nexon.ev 45", batteryKwh: 45, kind: "car" },
  { key: "tata-nexon-30", name: "Tata Nexon.ev MR (30 kWh)", batteryKwh: 30, kind: "car" },
  { key: "tata-punch-35", name: "Tata Punch.ev LR (35 kWh)", batteryKwh: 35, kind: "car" },
  { key: "tata-punch-25", name: "Tata Punch.ev (25 kWh)", batteryKwh: 25, kind: "car" },
  { key: "tata-tiago-24", name: "Tata Tiago.ev LR (24 kWh)", batteryKwh: 24, kind: "car" },
  { key: "tata-tiago-19", name: "Tata Tiago.ev MR (19.2 kWh)", batteryKwh: 19.2, kind: "car" },
  { key: "tata-tigor", name: "Tata Tigor.ev", batteryKwh: 26, kind: "car" },
  { key: "tata-curvv-55", name: "Tata Curvv.ev 55", batteryKwh: 55, kind: "car" },
  { key: "tata-curvv-45", name: "Tata Curvv.ev 45", batteryKwh: 45, kind: "car" },
  { key: "mg-comet", name: "MG Comet EV", batteryKwh: 17.3, kind: "car" },
  { key: "mg-windsor", name: "MG Windsor EV", batteryKwh: 38, kind: "car" },
  { key: "mg-zs", name: "MG ZS EV", batteryKwh: 50.3, kind: "car" },
  { key: "mahindra-xuv400-39", name: "Mahindra XUV400 (39.4 kWh)", batteryKwh: 39.4, kind: "car" },
  { key: "mahindra-xuv400-34", name: "Mahindra XUV400 (34.5 kWh)", batteryKwh: 34.5, kind: "car" },
  { key: "mahindra-be6-59", name: "Mahindra BE 6 (59 kWh)", batteryKwh: 59, kind: "car" },
  { key: "mahindra-be6-79", name: "Mahindra BE 6 (79 kWh)", batteryKwh: 79, kind: "car" },
  { key: "mahindra-xev9e-79", name: "Mahindra XEV 9e (79 kWh)", batteryKwh: 79, kind: "car" },
  { key: "hyundai-creta-51", name: "Hyundai Creta Electric LR (51.4 kWh)", batteryKwh: 51.4, kind: "car" },
  { key: "hyundai-creta-42", name: "Hyundai Creta Electric (42 kWh)", batteryKwh: 42, kind: "car" },
  { key: "byd-atto3", name: "BYD Atto 3", batteryKwh: 60.5, kind: "car" },
  { key: "citroen-ec3", name: "Citroën ë-C3", batteryKwh: 29.2, kind: "car" },
  { key: "kia-ev6", name: "Kia EV6", batteryKwh: 84, kind: "car" },
  { key: "ather-450x-37", name: "Ather 450X (3.7 kWh)", batteryKwh: 3.7, kind: "scooter" },
  { key: "ather-450x-29", name: "Ather 450X (2.9 kWh)", batteryKwh: 2.9, kind: "scooter" },
  { key: "ather-rizta-37", name: "Ather Rizta (3.7 kWh)", batteryKwh: 3.7, kind: "scooter" },
  { key: "ola-s1-pro", name: "Ola S1 Pro (4 kWh)", batteryKwh: 4, kind: "scooter" },
  { key: "ola-s1-x-3", name: "Ola S1 X (3 kWh)", batteryKwh: 3, kind: "scooter" },
  { key: "tvs-iqube-34", name: "TVS iQube (3.4 kWh)", batteryKwh: 3.4, kind: "scooter" },
  { key: "tvs-iqube-22", name: "TVS iQube (2.2 kWh)", batteryKwh: 2.2, kind: "scooter" },
  { key: "bajaj-chetak-35", name: "Bajaj Chetak (3.5 kWh)", batteryKwh: 3.5, kind: "scooter" },
  { key: "hero-vida-v1", name: "Hero Vida V1 Pro", batteryKwh: 3.94, kind: "scooter" },
  { key: "revolt-rv400", name: "Revolt RV400", batteryKwh: 3.24, kind: "scooter" },
  { key: "mahindra-treo", name: "Mahindra Treo", batteryKwh: 7.37, kind: "three-wheeler" },
  { key: "piaggio-ape-e-city", name: "Piaggio Ape E-City", batteryKwh: 8, kind: "three-wheeler" },
];

export const VEHICLE_GROUPS: { kind: VehicleKind; label: string }[] = [
  { kind: "car", label: "Cars" },
  { kind: "scooter", label: "Scooters and bikes" },
  { kind: "three-wheeler", label: "Three-wheelers" },
];

export const OTHER_VEHICLE = "other";
export const vehicleByKey = (key: string | undefined) => VEHICLES.find((vehicle) => vehicle.key === key) ?? null;

// Energy from the socket for a battery % gain: some is lost as heat while
// charging (about 10% on AC), and the grid's carbon is in what the meter counts.
export const CHARGING_EFFICIENCY = 0.9;
const MIN_BATTERY_KWH = 1;
const MAX_BATTERY_KWH = 200;

// A battery size typed in, or null when it isn't a sensible one.
export function parseBatteryKwh(raw: unknown): number | null {
  const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(value) || value < MIN_BATTERY_KWH || value > MAX_BATTERY_KWH) return null;
  return Math.round(value * 100) / 100;
}

// A whole battery % (0–100), or null.
export function parsePercent(raw: unknown): number | null {
  const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  return Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value) : null;
}

// kWh drawn from the grid to take a `batteryKwh` battery from `from`% to
// `to`%, to one decimal; null unless `to` is above `from`.
export function kwhForPercent(batteryKwh: number, from: number, to: number): number | null {
  if (!(to > from) || from < 0 || to > 100 || !(batteryKwh > 0)) return null;
  return Math.round((((to - from) / 100) * batteryKwh / CHARGING_EFFICIENCY) * 10) / 10;
}
