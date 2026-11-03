import { NextRequest, NextResponse } from "next/server";
import { fromOwnSite, readLimitedJson } from "../../../lib/server/http";
import { parseSubscriptionBody, pushConfigured, removeSubscription, saveSubscription } from "../../../lib/server/push";

const NOT_CONFIGURED = { error: "Scheduled notifications aren't set up on this server yet." };
const MAX_BODY_BYTES = 4096;

// Create or update this device's push subscription and the little the
// scheduler needs: state + city name, which scheduled notifications are on,
// and the streak count / last charge day for the streak reminder.
export async function POST(request: NextRequest) {
  if (!fromOwnSite(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!pushConfigured) return NextResponse.json(NOT_CONFIGURED, { status: 503 });
  const value = parseSubscriptionBody(await readLimitedJson(request, MAX_BODY_BYTES));
  if (!value) return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  try {
    // On Vercel the first x-forwarded-for entry is the client's address.
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip");
    const result = await saveSubscription(value, ip);
    if (result === "rate-limited") return NextResponse.json({ error: "Too many updates. Try again later." }, { status: 429 });
    // Full: this device keeps its in-app alerts; it can try again later.
    if (result === "full") return NextResponse.json({ error: "Scheduled notifications are full right now. Try again later.", code: "full" }, { status: 503 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't save the subscription" }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!fromOwnSite(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!pushConfigured) return NextResponse.json(NOT_CONFIGURED, { status: 503 });
  const body = await readLimitedJson(request, MAX_BODY_BYTES) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint !== "string" || body.endpoint.length > 1024) return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  try {
    await removeSubscription(body.endpoint);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't remove the subscription" }, { status: 502 });
  }
}
