"use client";

import { equivalentsSentence } from "../lib/equivalents";
import { shortPeriodLabel, type Recap } from "../lib/recap";

// The recap's share image: a 9:16 story card (1080 × 1920), the size
// Instagram and WhatsApp stories use. A fixed brand image, whatever the
// app's theme.
const W = 1080;
const H = 1920;
const PAD = 88;
const C = { deep: "#052016", primary: "#0d631b", mint: "#cbffc2", leaf: "#9be89a", white: "#ffffff", tile: "rgba(255,255,255,0.1)", line: "rgba(255,255,255,0.18)" };

const formatKwh = (kwh: number) => kwh.toFixed(kwh >= 100 ? 0 : 1);

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

export async function drawRecapCard(recap: Recap, name: string): Promise<Blob> {
  // Canvas needs the real (next/font-generated) family name, and the weights loaded.
  const family = getComputedStyle(document.body).fontFamily;
  await Promise.all([400, 600, 700].map((weight) => document.fonts.load(`${weight} 40px ${family}`))).catch(() => undefined);
  const logo = await loadImage("/icons/icon-192.png").catch(() => null);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const text = (value: string, x: number, y: number, weight: number, size: number, color: string, align: CanvasTextAlign = "left") => {
    ctx.font = `${weight} ${size}px ${family}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(value, x, y);
  };
  const width = (value: string, weight: number, size: number) => { ctx.font = `${weight} ${size}px ${family}`; return ctx.measureText(value).width; };

  const background = ctx.createLinearGradient(0, 0, W * 0.4, H);
  background.addColorStop(0, C.primary);
  background.addColorStop(1, C.deep);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  for (const [x, y, r] of [[W - 60, 260, 360], [-80, 1500, 300]] as const) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }

  if (logo) ctx.drawImage(logo, PAD, 120, 92, 92);
  text("ZeroEmit", PAD + (logo ? 116 : 0), 184, 600, 52, C.white);

  const period = shortPeriodLabel(recap.period);
  // A long name shrinks to fit, and past that the line drops the name.
  let heading = name ? `${name}'s ${period}` : `My ${period}`;
  let headingSize = 56;
  while (headingSize > 40 && width(heading, 600, headingSize) > W - PAD * 2) headingSize -= 2;
  if (width(heading, 600, headingSize) > W - PAD * 2) { heading = `My ${period}`; headingSize = 56; }
  text(heading, PAD, 400, 600, headingSize, C.mint);
  text("on ZeroEmit", PAD, 470, 400, 44, C.mint);

  const co2Led = recap.co2Kg >= 0.05;
  const [figure, unit, caption] = co2Led ? [recap.co2Kg.toFixed(1), "kg", "of CO₂ avoided"] : [formatKwh(recap.kwh), "kWh", "of EV charging"];
  let size = 240;
  while (size > 140 && width(figure, 700, size) + width(unit, 600, size * 0.3) + 24 > W - PAD * 2) size -= 10;
  text(figure, PAD, 760, 700, size, C.white);
  text(unit, PAD + width(figure, 700, size) + 20, 760, 600, Math.round(size * 0.3), C.white);
  text(caption, PAD, 850, 500, 56, C.white);

  // Four tiles: charges, energy (or CO₂), best-window share, Eco points.
  const tiles: [string, string][] = [
    ["CHARGES", String(recap.count)],
    co2Led ? ["ENERGY", `${formatKwh(recap.kwh)} kWh`] : ["CO₂ AVOIDED", `${recap.co2Kg.toFixed(1)} kg`],
    ["BEST WINDOWS", recap.bestShare === null ? "—" : `${Math.round(recap.bestShare * 100)}%`],
    ["ECO POINTS", String(recap.points)],
  ];
  const gap = 28;
  const tileW = (W - PAD * 2 - gap) / 2;
  tiles.forEach(([label, value], index) => {
    const x = PAD + (index % 2) * (tileW + gap);
    const y = 960 + Math.floor(index / 2) * (220 + gap);
    ctx.fillStyle = C.tile;
    ctx.beginPath();
    ctx.roundRect(x, y, tileW, 220, 32);
    ctx.fill();
    text(label, x + 36, y + 66, 600, 28, C.mint);
    let valueSize = 84;
    while (valueSize > 48 && width(value, 700, valueSize) > tileW - 72) valueSize -= 4;
    text(value, x + 36, y + 170, 700, valueSize, C.white);
  });

  const line = co2Led ? equivalentsSentence(recap.co2Kg) : null;
  const words = (line ?? "Charging when the grid is cleaner.").split(" ");
  // Wrap the closing line onto as many lines as it needs.
  let row = "";
  let y = 1560;
  for (const word of words) {
    const next = row ? `${row} ${word}` : word;
    if (width(next, 600, 44) > W - PAD * 2 && row) { text(row, PAD, y, 600, 44, C.white); row = word; y += 60; }
    else row = next;
  }
  text(row, PAD, y, 600, 44, C.white);

  ctx.fillStyle = C.line;
  ctx.fillRect(PAD, 1740, W - PAD * 2, 2);
  text("zero-emit.vercel.app", PAD, 1820, 600, 38, C.leaf);
  text("India's grid, charged cleaner", W - PAD, 1820, 400, 32, C.mint, "right");

  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't create the image"))), "image/png"));
}
