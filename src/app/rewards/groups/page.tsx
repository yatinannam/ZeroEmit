import type { Metadata } from "next";
import { GroupScreen, GroupsHub } from "../../components/groups";

export const metadata: Metadata = { title: "Groups" };

// ?code=ABC234 shows that group's board; ?join=ABC234 (an invite link) also
// opens the join sheet. Without either, the list of the device's groups.
export default async function GroupsPage({ searchParams }: PageProps<"/rewards/groups">) {
  const { code, join } = await searchParams;
  const raw = typeof join === "string" ? join : typeof code === "string" ? code : null;
  if (raw === null) return <GroupsHub/>;
  return <GroupScreen rawCode={raw} joining={typeof join === "string"}/>;
}
