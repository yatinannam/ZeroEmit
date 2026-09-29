"use client";

import { useEffect, useState } from "react";
import { chargesInMonth, currentStreakDays, impactSummary } from "../lib/rewards";
import type { Charge } from "./use-charges";
import { Icon } from "./icon-set";
import { Modal } from "./modal";
import { showToast } from "./toast";

type Period = "month" | "all";
type CardData = { name: string; periodLabel: string; co2Kg: number; kwh: number; greenRate: number | null; streak: number };

const W = 1080;
const H = 1350;
const PAD = 72;
// The card is a fixed brand image, the same whatever theme the app is in.
const C = { surface: "#f1fdec", primary: "#0d631b", primaryContainer: "#2e7d32", onPrimaryContainer: "#cbffc2", ink: "#141e14", muted: "#40493d", card: "#ffffff", border: "#dae6d6" };

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function drawCard(data: CardData): Promise<Blob> {
  // Canvas needs the real (next/font-generated) family name, and the weights loaded.
  const family = getComputedStyle(document.body).fontFamily;
  await Promise.all([400, 500, 600, 700].map((weight) => document.fonts.load(`${weight} 40px ${family}`))).catch(() => undefined);
  const logo = await loadImage("/icons/icon-192.png").catch(() => null);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const font = (weight: number, size: number) => `${weight} ${size}px ${family}`;
  const text = (value: string, x: number, y: number, weight: number, size: number, color: string, align: CanvasTextAlign = "left") => {
    ctx.font = font(weight, size);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(value, x, y);
  };

  ctx.fillStyle = C.surface;
  ctx.fillRect(0, 0, W, H);

  // Header band
  const gradient = ctx.createLinearGradient(0, 0, W, 640);
  gradient.addColorStop(0, C.primary);
  gradient.addColorStop(1, C.primaryContainer);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.roundRect(0, 0, W, 640, [0, 0, 48, 48]);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.beginPath();
  ctx.arc(W - 90, 110, 260, 0, Math.PI * 2);
  ctx.fill();

  if (logo) ctx.drawImage(logo, PAD, 64, 84, 84);
  text("ZeroEmit", PAD + (logo ? 104 : 0), 122, 600, 46, "#ffffff");
  text(data.name ? `${data.name}'s charging impact` : "My charging impact", PAD, 262, 600, 38, C.onPrimaryContainer);
  const kg = data.co2Kg.toFixed(1);
  text(kg, PAD, 432, 700, 164, "#ffffff");
  ctx.font = font(700, 164);
  text("kg", PAD + ctx.measureText(kg).width + 18, 432, 600, 60, "#ffffff");
  text("of CO₂ avoided", PAD, 508, 500, 50, "#ffffff");
  text(data.periodLabel, PAD, 578, 500, 34, C.onPrimaryContainer);

  // Stat tiles
  const gap = 24;
  const tileW = (W - PAD * 2 - gap * 2) / 3;
  const stats: [string, string, string][] = [
    ["ENERGY", data.kwh.toFixed(data.kwh >= 100 ? 0 : 1), "kWh"],
    ["GREEN CHARGES", data.greenRate === null ? "—" : `${Math.round(data.greenRate * 100)}`, data.greenRate === null ? "" : "%"],
    ["STREAK", String(data.streak), data.streak === 1 ? "day" : "days"],
  ];
  stats.forEach(([label, value, unit], i) => {
    const x = PAD + i * (tileW + gap);
    const y = 700;
    ctx.fillStyle = C.card;
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, tileW, 230, 28);
    ctx.fill();
    ctx.stroke();
    text(label, x + 32, y + 62, 600, 24, C.muted);
    // Shrink big values (e.g. 1,240 kWh) until value + unit fit inside the tile.
    let size = 72;
    const fits = () => {
      ctx.font = font(700, size);
      const valueWidth = ctx.measureText(value).width;
      ctx.font = font(600, Math.round(size * 0.42));
      return valueWidth + (unit ? 10 + ctx.measureText(unit).width : 0) <= tileW - 64;
    };
    while (size > 36 && !fits()) size -= 4;
    text(value, x + 32, y + 162, 700, size, C.primary);
    if (unit) {
      ctx.font = font(700, size);
      text(unit, x + 32 + ctx.measureText(value).width + 10, y + 162, 600, Math.round(size * 0.42), C.muted);
    }
  });

  text("Charging when the grid is cleaner.", PAD, 1060, 600, 46, C.ink);
  text("CO₂ avoided is estimated against charging", PAD, 1122, 400, 30, C.muted);
  text("without timing it around the grid.", PAD, 1164, 400, 30, C.muted);

  ctx.fillStyle = C.border;
  ctx.fillRect(PAD, 1224, W - PAD * 2, 2);
  text("zero-emit.vercel.app", PAD, 1290, 600, 32, C.primary);
  text("India's grid, charged cleaner", W - PAD, 1290, 400, 28, C.muted, "right");

  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't create the image"))), "image/png"));
}

