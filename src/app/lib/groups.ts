import { validateDisplayName, type LeaderboardResponse } from "./leaderboard";

// Group challenges: a private monthly board for a class, an office or a
// housing society, joined with a short code. Built on leaderboard entries,
// so a group board ranks the same Eco points as the public one. Rules shared
// by the app and the server.
export const MAX_GROUPS_PER_MEMBER = 5;
export const MAX_GROUP_MEMBERS = 50;
const MAX_GROUP_NAME_LENGTH = 30;

// 6 characters with no 0/O or 1/I to mix up when read out or typed:
// 32^6 is about a billion codes.
export const GROUP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const GROUP_CODE_LENGTH = 6;
const CODE_PATTERN = new RegExp(`^[${GROUP_CODE_ALPHABET}]{${GROUP_CODE_LENGTH}}$`);

export const isGroupCode = (value: unknown): value is string => typeof value === "string" && CODE_PATTERN.test(value);

// What someone typed ("abc-234", " ABC 234 ") as a code, or null.
export function parseGroupCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.toUpperCase().replace(/[\s-]/g, "");
  return isGroupCode(code) ? code : null;
}

// "ABC-234": easier to read out than six letters in a row.
export const formatGroupCode = (code: string) => `${code.slice(0, 3)}-${code.slice(3)}`;

// The same rules as a display name, with room for "Pune Office EV Club".
export const validateGroupName = (raw: unknown) => validateDisplayName(raw, MAX_GROUP_NAME_LENGTH);

// The link an invite shares: opens the group with the join sheet up.
export const groupInvitePath = (code: string) => `/rewards/groups?join=${code}`;

export type GroupInfo = { code: string; name: string; members: number };
// A group's board for this month: the usual board plus who the group is.
export type GroupBoardResponse = LeaderboardResponse & { group: GroupInfo };
// One of the caller's groups, for the list on Rewards: `rank` this month
// (null until they have a point), out of `ranked` members with points.
export type MyGroup = GroupInfo & { rank: number | null; ranked: number };
