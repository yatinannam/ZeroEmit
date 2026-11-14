"use client";

import "lenis/dist/lenis.css";
import { useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import gsap from "gsap";
import Lenis from "lenis";

// Some tweens target optional parts (e.g. the forecast chart's "now" dot,
// absent for tomorrow); a missing one just has nothing to animate.
gsap.config({ nullTargetWarn: false });

// Every animation here is decoration: content is already on the page and
// readable before (and without) it, and it all stays still when the phone
// asks for reduced motion.
export function reducedMotion() {
  return typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// The page's smooth scroller, or null under reduced motion. Kept in plain
// functions out here, not in a component, so the React Compiler leaves the
// module variable alone.
let lenis: { instance: Lenis; tick: (time: number) => void } | null = null;
// How many open sheets hold the page still, and where it stood when the
// first one opened.
let locks = 0;
let lockedAt = { y: 0, path: "" };

// An open sheet holds the page behind it still: the root stops scrolling
// (a swipe on the backdrop, or past the end of a short sheet, used to
// scroll the page on phones) and Lenis stops (on desktop it smooth-scrolled
// the page under a wheel over the backdrop). Counted, so stacked or
// swapped sheets keep the lock until the last one closes.
export function lockScroll() {
  if (locks++) return;
  const root = document.documentElement;
  lockedAt = { y: window.scrollY, path: window.location.pathname };
  // Keep the scrollbar's room on desktop, so the page doesn't shift sideways.
  if (window.innerWidth > root.clientWidth) root.style.scrollbarGutter = "stable";
  root.style.overflow = "hidden";
  lenis?.instance.stop();
}

export function unlockScroll() {
  if (!locks || --locks) return;
  const root = document.documentElement;
  root.style.overflow = "";
  root.style.scrollbarGutter = "";
  lenis?.instance.start();
  // Back where it was (iOS can drift under a locked root), unless the sheet
  // went on to another page, which keeps its own scroll.
  if (window.location.pathname === lockedAt.path && window.scrollY !== lockedAt.y) window.scrollTo(0, lockedAt.y);
}

function startLenis() {
  if (lenis) return;
  const instance = new Lenis({
    // Inner scrollers (the location list in a modal) scroll themselves,
    // and a modal never scrolls the page behind it.
    allowNestedScroll: true,
    prevent: (node) => node.classList.contains("modal"),
    // A tap on a link mid-glide ends the glide, so it can't carry over
    // into the next screen.
    stopInertiaOnNavigate: true,
  });
  const tick = (time: number) => instance.raf(time * 1000);
  gsap.ticker.add(tick);
  if (locks) instance.stop();
  lenis = { instance, tick };
}

function stopLenis() {
  if (!lenis) return;
  gsap.ticker.remove(lenis.tick);
  lenis.instance.destroy();
  lenis = null;
}

// Back/forward isn't a link tap: drop any glide still running so it doesn't
// fight the scroll position Next.js restores (stopping and restarting is how
// Lenis exposes that). A sheet's lock keeps it stopped.
function endGlide() {
  if (locks) return;
  lenis?.instance.stop();
  lenis?.instance.start();
}

// Smooth wheel scrolling on desktop (touch keeps the phone's native scroll),
// driven from GSAP's ticker so scrolling and tweens share one frame loop.
// Under reduced motion there's no Lenis at all (plain native scrolling), and
// switching the setting while the app is open takes effect at once.
// A new screen appears at once, like a native tab switch: fading it in left
// it blank for a moment while the phone was busy rendering it.
export function MotionRoot() {
  const pathname = usePathname();
  const shownPath = useRef<string | null>(null);

  useLayoutEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => { if (query.matches) stopLenis(); else startLenis(); };
    sync();
    query.addEventListener("change", sync);
    return () => { query.removeEventListener("change", sync); stopLenis(); };
  }, []);

  useLayoutEffect(() => {
    const previous = shownPath.current;
    shownPath.current = pathname;
    if (previous === null || previous === pathname) return;
    endGlide();
  }, [pathname]);

  return null;
}

// A number that counts up from what was shown before (0 the first time) to
// `value`. React owns the text node and always writes the final value; the
// tween only rewrites that same node's text while it runs, so React's later
// updates still land.
export function CountUp({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  const text = value.toFixed(decimals);

  useLayoutEffect(() => {
    const node = ref.current?.firstChild;
    const from = shown.current;
    if (!(node instanceof Text) || from === value || reducedMotion()) { shown.current = value; return; }
    const counter = { n: from };
    node.nodeValue = from.toFixed(decimals);
    const tween = gsap.to(counter, {
      n: value, duration: 0.9, ease: "power2.out",
      onUpdate: () => { shown.current = counter.n; node.nodeValue = counter.n.toFixed(decimals); },
      onComplete: () => { shown.current = value; node.nodeValue = text; },
    });
    return () => { tween.kill(); };
  }, [value, decimals, text]);

  return <span ref={ref}>{text}</span>;
}

// A progress bar's fill that grows from empty when it first appears, and
// from its old width when the value changes.
export function ProgressFill({ percent }: { percent: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRef("0%");
  const width = `${Math.round(percent)}%`;

  useLayoutEffect(() => {
    const fill = ref.current;
    const from = shown.current;
    shown.current = width;
    if (!fill || from === width || reducedMotion()) return;
    // The fill's CSS width transition would fight the tween frame by frame.
    fill.style.transition = "none";
    const tween = gsap.fromTo(fill, { width: from }, { width, duration: 0.9, ease: "power2.out", delay: 0.15 });
    return () => { tween.kill(); fill.style.width = width; fill.style.transition = ""; };
  }, [width]);

  return <div ref={ref} className="progress-fill" style={{ width }}/>;
}
