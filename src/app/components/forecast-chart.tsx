"use client";

import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { formatShortHour, type ChargeWindow, type ForecastPoint } from "../lib/grid";
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

export function ForecastChart({ points, highlight }: { points: ForecastPoint[]; highlight: ChargeWindow | null }) {
  const svg = useRef<SVGSVGElement>(null);
  const shape = points.map((point) => point.carbonIntensity).join();

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

  // Evenly spaced whole-hour ticks (every `step` hours), plus the last point
  // unless it would crowd the previous tick.
  const lastIndex = points.length - 1;
  const step = Math.max(1, Math.ceil(lastIndex / TICKS));
  const tickIndexes = Array.from({ length: Math.floor(lastIndex / step) + 1 }, (_, i) => i * step);
  if (lastIndex - tickIndexes[tickIndexes.length - 1] >= step / 2) tickIndexes.push(lastIndex);

  return <svg ref={svg} className="forecast-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Carbon intensity by hour">
    {bandStart >= 0 && <rect className="forecast-chart-band" x={x(bandStart)} y={TOP_PAD} width={Math.max(x(bandEnd) - x(bandStart), 4)} height={plotHeight}/>}
    <line className="forecast-chart-baseline" x1="0" y1={baseline} x2={WIDTH} y2={baseline}/>
    <path className="forecast-chart-area" d={areaPath}/>
    <path className="forecast-chart-line" d={linePath}/>
    {points[0].isNow && <circle className="forecast-chart-dot" cx={x(0)} cy={y(points[0].carbonIntensity)} r="4"/>}
    {tickIndexes.map((index) => <text key={index} className="forecast-chart-label" x={x(index)} y={HEIGHT - 4} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}>{index === 0 && points[0].isNow ? "Now" : formatShortHour(points[index].datetime)}</text>)}
  </svg>;
}
