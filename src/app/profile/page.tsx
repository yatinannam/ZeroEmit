import type { Metadata } from "next";
import { ProfileScreen } from "../components/profile-screen";

export const metadata: Metadata = { title: "Profile" };

// Prerendered, so the avatar opens it at once (the old ?share=last-month
// link is redirected on the device, in ProfileScreen).
export default function ProfilePage() {
  return <ProfileScreen/>;
}
