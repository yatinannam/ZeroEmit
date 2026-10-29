// Everyday comparisons for "kg of CO₂ avoided", which is hard to picture.
// Rough by nature, so the assumptions are shown next to them in the app.
export const PETROL_CAR_KG_PER_KM = 0.15; // a typical small petrol car, ~150 g CO₂/km
export const TREE_KG_PER_YEAR = 21; // CO₂ a mature tree absorbs in a year
export const EQUIVALENTS_NOTE = "Based on about 150 g of CO₂ per km for a petrol car and 21 kg a year absorbed by a mature tree.";

export function impactEquivalents(co2Kg: number) {
  return { petrolKm: Math.round(co2Kg / PETROL_CAR_KG_PER_KM), treeYears: Math.round((co2Kg / TREE_KG_PER_YEAR) * 10) / 10 };
}

export function equivalentsSentence(co2Kg: number): string | null {
  const { petrolKm, treeYears } = impactEquivalents(co2Kg);
  if (petrolKm < 1) return null;
  const drive = `Like not driving ${petrolKm} km in a petrol car`;
  if (treeYears < 1) return `${drive}.`;
  return `${drive}, or what ${treeYears} ${treeYears === 1 ? "tree absorbs" : "trees absorb"} in a year.`;
}
