"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { ChargeWindow, ForecastPoint } from "../lib/grid";
import { ForecastChart } from "./forecast-chart";
import { Icon } from "./icon-set";

// Illustrations are drawn from the app's own UI with sample numbers — they
// show what the real screens look like, stay crisp, work offline and follow
// the light/dark theme.

// A 24-hour dial (12 pm at the top, 12 am at the bottom): the green arc is
// the cleaner midday stretch, the grey one the dirtier evening peak.
const DIAL = { cx: 140, cy: 128, r: 82 };
function dialPoint(hour: number, radius: number) {
  const angle = ((hour - 12) / 24) * 2 * Math.PI;
  return { x: DIAL.cx + radius * Math.sin(angle), y: DIAL.cy - radius * Math.cos(angle) };
}
function dialArc(fromHour: number, toHour: number) {
  const a = dialPoint(fromHour, DIAL.r);
  const b = dialPoint(toHour, DIAL.r);
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} A${DIAL.r} ${DIAL.r} 0 ${toHour - fromHour > 12 ? 1 : 0} 1 ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

function DayDial() {
  const { cx, cy, r } = DIAL;
  const sun = dialPoint(12, 52);
  const moon = dialPoint(0, 52);
  return <div className="intro-dial">
    <svg className="intro-art-svg" viewBox="0 0 280 250" role="img" aria-label="A 24-hour day: cleaner hours around midday, a dirtier peak in the evening">
      <circle className="dial-track" cx={cx} cy={cy} r={r}/>
      <path className="dial-dirty" d={dialArc(17.5, 22)}/>
      <path className="dial-clean" d={dialArc(10, 15)}/>
      {Array.from({ length: 8 }, (_, i) => { const a = dialPoint(i * 3, r - 16); const b = dialPoint(i * 3, r - 11); return <line key={i} className="dial-tick" x1={a.x} y1={a.y} x2={b.x} y2={b.y}/>; })}
      <g className="dial-icon">
        <circle cx={sun.x} cy={sun.y} r="6"/>
        {Array.from({ length: 8 }, (_, i) => { const t = (i / 8) * 2 * Math.PI; return <line key={i} x1={sun.x + 9 * Math.cos(t)} y1={sun.y + 9 * Math.sin(t)} x2={sun.x + 12 * Math.cos(t)} y2={sun.y + 12 * Math.sin(t)}/>; })}
        <path d={`M${moon.x + 4} ${moon.y - 8} a9 9 0 1 0 5 13 a7 7 0 0 1 -5 -13 z`}/>
      </g>
      <circle className="intro-dot" cx={cx} cy={cy} r="30"/>
      <path className="intro-bolt" d={`M${cx + 3} ${cy - 16} l-12 18 h9 l-3 14 l12 -18 h-9 z`}/>
      <text className="intro-label" x={cx} y={cy - r - 16} textAnchor="middle">12 pm</text>
      <text className="intro-label" x={cx + r + 14} y={cy + 4} textAnchor="start">6 pm</text>
      <text className="intro-label" x={cx} y={cy + r + 26} textAnchor="middle">12 am</text>
      <text className="intro-label" x={cx - r - 14} y={cy + 4} textAnchor="end">6 am</text>
    </svg>
    <div className="dial-legend" aria-hidden="true"><span><i className="dial-key-clean"/>Cleaner hours</span><span><i className="dial-key-dirty"/>Evening peak</span></div>
  </div>;
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
  { title: "Charge when energy is cleaner.", body: "Electricity isn't equally clean throughout the day. ZeroEmit helps you find better charging windows.", Art: DayDial },
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
