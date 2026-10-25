import type { Metadata } from "next";
import { SiteHeader, SiteFooter } from "../components/SiteChrome";
import { AdminHub } from "../components/AdminHub";

export const metadata: Metadata = { title: "Admin | RTS AI", robots: { index: false, follow: false } };

// The owner's tools and where each runs: on rtsai.net for an owner email (lib/admin.ts), and in the local app.
export default function AdminPage() {
  return <><SiteHeader /><AdminHub /><SiteFooter /></>;
}
