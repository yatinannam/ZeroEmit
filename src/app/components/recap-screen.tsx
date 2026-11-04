"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import gsap from "gsap";
import { formatRupees, DEFAULT_PRICE_PER_KWH } from "../lib/cost";
import { equivalentsSentence } from "../lib/equivalents";
import { dayHeading, formatTimeOfDay } from "../lib/personalization";
import { buildRecap, defaultPeriod, isPeriodKey, periodLabel, previousPeriod, recapPeriods, shortPeriodLabel, type Recap, type RecapPeriod } from "../lib/recap";
import { Icon } from "./icon-set";
import { CountUp, reducedMotion } from "./motion";
import { drawRecapCard } from "./recap-card";
import { showToast } from "./toast";
import { useCharges } from "./use-charges";
import { useMinute } from "./use-minute";
import { useProfile } from "./use-profile";

type Slide = { key: string; tone: "a" | "b" | "c" | "d"; body: ReactNode };
const plural = (count: number, word: string, many = `${word}s`) => (count === 1 ? word : many);
const percent = (share: number) => Math.round(share * 100);

// The story's pages, leaving out any with nothing to say for this period.
function slidesFor(recap: Recap, name: string, periods: RecapPeriod[], onPeriod: (key: string) => void): Slide[] {
  const period = shortPeriodLabel(recap.period);
  const previous = recap.period.kind === "year" ? previousPeriod(recap.period.key) : periodLabel(previousPeriod(recap.period.key)).replace(/ \d{4}$/, "");
  const timed = recap.timing.best + recap.timing.cleaner + recap.timing.other;
  const slides: Slide[] = [];

  slides.push({ key: "cover", tone: "a", body: <>
    <p className="recap-eyebrow">Your recap</p>
    <h1 className="recap-title">{recap.period.kind === "year" ? `Your ${period}` : period}<span>{recap.period.kind === "year" ? "on ZeroEmit" : `${recap.period.key.slice(0, 4)} on ZeroEmit`}</span></h1>
    <p className="recap-text">{name ? `${name}, here's` : "Here's"} how your charging went, and how much cleaner you made it.</p>
    <p className="recap-hint"><Icon name="arrow" size={16}/> Tap or swipe to start</p>
  </> });

  slides.push({ key: "energy", tone: "b", body: <>
    <p className="recap-eyebrow">You charged</p>
    <p className="recap-big"><CountUp value={recap.count}/><small> {plural(recap.count, "time")}</small></p>
    <p className="recap-text"><b><CountUp value={recap.kwh} decimals={1}/> kWh</b> in total{recap.cities > 1 ? `, across ${recap.cities} cities` : ""}.</p>
    <p className="recap-muted">About {formatRupees(recap.cost)} of electricity at your price.</p>
  </> });

  if (timed) {
    const best = recap.bestShare ?? 0;
    const before = recap.previousBestShare === null ? null : percent(recap.previousBestShare);
    slides.push({ key: "timing", tone: "c", body: <>
      <p className="recap-eyebrow">Your timing</p>
      <p className="recap-big"><CountUp value={percent(best)}/><small>%</small></p>
      <p className="recap-text">of your charges started in one of the day&apos;s cleanest windows.</p>
      <div className="recap-bar" role="img" aria-label={`${recap.timing.best} in a best window, ${recap.timing.cleaner} at a cleaner hour, ${recap.timing.other} at other times`}>
        {(["best", "cleaner", "other"] as const).map((kind) => recap.timing[kind] > 0 && <span key={kind} className={`recap-bar-${kind}`} style={{ flexGrow: recap.timing[kind] }}/>)}
      </div>
      <ul className="recap-legend">
        <li><i className="recap-bar-best"/>Best window <b>{recap.timing.best}</b></li>
        <li><i className="recap-bar-cleaner"/>Cleaner hour <b>{recap.timing.cleaner}</b></li>
        <li><i className="recap-bar-other"/>Other times <b>{recap.timing.other}</b></li>
      </ul>
      {before !== null && <p className="recap-muted">{percent(best) > before ? `Up from ${before}% in ${previous}.` : percent(best) < before ? `Down from ${before}% in ${previous}. The charge planner can help.` : `The same as in ${previous}.`}</p>}
    </> });
  }

  slides.push({ key: "impact", tone: "d", body: recap.co2Kg >= 0.05 ? <>
    <p className="recap-eyebrow">You avoided</p>
    <p className="recap-big"><CountUp value={recap.co2Kg} decimals={1}/><small> kg CO₂</small></p>
    <p className="recap-text">compared with charging at your region&apos;s average for each day.</p>
    {equivalentsSentence(recap.co2Kg) && <p className="recap-muted">{equivalentsSentence(recap.co2Kg)}</p>}
  </> : <>
    <p className="recap-eyebrow">Your impact</p>
    <p className="recap-big recap-big-text">Every charge counts.</p>
    <p className="recap-text">Your charges ran at or above the day&apos;s average this time. Starting in a best window is the quickest way to avoid CO₂.</p>
  </> });

  if (recap.cleanest) {
    const { intensity, loggedAt, chargedAt } = recap.cleanest;
    slides.push({ key: "cleanest", tone: "a", body: <>
      <p className="recap-eyebrow">Your cleanest charge</p>
      <p className="recap-big"><CountUp value={intensity}/><small> g/kWh</small></p>
      <p className="recap-text">{dayHeading(loggedAt)}, {formatTimeOfDay(chargedAt)}.</p>
      {recap.averageIntensity !== null && recap.count > 1 && <p className="recap-muted">Your charges averaged {Math.round(recap.averageIntensity)} gCO₂/kWh.</p>}
    </> });
  }

  if (recap.usualTime) {
    slides.push({ key: "habits", tone: "b", body: <>
      <p className="recap-eyebrow">You usually plug in around</p>
      <p className="recap-big recap-big-time">{formatTimeOfDay(recap.usualTime)}</p>
      {recap.busiestWeekday && <p className="recap-text">{recap.busiestWeekday} was your busiest charging day.</p>}
      <p className="recap-muted">The charge planner can find a cleaner start that still has you ready on time.</p>
    </> });
  }

  slides.push({ key: "points", tone: "c", body: <>
    <p className="recap-eyebrow">You earned</p>
    <p className="recap-big"><CountUp value={recap.points}/><small> Eco points</small></p>
    {recap.longestStreak > 1 && <p className="recap-text">Longest streak: <b>{recap.longestStreak} days</b> in a row.</p>}
    <p className="recap-muted">{recap.levelUp ? `You reached ${recap.level}.` : `Level: ${recap.level}.`}</p>
    {recap.newBadges.length > 0 && <ul className="recap-badges" aria-label="New badges">{recap.newBadges.map((badge) => <li key={badge}><Icon name="award" size={16}/> {badge}</li>)}</ul>}
  </> });

  slides.push({ key: "share", tone: "d", body: <ShareSlide recap={recap} name={name} periods={periods} onPeriod={onPeriod}/> });
  return slides;
}

