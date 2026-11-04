import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ProfileScreen } from "../components/profile-screen";
import { lastMonthKey } from "../lib/recap";

export const metadata: Metadata = { title: "Profile" };

// ?share=last-month came from month-end notifications sent before the recap
// replaced the share card: it now opens last month's recap, which ends with one.
export default async function ProfilePage({ searchParams }: PageProps<"/profile">) {
  const { share } = await searchParams;
  if (share === "last-month") redirect(`/recap?period=${lastMonthKey()}`);
  return <ProfileScreen/>;
}
