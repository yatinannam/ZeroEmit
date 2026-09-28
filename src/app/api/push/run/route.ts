import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron, pushConfigured } from "../../../lib/server/push";
import { runPushSchedule } from "../../../lib/server/push-scheduler";

// Called about every 15 minutes by the GitHub Actions workflow
// (.github/workflows/push-schedule.yml) and once a day by Vercel Cron
// (vercel.json), both sending "Authorization: Bearer $CRON_SECRET".
export const maxDuration = 60;

async function handle(request: NextRequest) {
  // Until push is configured there's nothing to do — answer 200 so the
  // scheduler doesn't report a failure every 15 minutes during setup.
  if (!pushConfigured || !process.env.CRON_SECRET) return NextResponse.json({ skipped: "Scheduled notifications aren't configured on this deployment" });
  if (!isAuthorizedCron(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runPushSchedule());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Scheduler failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
