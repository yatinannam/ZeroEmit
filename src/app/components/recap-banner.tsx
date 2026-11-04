"use client";

import Link from "next/link";
import { IST_OFFSET_MS } from "../lib/grid";
import { istMonthKey } from "../lib/leaderboard";
import { periodLabel } from "../lib/recap";
import { Icon } from "./icon-set";
import { useCharges } from "./use-charges";
import { useMinute } from "./use-minute";

// Home, in the first week of a month: last month's recap, when there was
// any charging to recap. Nothing in the server render (no clock there).
export function RecapBanner() {
  const { charges, ready } = useCharges();
  const now = useMinute();
  if (!ready || !now || new Date(now + IST_OFFSET_MS).getUTCDate() > 7) return null;
  const lastMonth = istMonthKey(Date.parse(`${istMonthKey(now)}-01T00:00:00+05:30`) - 1);
  if (!charges.some((charge) => istMonthKey(charge.loggedAt) === lastMonth)) return null;
  const month = periodLabel(lastMonth).replace(/ \d{4}$/, "");
  return <Link className="recap-banner" href={`/recap?period=${lastMonth}&from=home`}>
    <span className="round-icon"><Icon name="sparkle" size={20}/></span>
    <span><strong>Your {month} recap is ready</strong><small>Your charges, timing and CO₂ avoided, in one story.</small></span>
    <Icon name="chevron-right" size={18}/>
  </Link>;
}
