import { NextRequest, NextResponse } from "next/server";
import { parseGroupCode, validateGroupName } from "../../../lib/groups";
import { fromOwnSite, readLimitedJson } from "../../../lib/server/http";
import { createGroup, joinGroup, leaveGroup, listMemberGroups, readGroupBoard, type GroupError } from "../../../lib/server/groups";
import { isUuid, leaderboardConfigured } from "../../../lib/server/leaderboard";

const NOT_CONFIGURED = { error: "The leaderboard isn't set up on this server." };
// Same short CDN cache as the public board for a board read without `me`.
const PUBLIC_CACHE = "public, s-maxage=10, stale-while-revalidate=30";

// `code` is what the app reads to say what went wrong.
const ERRORS: Record<GroupError, { status: number; error: string }> = {
  "not-member": { status: 404, error: "Join the leaderboard first" },
  forbidden: { status: 403, error: "Not your entry" },
  "no-group": { status: 404, error: "No group has that code" },
  "too-many": { status: 409, error: "Already in the most groups allowed" },
  full: { status: 409, error: "That group is full" },
  rate: { status: 429, error: "Too many tries" },
};
const failure = (error: GroupError) => NextResponse.json({ error: ERRORS[error].error, code: error }, { status: ERRORS[error].status });

// GET ?code=ABC234[&me=<id>]: the group's board this month.
// GET ?member=<id>: the groups that member is in.
export async function GET(request: NextRequest) {
  if (!leaderboardConfigured) return NextResponse.json(NOT_CONFIGURED, { status: 503 });
  const params = request.nextUrl.searchParams;
  const member = params.get("member");
  const me = params.get("me");
  try {
    if (member !== null) {
      if (!isUuid(member)) return NextResponse.json({ error: "Invalid member" }, { status: 400 });
      return NextResponse.json({ groups: await listMemberGroups(member) }, { headers: { "Cache-Control": "no-store" } });
    }
    const code = parseGroupCode(params.get("code"));
    if (!code) return NextResponse.json({ error: "Invalid group code" }, { status: 400 });
    if (me !== null && !isUuid(me)) return NextResponse.json({ error: "Invalid member" }, { status: 400 });
    const board = await readGroupBoard(code, me);
    if (!board) return failure("no-group");
    return NextResponse.json(board, { headers: { "Cache-Control": me === null ? PUBLIC_CACHE : "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't load the group" }, { status: 502 });
  }
}

// { action: "create", id, key, name } | { action: "join" | "leave", id, key, code }
// `id` and `key` are the device's leaderboard entry (only its key proves it).
export async function POST(request: NextRequest) {
  if (!fromOwnSite(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!leaderboardConfigured) return NextResponse.json(NOT_CONFIGURED, { status: 503 });
  const body = await readLimitedJson(request, 1024) as { action?: unknown; id?: unknown; key?: unknown; name?: unknown; code?: unknown } | null;
  if (!body || !isUuid(body.id) || !isUuid(body.key)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { id, key } = body;
  try {
    if (body.action === "create") {
      const name = validateGroupName(body.name);
      if (!name) return NextResponse.json({ error: "Invalid name", code: "name" }, { status: 400 });
      const result = await createGroup(id, key, name);
      return result.ok ? NextResponse.json(result.value) : failure(result.error);
    }
    const code = parseGroupCode(body.code);
    if (!code || (body.action !== "join" && body.action !== "leave")) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    if (body.action === "join") {
      const result = await joinGroup(id, key, code);
      return result.ok ? NextResponse.json(result.value) : failure(result.error);
    }
    const result = await leaveGroup(id, key, code);
    return result.ok ? NextResponse.json({ ok: true }) : failure(result.error);
  } catch {
    return NextResponse.json({ error: "Couldn't update the group" }, { status: 502 });
  }
}
