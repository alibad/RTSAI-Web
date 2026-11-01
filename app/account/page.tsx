import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "../components/SiteChrome";
import { AccountCenter } from "../components/AccountCenter";

export const metadata: Metadata = { title: "Your account — RTS AI", robots: { index: false, follow: false } };

// The player's own account: their analytics choice, a download of their data, and deleting the account.
export default function AccountPage() {
  return <><SiteHeader /><AccountCenter /><SiteFooter /></>;
}
