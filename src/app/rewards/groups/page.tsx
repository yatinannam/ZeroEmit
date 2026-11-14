import type { Metadata } from "next";
import { GroupsPageContent } from "../../components/groups";

export const metadata: Metadata = { title: "Groups" };

// ?code=ABC234 shows that group's board; ?join=ABC234 (an invite link) also
// opens the join sheet. Without either, the list of the device's groups.
// Prerendered; the query is read on the device.
export default function GroupsPage() {
  return <GroupsPageContent/>;
}
