import type { Metadata } from "next";
import { AccountCenter } from "../components/AccountCenter";
import { PathPage } from "../components/PathChrome";

export const metadata: Metadata = { title: "Your account — RTS AI", robots: { index: false, follow: false } };

// The player's own account: their analytics choice, a download of their data, and deleting the account.
export default function AccountPage() {
  return <PathPage><AccountCenter /></PathPage>;
}
