"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import gsap from "gsap";
import { formatHour, formatShortHour, HOUR_MS, type ChargeWindow, type ForecastPoint } from "../lib/grid";
import { reducedMotion } from "./motion";

const WIDTH = 328;
const HEIGHT = 130;
const TOP_PAD = 10;
const BOTTOM_PAD = 24; // room for the axis labels below the plot
const TICKS = 4;
// The y-axis always spans at least this many gCO₂/kWh below the lowest
// point, so a 25 g difference late in the day reads as the near-flat line
// it is, not a floor-to-ceiling climb.
const MIN_SPAN = 150;

export function chartDomain(values: number[]): [number, number] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, MIN_SPAN);
  return [Math.max(0, min - span), max + span * 0.1];
}

// `highlight` bands a 2-hour window; `span` bands any stretch of time
// instead (a planned charge, lib/planner.ts), from and to timestamps.
export function ForecastChart({ points, highlight, span = null }: { points: ForecastPoint[]; highlight: ChargeWindow | null; span?: { start: number; end: number } | null }) {
  const svg = useRef<SVGSVGElement>(null);
  const shape = points.map((point) => point.carbonIntensity).join();
  // The hour being read: tap or drag across the chart (or use the arrow
  // keys) to see its value. Tied to the curve, so new data starts clear.
  const [reading, setReading] = useState<{ shape: string; index: number } | null>(null);
  const activeIndex = reading?.shape === shape ? reading.index : null;

  // Draw the line in from the left each time a different day's curve
  // appears, then let the fill and the best-window band settle in.
  useLayoutEffect(() => {
    if (!svg.current || reducedMotion()) return;
    const ctx = gsap.context(() => {
      const line = svg.current?.querySelector<SVGPathElement>(".forecast-chart-line");
      const length = line?.getTotalLength() ?? 0;
      if (line && length) gsap.fromTo(line, { strokeDasharray: length, strokeDashoffset: length }, { strokeDashoffset: 0, duration: 0.9, ease: "power2.inOut", clearProps: "strokeDasharray,strokeDashoffset" });
      gsap.from(".forecast-chart-area", { opacity: 0, duration: 0.6, delay: 0.3, clearProps: "opacity" });
      gsap.from(".forecast-chart-band", { scaleY: 0, transformOrigin: "50% 100%", duration: 0.5, ease: "power3.out", delay: 0.5, clearProps: "transform" });
      gsap.from(".forecast-chart-dot", { scale: 0, transformOrigin: "50% 50%", duration: 0.4, ease: "back.out(3)", delay: 0.1, clearProps: "transform" });
    }, svg);
    return () => ctx.revert();
  }, [shape]);

  if (points.length < 2) return null;
  const [low, high] = chartDomain(points.map((point) => point.carbonIntensity));
  const plotHeight = HEIGHT - TOP_PAD - BOTTOM_PAD;
  const x = (index: number) => (index / (points.length - 1)) * WIDTH;
  const y = (value: number) => TOP_PAD + (1 - (value - low) / (high - low)) * plotHeight;
  const baseline = TOP_PAD + plotHeight;

  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(point.carbonIntensity).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${x(points.length - 1).toFixed(1)},${baseline} L${x(0).toFixed(1)},${baseline} Z`;

  // The highlighted window may run past the end of this day's points (e.g.
  // 11 pm – 1 am), so clamp the band to the plotted range.
  const bandStart = highlight ? points.findIndex((point) => point.datetime === highlight.start.datetime) : -1;
  const bandEnd = bandStart >= 0 ? Math.min(bandStart + 2, points.length - 1) : -1;
  // Points sit one hour apart, so a time maps onto x in proportion.
  const firstHour = Date.parse(points[0].datetime);
  const xAt = (timestamp: number) => Math.min(Math.max(((timestamp - firstHour) / HOUR_MS / (points.length - 1)) * WIDTH, 0), WIDTH);
  const band = span ? { from: xAt(span.start), to: xAt(span.end) } : bandStart >= 0 ? { from: x(bandStart), to: x(bandEnd) } : null;

  // Evenly spaced whole-hour ticks (every `step` hours), plus the last point
  // unless it would crowd the previous tick.
  const lastIndex = points.length - 1;
  const step = Math.max(1, Math.ceil(lastIndex / TICKS));
  const tickIndexes = Array.from({ length: Math.floor(lastIndex / step) + 1 }, (_, i) => i * step);
  if (lastIndex - tickIndexes[tickIndexes.length - 1] > step / 2) tickIndexes.push(lastIndex);

  const read = (index: number | null) => setReading(index === null ? null : { shape, index: Math.min(Math.max(index, 0), lastIndex) });
  const indexAt = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.round(((event.clientX - rect.left) / rect.width) * lastIndex);
  };
  // A mouse reads as it hovers; a finger reads where it touches and drags
  // sideways (the page still scrolls up and down: touch-action: pan-y).
  const onPointer = (event: PointerEvent<SVGSVGElement>) => {
    // A mouse click shouldn't leave a keyboard focus ring round the chart.
    if (event.type === "pointerdown" && event.pointerType === "mouse") event.preventDefault();
    if (event.pointerType === "mouse" || event.buttons || event.type === "pointerdown") read(indexAt(event));
  };
  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    const current = activeIndex ?? 0;
    // The slider keys: Up/Right later, Down/Left earlier, Page keys by 3 hours.
    const moves: Record<string, number> = { ArrowRight: current + 1, ArrowUp: current + 1, ArrowLeft: current - 1, ArrowDown: current - 1, PageUp: current + 3, PageDown: current - 3, Home: 0, End: lastIndex };
    const next = event.key in moves ? moves[event.key] : null;
    if (event.key === "Escape") { read(null); return; }
    if (next === null) return;
    event.preventDefault();
    read(next);
  }
  const shownIndex = activeIndex ?? 0;
  const label = (index: number) => `${index === 0 && points[0].isNow ? "Now" : formatHour(points[index].datetime)}, ${Math.round(points[index].carbonIntensity)} gCO₂/kWh`;
  const tip = activeIndex === null ? null : { x: x(activeIndex), y: y(points[activeIndex].carbonIntensity), text: `${activeIndex === 0 && points[0].isNow ? "Now" : formatShortHour(points[activeIndex].datetime)} · ${Math.round(points[activeIndex].carbonIntensity)} g` };
  const tipWidth = tip ? tip.text.length * 6.2 + 14 : 0;
  // Above the plot, unless the point is up there too (the day's peak): then
  // just below it, so the label doesn't cover the dot it describes.
  const tipY = tip && tip.y < 24 ? tip.y + 8 : 0;

  // A slider to assistive tech: arrow keys move through the hours, and each
  // value is read out with its time.
  return <svg ref={svg} className="forecast-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="slider" tabIndex={0} aria-label="Carbon intensity by hour" aria-valuemin={0} aria-valuemax={lastIndex} aria-valuenow={shownIndex} aria-valuetext={label(shownIndex)}
    onPointerDown={onPointer} onPointerMove={onPointer} onPointerLeave={(event) => { if (event.pointerType === "mouse") read(null); }} onKeyDown={onKeyDown} onBlur={() => read(null)}>
    {band && <rect className="forecast-chart-band" x={band.from} y={TOP_PAD} width={Math.max(band.to - band.from, 4)} height={plotHeight}/>}
    <line className="forecast-chart-baseline" x1="0" y1={baseline} x2={WIDTH} y2={baseline}/>
    <path className="forecast-chart-area" d={areaPath}/>
    <path className="forecast-chart-line" d={linePath}/>
    {points[0].isNow && <circle className="forecast-chart-dot" cx={x(0)} cy={y(points[0].carbonIntensity)} r="4"/>}
    {tip && <g className="forecast-chart-reading" aria-hidden="true">
      <line className="forecast-chart-cursor" x1={tip.x} y1={TOP_PAD} x2={tip.x} y2={baseline}/>
      <circle className="forecast-chart-dot" cx={tip.x} cy={tip.y} r="4"/>
      <rect className="forecast-chart-tip" x={Math.min(Math.max(tip.x - tipWidth / 2, 0), WIDTH - tipWidth)} y={tipY} width={tipWidth} height={18} rx={9}/>
      <text className="forecast-chart-tip-text" x={Math.min(Math.max(tip.x, tipWidth / 2), WIDTH - tipWidth / 2)} y={tipY + 12.5} textAnchor="middle">{tip.text}</text>
    </g>}
    {tickIndexes.map((index) => <text key={index} className="forecast-chart-label" x={x(index)} y={HEIGHT - 4} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}>{index === 0 && points[0].isNow ? "Now" : formatShortHour(points[index].datetime)}</text>)}
  </svg>;
}