// The last page: the whole period at a glance, to share or move on from.
function ShareSlide({ recap, name, periods, onPeriod }: { recap: Recap; name: string; periods: RecapPeriod[]; onPeriod: (key: string) => void }) {
  const [image, setImage] = useState<{ key: string; file: File; url: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const imageKey = `${recap.period.key}|${name}`;

  // Made as soon as this page shows, so Share can call navigator.share
  // straight from the tap (Safari allows it only inside the gesture).
  useEffect(() => {
    let cancelled = false;
    let url = "";
    drawRecapCard(recap, name).then((blob) => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setImage({ key: imageKey, file: new File([blob], `zeroemit-${recap.period.key}.png`, { type: "image/png" }), url });
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [recap, name, imageKey]);

  const ready = image?.key === imageKey ? image : null;
  const canShare = Boolean(ready && typeof navigator !== "undefined" && navigator.canShare?.({ files: [ready.file] }));
  const period = shortPeriodLabel(recap.period);
  const text = recap.co2Kg >= 0.05 ? `My ${period} on ZeroEmit: ${recap.co2Kg.toFixed(1)} kg of CO₂ avoided by charging my EV when the grid was cleaner. zero-emit.vercel.app` : `My ${period} on ZeroEmit: ${recap.count} EV charges, timed around India's grid. zero-emit.vercel.app`;

  async function share() {
    if (!ready) return;
    try { await navigator.share({ files: [ready.file], title: `My ${period} on ZeroEmit`, text }); }
    catch (error) { if ((error as DOMException).name !== "AbortError") showToast("Couldn't open the share sheet. Try saving the image instead."); }
  }

  function download() {
    if (!ready) return;
    const link = document.createElement("a");
    link.href = ready.url;
    link.download = ready.file.name;
    link.click();
    showToast("Image saved");
  }

  const tiles: [string, string][] = [
    ["Charges", String(recap.count)],
    ["Energy", `${recap.kwh.toFixed(recap.kwh >= 100 ? 0 : 1)} kWh`],
    ["CO₂ avoided", `${recap.co2Kg.toFixed(1)} kg`],
    ["Eco points", String(recap.points)],
  ];
  return <>
    <p className="recap-eyebrow">That&apos;s your {period}</p>
    <dl className="recap-summary">{tiles.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div className="recap-actions">
      {canShare && <button type="button" className="recap-primary" onClick={share}><Icon name="share" size={18}/> Share my recap</button>}
      <button type="button" className={canShare ? "recap-secondary" : "recap-primary"} onClick={download} disabled={!ready}><Icon name="download" size={18}/> {ready || failed ? "Save image" : "Making the image…"}</button>
      {failed && <p className="recap-muted">Couldn&apos;t make the image on this device.</p>}
    </div>
    {periods.length > 1 && <label className="recap-period">See another recap
      <select value={recap.period.key} onChange={(event) => onPeriod(event.target.value)}>
        {periods.map((option) => <option key={option.key} value={option.key}>{option.kind === "year" ? `${option.key} (whole year)` : option.label}</option>)}
      </select>
    </label>}
  </>;
}

// Taps on the left third go back, anywhere else forward; a swipe works too,
// and so do the arrow keys. Escape closes.
function Story({ slides, label, onClose }: { slides: Slide[]; label: string; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const slideRef = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const last = slides.length - 1;
  const go = (step: number) => setIndex((current) => Math.min(Math.max(current + step, 0), last));
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.target instanceof HTMLSelectElement) return;
    if (event.key === "ArrowRight") { event.preventDefault(); go(1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); go(-1); }
    else if (event.key === "Escape") onClose();
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // Each page's lines rise in one after another.
  useLayoutEffect(() => {
    if (!slideRef.current || reducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.from(".recap-slide > *", { y: 28, opacity: 0, duration: 0.55, ease: "power3.out", stagger: 0.08, clearProps: "transform,opacity" });
    }, slideRef);
    return () => ctx.revert();
  }, [index]);

  const slide = slides[index];
  const tap = (step: number) => () => { if (swiped.current) { swiped.current = false; return; } go(step); };
  return <div className={`recap-frame recap-tone-${slide.tone}`} aria-roledescription="story" aria-label={label}
    onPointerDown={(event) => { swipe.current = { x: event.clientX, y: event.clientY }; }}
    onPointerUp={(event) => {
      const start = swipe.current;
      swipe.current = null;
      if (!start) return;
      const dx = event.clientX - start.x;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(event.clientY - start.y)) { swiped.current = true; go(dx < 0 ? 1 : -1); setTimeout(() => { swiped.current = false; }, 0); }
    }}>
    <div className="recap-progress" aria-hidden="true">{slides.map((item, position) => <span key={item.key} className={position < index ? "done" : position === index ? "active" : ""}/>)}</div>
    <div className="recap-top">
      <span><Icon name="sparkle" size={16}/> {label}</span>
      <button type="button" className="recap-close" aria-label="Close recap" onClick={onClose}><Icon name="close" size={20}/></button>
    </div>
    {/* Tap zones for touch; keyboards and screen readers use the buttons below. */}
    <div className="recap-tap recap-tap-prev" aria-hidden="true" onClick={tap(-1)}/>
    <div className="recap-tap recap-tap-next" aria-hidden="true" onClick={tap(1)}/>
    <div ref={slideRef} key={slide.key} className="recap-slide" aria-live="polite">{slide.body}</div>
    <div className="recap-nav">
      <button type="button" aria-label="Previous page" onClick={() => go(-1)} disabled={index === 0}><Icon name="arrow-left" size={20}/></button>
      <span>{index + 1} / {slides.length}</span>
      <button type="button" aria-label="Next page" onClick={() => go(1)} disabled={index === last}><Icon name="arrow" size={20}/></button>
    </div>
  </div>;
}

// /recap?period=2026-10 (or a year, "2026"). Without one, the recap people
// most likely came for (see defaultPeriod).
export function RecapScreen({ requested }: { requested: string | null }) {
  const router = useRouter();
  const { charges, ready } = useCharges();
  const { profile } = useProfile();
  const now = useMinute();
  const periods = ready ? recapPeriods(charges) : [];
  const period = isPeriodKey(requested) && periods.some((option) => option.key === requested) ? requested : now ? defaultPeriod(periods, now) : null;
  const recap = period ? buildRecap(charges, period, profile.pricePerKwh ?? DEFAULT_PRICE_PER_KWH) : null;
  const name = profile.name.trim().split(/\s+/)[0] ?? "";
  const close = () => router.push("/profile");

  let content: ReactNode;
  if (!ready || !now) content = <div className="recap-frame recap-tone-a"><div className="recap-slide"><p className="recap-eyebrow">Your recap</p><p className="recap-text">Loading…</p></div></div>;
  else if (!recap) {
    content = <div className="recap-frame recap-tone-a">
      <div className="recap-top"><span><Icon name="sparkle" size={16}/> Recap</span><button type="button" className="recap-close" aria-label="Close recap" onClick={close}><Icon name="close" size={20}/></button></div>
      <div className="recap-slide recap-empty">
        <p className="recap-eyebrow">Your recap</p>
        <h1 className="recap-title">Nothing to recap yet</h1>
        <p className="recap-text">{requested && isPeriodKey(requested) ? `There are no charges logged for ${periodLabel(requested)}.` : "Log a charge and your monthly recap builds itself from your history."}</p>
        <Link className="recap-primary" href="/log?quick=1"><Icon name="bolt" size={18}/> Log a charge</Link>
      </div>
    </div>;
  } else {
    const slides = slidesFor(recap, name, periods, (key) => router.replace(`/recap?period=${key}`, { scroll: false }));
    // Keyed by period, so another month starts again from its first page.
    content = <Story key={recap.period.key} slides={slides} label={`${recap.period.label} recap`} onClose={close}/>;
  }
  return <main className="recap">{content}</main>;
}
