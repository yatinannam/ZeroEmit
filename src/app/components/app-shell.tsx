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

// Each page renders its own tab bar, so where the last one's pill was on
// screen (px along the bar, mid-slide or not) is kept here: the new page's
// bar starts its pill there and slides it on to its own tab.
let shownOffset: number | null = null;
// Movement (px) before a press on the bar becomes a drag along it.
const DRAG_START_PX = 6;

// On phones a glass pill sits behind the current tab. Pressing a tab sends
// the pill there at once; dragging along the bar carries the pill under the
// finger, and letting go opens the tab it's over. On desktop the bar is a
// sidebar and the pill is hidden.
export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const activeIndex = NAV_ITEMS.findIndex(([href]) => isActive(pathname, href));
  const nav = useRef<HTMLElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ pointerId: number; startX: number } | null>(null);
  const suppressClick = useRef(false);
  // The tab the pill is on after a press or drag (null: the page's own).
  const [held, setHeld] = useState<number | null>(null);
  const [pressed, setPressed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const lit = held ?? activeIndex;

  useLayoutEffect(() => {
    const element = pill.current;
    if (element && shownOffset !== null && activeIndex >= 0) {
      element.style.transition = "none";
      element.style.transform = `translateX(${shownOffset}px)`;
      void element.offsetWidth; // paint the start position before animating
      element.style.transition = "";
      element.style.removeProperty("transform");
    }
    return () => {
      if (!element) return;
      const { transform } = getComputedStyle(element);
      shownOffset = element.classList.contains("hidden") || transform === "none" ? null : new DOMMatrixReadOnly(transform).m41;
    };
  }, [activeIndex]);

  // A drag let go: the pill springs from under the finger to its tab.
  useLayoutEffect(() => {
    if (!dragging) pill.current?.style.removeProperty("transform");
  }, [dragging]);

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

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    suppressClick.current = false;
    if (event.button !== 0 || window.matchMedia("(min-width: 1000px)").matches) return;
    drag.current = { pointerId: event.pointerId, startX: event.clientX };
    setHeld(nearest(event.clientX));
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
    if (index !== held) {
      setHeld(index);
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
      if (!open || !(event.target as Element).closest("a")) setHeld(null);
      return;
    }
    setDragging(false);
    // The drag ends in a click on whichever tab it started on; skip it.
    suppressClick.current = true;
    const index = nearest(event.clientX);
    if (!open || index === activeIndex) { setHeld(null); return; }
    setHeld(index);
    router.push(NAV_ITEMS[index][0]);
  }

  function onClickCapture(event: MouseEvent<HTMLElement>) {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  const pillClass = ["nav-pill", pressed && "pressed", dragging && "dragging", lit < 0 && "hidden"].filter(Boolean).join(" ");
  return <nav ref={nav} className="bottom-nav" aria-label="Primary navigation" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={(event) => release(event, true)} onPointerCancel={(event) => release(event, false)} onClickCapture={onClickCapture}>
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
