"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import gsap from "gsap";
import { intensityLevel, liveReading, planNext24 } from "../lib/grid";
import { currentRewardTier, totalPoints } from "../lib/rewards";
import { hourlyPattern } from "../lib/timing";
import { Icon, type IconName } from "./icon-set";
import { reducedMotion } from "./motion";
import { useCharges } from "./use-charges";
import { getLatestGrid, subscribeLatestGrid } from "./use-grid-data";
import { useHydrated } from "./use-hydrated";
import { useStoredLocation } from "./use-location";
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
    if (!dragging) pill.current?.style.removeProperty("translate");
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
    pill.current.style.translate = `${offset}px -50%`;
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

// Each page renders its own top bar, so what it has already shown this
// visit is kept here: the bolt draws itself in once when the app opens, the
// city slides in only when it changes, and points are celebrated only when
// they go up (not each time a page mounts).
let introPlayed = false;
let shownCity: string | null = null;
let lastPoints: number | null = null;
// Read-then-replace in plain functions: inside a component the React
// Compiler treated `const before = lastPoints` as an alias of the module
// variable, so the comparison after `lastPoints = points` saw the new value.
function swapLastPoints(points: number) { const before = lastPoints; lastPoints = points; return before; }
function swapShownCity(name: string) { const before = shownCity; shownCity = name; return before; }

const RING_R = 20;
const RING_C = 2 * Math.PI * RING_R;
const BOLT = "M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12L13 2Z";

// Left, the city (tap to change it). Centre, the name with a bolt showing the
// grid right now, from whichever screen last fetched it: green in its
// cleanest third of the day, amber in the middle, muted at its dirtiest, and
// glowing slowly while the cleanest window is on. Right, the avatar (the
// driver's initials once they've given a name) inside a ring that fills
// towards the next Eco level; logging a charge sends the points up to it.
export function TopBar({ onChooseLocation }: { onChooseLocation: () => void }) {
  const pathname = usePathname();
  const { profile } = useProfile();
  const [place] = useStoredLocation();
  const hydrated = useHydrated();
  const { charges, ready } = useCharges();
  const grid = useSyncExternalStore(subscribeLatestGrid, getLatestGrid, () => null);
  const city = useRef<HTMLSpanElement>(null);
  const avatar = useRef<HTMLAnchorElement>(null);
  const arc = useRef<SVGCircleElement>(null);

  const initials = profile.name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("");
  const points = totalPoints(charges);
  const { current: tier, next } = currentRewardTier(points);
  const progress = next ? (points - tier.threshold) / (next.threshold - tier.threshold) : 1;
  const ringLabel = next ? `${Math.round(progress * 100)}% of the way to ${next.name}` : `top level, ${tier.name}`;
  const here = grid && place && grid.state === place.state ? grid : null;
  const reading = liveReading(here);
  const level = here && reading ? intensityLevel(reading.carbonIntensity, hourlyPattern(here.forecast)) : null;
  const cleanNow = Boolean(planNext24(here).windows[0]?.start.isNow);
  const cityName = hydrated ? place?.name ?? "Choose city" : "";
  // Read before the effect below sets it, so only the first bar plays it.
  const playIntro = !introPlayed;

  useLayoutEffect(() => { introPlayed = true; }, []);

  // A new city slides in; the same city on the next page doesn't.
  useLayoutEffect(() => {
    if (!hydrated) return;
    const before = swapShownCity(cityName);
    if (before === cityName || (before === null && !playIntro)) return;
    const element = city.current;
    if (!element || reducedMotion()) return;
    element.classList.remove("enter");
    void element.offsetWidth;
    element.classList.add("enter");
  }, [hydrated, cityName, playIntro]);

  // Points went up (a charge was logged): a "+N" rises from where the toast
  // appears to the avatar, then the ring fills; a new level flashes the ring.
  useLayoutEffect(() => {
    if (!ready) return;
    const before = swapLastPoints(points);
    if (before === null || points <= before) return;
    const ring = arc.current;
    const target = avatar.current;
    if (!ring || !target || reducedMotion()) return;
    const levelUp = currentRewardTier(before).current.name !== tier.name;
    ring.style.transitionDelay = "0.7s";
    if (levelUp) ring.style.strokeDashoffset = "0";
    const chip = document.createElement("div");
    chip.className = "points-fly";
    chip.textContent = `+${points - before}`;
    chip.setAttribute("aria-hidden", "true");
    document.body.append(chip);
    const to = target.getBoundingClientRect();
    gsap.set(chip, { x: window.innerWidth / 2, y: window.innerHeight - 150, xPercent: -50, yPercent: -50 });
    const timeline = gsap.timeline({ onComplete: () => chip.remove() });
    timeline.to(chip, { x: to.left + to.width / 2, duration: 0.7, ease: "power1.inOut" }, 0)
      .to(chip, { y: to.top + to.height / 2, duration: 0.7, ease: "power2.in" }, 0)
      .to(chip, { scale: 0.4, autoAlpha: 0, duration: 0.18 }, 0.56)
      .fromTo(target, { scale: 1 }, { scale: 1.14, duration: 0.16, yoyo: true, repeat: 1, ease: "power2.out", clearProps: "transform" }, 0.68);
    const timers = [window.setTimeout(() => { ring.style.transitionDelay = ""; }, 1700)];
    if (levelUp) {
      timers.push(window.setTimeout(() => target.classList.add("level-up"), 1500));
      // Then back to the new level's own progress, without unwinding the ring.
      timers.push(window.setTimeout(() => {
        target.classList.remove("level-up");
        ring.style.transition = "none";
        ring.style.removeProperty("stroke-dashoffset");
        void ring.getBoundingClientRect();
        ring.style.removeProperty("transition");
      }, 2700));
    }
    return () => { timers.forEach(window.clearTimeout); timeline.kill(); chip.remove(); ring.style.transitionDelay = ""; ring.style.removeProperty("stroke-dashoffset"); target.classList.remove("level-up"); };
  }, [points, ready, tier.name]);

  // Prefixed class names: a bare "intro" picked up the onboarding screen's
  // `.intro { display:flex; min-height:100svh }` and stretched the bar.
  const boltClass = ["brand-bolt", level && `bolt-${level}`, cleanNow && "bolt-now", playIntro && "bolt-intro"].filter(Boolean).join(" ");
  return <header className="top-app-bar">
    <button type="button" className="top-location" aria-label={hydrated && place ? `Location, ${place.name}. Change location` : "Choose location"} onClick={onChooseLocation}>
      <Icon name="pin" size={17}/><span ref={city} className="top-location-name">{cityName}</span>{hydrated && <Icon name="chevron-down" size={14}/>}
    </button>
    <span className="brand"><svg className={boltClass} viewBox="0 0 24 24" aria-hidden="true"><path pathLength={1} d={BOLT}/></svg><strong>ZeroEmit</strong></span>
    <Link ref={avatar} className="top-avatar" aria-label={`Profile, ${ringLabel}`} aria-current={pathname === "/profile" ? "page" : undefined} href="/profile">
      <svg className="avatar-ring" viewBox="0 0 44 44" aria-hidden="true"><circle className="avatar-ring-track" cx="22" cy="22" r={RING_R}/><circle ref={arc} className="avatar-ring-arc" cx="22" cy="22" r={RING_R} strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - progress)}/></svg>
      {initials || <Icon name="user" size={18}/>}
    </Link>
  </header>;
}
