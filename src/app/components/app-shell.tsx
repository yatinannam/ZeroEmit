"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icon-set";
import { useProfile } from "./use-profile";

// Profile lives on the top bar's avatar, so the tab bar has room for
// Chargers, which used to sit behind a link on Home.
const NAV_ITEMS: [string, IconName, string][] = [["/", "home", "Home"], ["/forecast", "chart", "Forecast"], ["/log", "history", "Log"], ["/stations", "plug", "Chargers"], ["/rewards", "award", "Rewards"]];

export function BottomNav() {
  const pathname = usePathname();
  return <nav className="bottom-nav" aria-label="Primary navigation">{NAV_ITEMS.map(([href, icon, label]) => {
    const active = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
    return <Link key={href} className={active ? "active" : ""} aria-current={pathname === href ? "page" : active ? "true" : undefined} href={href}><Icon name={icon}/><span>{label}</span></Link>;
  })}</nav>;
}

// The avatar shows the driver's initials once they've given a name.
export function TopBar({ onChooseLocation }: { onChooseLocation: () => void }) {
  const pathname = usePathname();
  const { profile } = useProfile();
  const initials = profile.name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("");
  return <header className="top-app-bar"><button aria-label="Choose location" onClick={onChooseLocation}><Icon name="pin"/></button><strong>ZeroEmit</strong><Link className={initials ? "top-avatar" : undefined} aria-label="Profile" aria-current={pathname === "/profile" ? "page" : undefined} href="/profile">{initials || <Icon name="user"/>}</Link></header>;
}