function cardData(charges: Charge[], period: Period, name: string): CardData {
  const selected = period === "month" ? chargesInMonth(charges) : charges;
  const summary = impactSummary(selected);
  return {
    name,
    periodLabel: period === "month" ? new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(new Date()) : "All time",
    co2Kg: summary.co2Kg,
    kwh: summary.kwh,
    greenRate: summary.greenRate,
    streak: currentStreakDays(charges),
  };
}

// The image is generated as soon as the sheet opens (or the period changes),
// so tapping Share calls navigator.share straight from the tap — Safari only
// allows it inside the user's gesture, which an await in between would lose.
export function ShareImpactModal({ charges, name, onClose }: { charges: Charge[]; name: string; onClose: () => void }) {
  const [period, setPeriod] = useState<Period>(() => (chargesInMonth(charges).length ? "month" : "all"));
  const [image, setImage] = useState<{ period: Period; file: File; url: string } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let url = "";
    drawCard(cardData(charges, period, name)).then((blob) => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setImage({ period, file: new File([blob], "zeroemit-impact.png", { type: "image/png" }), url });
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [charges, period, name]);

  const ready = image?.period === period ? image : null;
  const summary = impactSummary(period === "month" ? chargesInMonth(charges) : charges);
  const shareText = `I avoided ${summary.co2Kg.toFixed(1)} kg of CO₂ by charging my EV when the grid was cleaner. zero-emit.vercel.app`;
  const canShareFile = Boolean(ready && typeof navigator !== "undefined" && navigator.canShare?.({ files: [ready.file] }));

  async function share() {
    if (!ready) return;
    try {
      await navigator.share({ files: [ready.file], title: "My ZeroEmit impact", text: shareText });
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") showToast("Couldn't open the share sheet. Try downloading the image instead.");
    }
  }

  function download() {
    if (!ready) return;
    const link = document.createElement("a");
    link.href = ready.url;
    link.download = "zeroemit-impact.png";
    link.click();
    showToast("Image saved");
  }

  return <Modal title="Share your impact" onClose={onClose}>
    <div className="segmented" role="tablist" aria-label="Period">
      <button role="tab" aria-selected={period === "month"} className={period === "month" ? "active" : ""} onClick={() => setPeriod("month")}>This month</button>
      <button role="tab" aria-selected={period === "all"} className={period === "all" ? "active" : ""} onClick={() => setPeriod("all")}>All time</button>
    </div>
    <div className="share-preview">
      {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: URL, nothing for next/image to optimise */}
      {ready ? <img src={ready.url} alt={`Impact card: ${summary.co2Kg.toFixed(1)} kg of CO₂ avoided`}/> : <p className="personal-note">{failed ? "Couldn't create the image on this device." : "Creating your card…"}</p>}
    </div>
    <div className="share-actions">
      {canShareFile && <button className="primary-button" onClick={share}><Icon name="share" size={18}/> Share</button>}
      <button className={canShareFile ? "forecast-button action-button" : "primary-button"} onClick={download} disabled={!ready}><Icon name="download" size={18}/> Download image</button>
    </div>
  </Modal>;
}
