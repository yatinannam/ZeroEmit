import { ProfileScreen } from "../components/profile-screen";

export default async function ProfilePage({ searchParams }: PageProps<"/profile">) {
  const { share } = await searchParams;
  return <ProfileScreen shareLastMonth={share === "last-month"}/>;
}
