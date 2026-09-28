import { NextRequest, NextResponse } from "next/server";
import { parseSubscriptionBody, pushConfigured, removeSubscription, saveSubscription } from "../../../lib/server/push";

const NOT_CONFIGURED = { error: "Scheduled notifications aren't set up on this server yet." };
const MAX_BODY_BYTES = 4096;

async function readJson(request: NextRequest): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// Create or update this device's push subscription and the little the
// scheduler needs: state + city name, which scheduled notifications are on,
// and the streak count / last charge day for the streak reminder.
export async function POST(request: NextRequest) {
  if (!pushConfigured) return NextResponse.json(NOT_CONFIGURED, { status: 503 });
  const value = parseSubscriptionBody(await readJson(request));
  if (!value) return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  try {
    await saveSubscription(value);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't save the subscription" }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!pushConfigured) return NextResponse.json(NOT_CONFIGURED, { status: 503 });
  const body = await readJson(request) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint !== "string" || body.endpoint.length > 1024) return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  try {
    await removeSubscription(body.endpoint);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't remove the subscription" }, { status: 502 });
  }
}
