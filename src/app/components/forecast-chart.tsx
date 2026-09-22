import type { ForecastPoint } from "../lib/grid";

const WIDTH = 328;
const HEIGHT = 130;
const TOP_PAD = 10;
const BOTTOM_PAD = 24; // room for the axis labels below the plot

export function ForecastChart({ points, bestStartIndex, bestLength }: { points: ForecastPoint[]; bestStartIndex: number | null; bestLength: number }) {
  if (points.length < 2) return null;
  const values = points.map((point) => point.carbonIntensity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const plotHeight = HEIGHT - TOP_PAD - BOTTOM_PAD;
  const x = (index: number) => (index / (points.length - 1)) * WIDTH;
  const y = (value: number) => TOP_PAD + (1 - (value - min) / span) * plotHeight;
  const baseline = TOP_PAD + plotHeight;

  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(point.carbonIntensity).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${x(points.length - 1).toFixed(1)},${baseline} L${x(0).toFixed(1)},${baseline} Z`;

  const bandX = bestStartIndex !== null ? x(bestStartIndex) : null;
  const bandWidth = bestStartIndex !== null ? x(Math.min(bestStartIndex + bestLength, points.length - 1)) - x(bestStartIndex) : 0;

  const labelSteps = 4;
  const labels = Array.from({ length: labelSteps + 1 }, (_, step) => {
    const index = Math.round((step / labelSteps) * (points.length - 1));
    return { index, text: step === 0 ? "Now" : `+${Math.round((index / (points.length - 1)) * 24)}h` };
  });

  return <svg className="forecast-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Carbon intensity forecast for the next 24 hours">
    {bandX !== null && <rect className="forecast-chart-band" x={bandX} y={TOP_PAD} width={Math.max(bandWidth, 2)} height={plotHeight}/>}
    <line className="forecast-chart-baseline" x1="0" y1={baseline} x2={WIDTH} y2={baseline}/>
    <path className="forecast-chart-area" d={areaPath}/>
    <path className="forecast-chart-line" d={linePath}/>
    <circle className="forecast-chart-dot" cx={x(0)} cy={y(points[0].carbonIntensity)} r="4"/>
    {labels.map(({ index, text }) => <text key={index} className="forecast-chart-label" x={x(index)} y={HEIGHT - 4} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}>{text}</text>)}
  </svg>;
}
