"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icon-set";

const NAV_ITEMS: [string, IconName, string][] = [["/", "home", "Home"], ["/forecast", "chart", "Forecast"], ["/log", "history", "Log"], ["/rewards", "award", "Rewards"], ["/profile", "user", "Profile"]];

export function BottomNav() {
  const pathname = usePathname();
  return <nav className="bottom-nav" aria-label="Primary navigation">{NAV_ITEMS.map(([href, icon, label]) => <Link key={href} className={pathname === href ? "active" : ""} href={href}><Icon name={icon}/><span>{label}</span></Link>)}</nav>;
}

export function TopBar({ onChooseLocation }: { onChooseLocation: () => void }) {
  return <header className="top-app-bar"><button aria-label="Choose location" onClick={onChooseLocation}><Icon name="pin"/></button><strong>ZeroEmit</strong><Link aria-label="Profile" href="/profile"><Icon name="user"/></Link></header>;
}
