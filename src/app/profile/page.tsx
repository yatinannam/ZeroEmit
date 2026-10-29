import type { Metadata } from "next";
import { ProfileScreen } from "../components/profile-screen";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage({ searchParams }: PageProps<"/profile">) {
  const { share } = await searchParams;
  return <ProfileScreen shareLastMonth={share === "last-month"}/>;
}
