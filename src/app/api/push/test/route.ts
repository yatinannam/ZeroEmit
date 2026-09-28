import { NextRequest, NextResponse } from "next/server";
import { claimTestSlot, getSubscription, pushConfigured, sendPush } from "../../../lib/server/push";

// Sends one push from the server to an already-registered device — the same
// path scheduled reminders take — so "Send a test notification" proves the
// whole chain works, not just the phone's local notifications.
export async function POST(request: NextRequest) {
  if (!pushConfigured) return NextResponse.json({ error: "Scheduled notifications aren't set up on this server yet." }, { status: 503 });
  const text = await request.text();
  let endpoint: unknown;
  try { endpoint = text.length <= 2048 ? (JSON.parse(text) as { endpoint?: unknown }).endpoint : undefined; } catch { endpoint = undefined; }
  if (typeof endpoint !== "string") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const sub = await getSubscription(endpoint);
  if (!sub) return NextResponse.json({ error: "This device isn't registered for scheduled notifications" }, { status: 404 });
  if (!(await claimTestSlot(endpoint))) return NextResponse.json({ error: "Wait a few seconds before sending another test" }, { status: 429 });
  const ok = await sendPush(sub, { title: "ZeroEmit scheduled notifications work", body: `Sent from the server, the same way your reminders for ${sub.name} will arrive.`, url: "/profile", tag: "zeroemit-test" });
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "The push service didn't accept the notification" }, { status: 502 });
}
