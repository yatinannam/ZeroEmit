import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chartDomain, ForecastChart } from "./forecast-chart";

describe("ForecastChart interactive", () => {
  const points = [500, 420, 380].map((carbonIntensity, i) => ({ datetime: new Date(Date.UTC(2026, 0, 5, i)).toISOString(), carbonIntensity }));

  test("is a focusable slider by default", () => {
    const html = renderToStaticMarkup(createElement(ForecastChart, { points, highlight: null }));
    expect(html).toContain('role="slider"');
    expect(html).toContain('tabindex="0"');
  });

  // The onboarding sample: its keys and swipes must stay the slides'.
  test("interactive={false} is a picture only, still drawn", () => {
    const html = renderToStaticMarkup(createElement(ForecastChart, { points, highlight: null, interactive: false }));
    expect(html).not.toContain("role=");
    expect(html).not.toContain("tabindex");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("forecast-chart-line");
  });
});

describe("chartDomain", () => {
  test("a small spread stays a small wiggle instead of filling the chart", () => {
    // 821 vs 846 is a 3% difference; it shouldn't be drawn floor-to-ceiling.
    const [low, high] = chartDomain([821, 846, 846]);
    expect((821 - low) / (high - low)).toBeGreaterThan(0.6);
  });

  test("a real daily swing keeps its shape", () => {
    const [low, high] = chartDomain([450, 600, 850]);
    expect(low).toBeLessThan(450);
    expect(high).toBeGreaterThanOrEqual(850);
    expect((450 - low) / (high - low)).toBeLessThan(0.5);
  });

  test("never goes below zero", () => {
    expect(chartDomain([20, 60])[0]).toBe(0);
  });

  test("a flat line still has a range", () => {
    const [low, high] = chartDomain([500, 500]);
    expect(high).toBeGreaterThan(low);
  });
});
