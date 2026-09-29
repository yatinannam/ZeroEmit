"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { ChargeWindow, ForecastPoint } from "../lib/grid";
import { ForecastChart } from "./forecast-chart";
import { Icon } from "./icon-set";

// Illustrations are drawn from the app's own UI with sample numbers — they
// show what the real screens look like, stay crisp, work offline and follow
// the light/dark theme.

function DayCurve() {
  // A day that's dirty through the evening peak and dips clean around midday.
  const values = [62, 60, 58, 55, 52, 47, 40, 33, 26, 21, 19, 21, 27, 36, 48, 60, 72, 80, 84, 82, 76, 70, 66, 63];
  const x = (i: number) => 12 + (i / (values.length - 1)) * 256;
  const y = (v: number) => 138 - v * 1.2;
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return <svg className="intro-art-svg" viewBox="0 0 280 170" role="img" aria-label="A day's grid intensity, lowest around midday">
    <rect className="intro-band" x={x(9)} y="20" width={x(12) - x(9)} height="118" rx="6"/>
    <line className="intro-baseline" x1="12" y1="138" x2="268" y2="138"/>
    <path className="intro-area" d={`${line} L${x(23)},138 L${x(0)},138 Z`}/>
    <path className="intro-line" d={line}/>
    <circle className="intro-dot" cx={x(10)} cy={y(19)} r="13"/>
    <path className="intro-bolt" d={`M${x(10) + 2} ${y(19) - 8} l-7 9 h5 l-2 7 l7 -9 h-5 z`}/>
    {[["12 am", 0], ["6 am", 6], ["12 pm", 12], ["6 pm", 18]].map(([label, i]) => <text key={label} className="intro-label" x={x(i as number)} y="158" textAnchor={i === 0 ? "start" : "middle"}>{label}</text>)}
  </svg>;
}

// A fixed sample day (IST midnight onwards) so the labels read 12 am … 11 pm.
const SAMPLE_START = Date.parse("2026-01-05T00:00:00+05:30");
const SAMPLE_VALUES = [520, 505, 490, 470, 455, 440, 410, 360, 300, 250, 215, 195, 190, 205, 260, 340, 430, 520, 580, 600, 590, 570, 550, 535];
const SAMPLE_POINTS: ForecastPoint[] = SAMPLE_VALUES.map((carbonIntensity, i) => ({ datetime: new Date(SAMPLE_START + i * 3_600_000).toISOString(), carbonIntensity }));
const SAMPLE_BEST: ChargeWindow = { start: SAMPLE_POINTS[12], end: SAMPLE_POINTS[14], average: 198, startIndex: 12 };

function MiniForecast() {
  return <div className="intro-mini" aria-label="Sample forecast: best window 12:00 – 2:00 pm" role="img">
    <div className="intro-mini-head"><span>Right now</span><b>190 <small>gCO₂/kWh</small></b></div>
    <ForecastChart points={SAMPLE_POINTS} highlight={SAMPLE_BEST}/>
    <p className="chip-caption"><span className="chip">Best window</span> 12:00 – 2:00 pm</p>
  </div>;
}

function MiniRewards() {
  return <div className="intro-mini intro-mini-rewards" aria-label="Sample rewards: 155 points, First Green Charge badge, 30.2 kg of CO₂ avoided" role="img">
    <div className="intro-mini-head"><span>Eco points</span><b>155 <small>pts</small></b></div>
    <div className="progress-track"><div className="progress-fill" style={{ width: "78%" }}/></div>
    <div className="intro-badge"><span className="round-icon"><Icon name="bolt" size={18}/></span><span><strong>First Green Charge</strong><small>Completed</small></span></div>
    <div className="intro-badge"><span className="round-icon"><Icon name="tree" size={18}/></span><span><strong>30.2 kg of CO₂ avoided</strong><small>This month</small></span></div>
  </div>;
}

const SLIDES = [
  { title: "Charge when energy is cleaner.", body: "Electricity isn't equally clean throughout the day. ZeroEmit helps you find better charging windows.", Art: DayCurve },
  { title: "Plan your next 24 hours.", body: "See how clean the grid is likely to be, hour by hour, from India's real regional grid data, and when the cleanest windows are.", Art: MiniForecast },
  { title: "Turn cleaner choices into progress.", body: "Track CO₂ savings, earn Eco Points and build sustainable charging habits.", Art: MiniRewards },
];

export function OnboardingIntro({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const headings = useRef<(HTMLHeadingElement | null)[]>([]);
  const pointerStart = useRef<number | null>(null);
  const moved = useRef(false);
  const last = index === SLIDES.length - 1;

  const go = (next: number) => {
    if (next < 0) return;
    if (next >= SLIDES.length) { onDone(); return; }
    moved.current = true;
    setIndex(next);
  };

  // After the user moves to another screen, put focus on its headline so
  // screen readers announce it (not on first render — the gate handles that).
  // preventScroll: otherwise the browser scrolls the clipped viewport to the
  // heading on top of the slide transform and overshoots to the next slide.
  useEffect(() => { if (moved.current) headings.current[index]?.focus({ preventScroll: true }); }, [index]);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "ArrowRight") { event.preventDefault(); go(index + 1); }
    if (event.key === "ArrowLeft") { event.preventDefault(); go(index - 1); }
  }

  function onPointerDown(event: PointerEvent) { pointerStart.current = event.clientX; }
  function onPointerUp(event: PointerEvent) {
    if (pointerStart.current === null) return;
    const dx = event.clientX - pointerStart.current;
    pointerStart.current = null;
    if (Math.abs(dx) < 50) return;
    if (dx < 0 && !last) go(index + 1);
    if (dx > 0) go(index - 1);
  }

  return <div className="intro" onKeyDown={onKeyDown}>
    <header className="intro-top"><button type="button" className="intro-skip" onClick={onDone}>Skip</button></header>
    {/* Belt and braces: slides move by transform only, so undo any scroll the browser applies (e.g. to reveal focus). */}
    <div className="intro-viewport" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { pointerStart.current = null; }} onScroll={(event) => { event.currentTarget.scrollLeft = 0; }}>
      <div className="intro-track" style={{ transform: `translateX(-${index * 100}%)` }}>
        {SLIDES.map(({ title, body, Art }, i) => (
          <section key={title} className="intro-slide" role="group" aria-roledescription="slide" aria-label={`Step ${i + 1} of ${SLIDES.length}`} aria-hidden={i !== index} inert={i !== index}>
            <div className="intro-art"><Art/></div>
            <h1 ref={(node) => { headings.current[i] = node; }} tabIndex={-1}>{title}</h1>
            <p>{body}</p>
          </section>
        ))}
      </div>
    </div>
    <footer className="intro-bottom">
      <div className="intro-dots" aria-hidden="true">{SLIDES.map((slide, i) => <span key={slide.title} className={i === index ? "active" : ""}/>)}</div>
      <button type="button" className="intro-next" onClick={() => go(index + 1)}>{last ? "Get started" : "Next"} <Icon name="arrow" size={18}/></button>
    </footer>
  </div>;
}
