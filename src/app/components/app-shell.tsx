"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import { Icon, type IconName } from "./icon-set";
import { useProfile } from "./use-profile";

// Profile lives on the top bar's avatar, so the tab bar has room for
// Chargers, which used to sit behind a link on Home.
const NAV_ITEMS: [string, IconName, string][] = [["/", "home", "Home"], ["/forecast", "chart", "Forecast"], ["/log", "history", "Log"], ["/stations", "plug", "Chargers"], ["/rewards", "award", "Rewards"]];
const isActive = (pathname: string, href: string) => pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));

// Movement (px) before a press on the bar becomes a drag along it.
const DRAG_START_PX = 6;

// Desktop: the sidebar each page lays out in its own grid. Hidden on phones,
// where the layout's TabBar takes over.
export function BottomNav() {
  const pathname = usePathname();
  return <nav className="bottom-nav sidebar-nav" aria-label="Primary navigation">{NAV_ITEMS.map(([href, icon, label]) => {
    const active = isActive(pathname, href);
    return <Link key={href} className={active ? "active" : ""} aria-current={pathname === href ? "page" : active ? "true" : undefined} href={href}><Icon name={icon}/><span>{label}</span></Link>;
  })}</nav>;
}

// Phones: one tab bar for the whole app, mounted once in the root layout so
// it stays put while pages change under it, like a native tab bar. A glass
// pill sits behind the current tab and springs between tabs. Pressing a tab
// sends the pill there at once; dragging along the bar carries the pill under
// the finger, and letting go opens the tab it's over. Not on the recap story,
// which takes the whole screen.
export function TabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const activeIndex = NAV_ITEMS.findIndex(([href]) => isActive(pathname, href));
  const nav = useRef<HTMLElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ pointerId: number; startX: number } | null>(null);
  const suppressClick = useRef(false);
  // The tab the pill went to on a press or drag, on the page it happened on:
  // once the page changes, the pill simply follows the current tab.
  const [held, setHeld] = useState<{ index: number; on: string } | null>(null);
  const [pressed, setPressed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const heldIndex = held && held.on === pathname ? held.index : null;
  const lit = heldIndex ?? activeIndex;

  // A drag let go: the pill springs from under the finger to its tab.
  useLayoutEffect(() => {
    if (!dragging) pill.current?.style.removeProperty("transform");
  }, [dragging]);

  if (pathname === "/recap") return null;

  // The tabs' centres and edges, measured (they share the bar's width).
  function tabs() {
    return [...(nav.current?.querySelectorAll<HTMLAnchorElement>("a") ?? [])].map((link) => {
      const rect = link.getBoundingClientRect();
      return { left: rect.left, width: rect.width, centre: rect.left + rect.width / 2 };
    });
  }
  function nearest(x: number) {
    const all = tabs();
    return all.reduce((best, tab, index) => (Math.abs(tab.centre - x) < Math.abs(all[best].centre - x) ? index : best), 0);
  }
  const hold = (index: number | null) => setHeld(index === null ? null : { index, on: pathname });

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    suppressClick.current = false;
    if (event.button !== 0) return;
    drag.current = { pointerId: event.pointerId, startX: event.clientX };
    hold(nearest(event.clientX));
    setPressed(true);
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!dragging) {
      if (Math.abs(event.clientX - current.startX) < DRAG_START_PX) return;
      setDragging(true);
      nav.current?.setPointerCapture(event.pointerId);
    }
    const all = tabs();
    if (!all.length || !pill.current) return;
    const first = all[0];
    // The pill's centre follows the finger, kept between the first and last tab.
    const offset = Math.min(Math.max(event.clientX - first.width / 2, first.left), all[all.length - 1].left) - first.left;
    pill.current.style.transform = `translateX(${offset}px)`;
    const index = nearest(event.clientX);
    if (index !== heldIndex) {
      hold(index);
      try { navigator.vibrate?.(6); } catch { /* no vibration here */ }
    }
  }

  function release(event: PointerEvent<HTMLElement>, open: boolean) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    setPressed(false);
    if (!dragging) {
      // A tap on a tab: its link opens it, and the pill waits there. A tap
      // between tabs, or a cancelled one, opens nothing.
      if (!open || !(event.target as Element).closest("a")) hold(null);
      return;
    }
    setDragging(false);
    // The drag ends in a click on whichever tab it started on; skip it.
    suppressClick.current = true;
    const index = nearest(event.clientX);
    if (!open || index === activeIndex) { hold(null); return; }
    hold(index);
    router.push(NAV_ITEMS[index][0]);
  }

  function onClickCapture(event: MouseEvent<HTMLElement>) {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  const pillClass = ["nav-pill", pressed && "pressed", dragging && "dragging", lit < 0 && "hidden"].filter(Boolean).join(" ");
  return <nav ref={nav} className="bottom-nav tab-bar" aria-label="Primary navigation" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={(event) => release(event, true)} onPointerCancel={(event) => release(event, false)} onClickCapture={onClickCapture}>
    <span ref={pill} className={pillClass} style={{ "--pill-i": Math.max(lit, 0) } as CSSProperties} aria-hidden="true"/>
    {NAV_ITEMS.map(([href, icon, label], index) => {
      const active = index === activeIndex;
      return <Link key={href} className={active ? "active" : ""} data-lit={index === lit ? "" : undefined} aria-current={pathname === href ? "page" : active ? "true" : undefined} href={href} draggable={false}><Icon name={icon}/><span>{label}</span></Link>;
    })}
  </nav>;
}

// The avatar shows the driver's initials once they've given a name.
export function TopBar({ onChooseLocation }: { onChooseLocation: () => void }) {
  const pathname = usePathname();
  const { profile } = useProfile();
  const initials = profile.name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("");
  return <header className="top-app-bar"><button aria-label="Choose location" onClick={onChooseLocation}><Icon name="pin"/></button><strong>ZeroEmit</strong><Link className={initials ? "top-avatar" : undefined} aria-label="Profile" aria-current={pathname === "/profile" ? "page" : undefined} href="/profile">{initials || <Icon name="user"/>}</Link></header>;
}
