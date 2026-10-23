import type { ReactNode } from "react";
import type { Metadata } from "next";
import { SignInGate } from "../components/SignInGate";
import { SiteFooter, SiteHeader } from "../components/SiteChrome";

export const metadata: Metadata = {
  applicationName: "Faction Studio",
  icons: {
    icon: [{ url: "/brand/faction-studio/favicon-32.png?v=command-red-2531", sizes: "32x32", type: "image/png" }],
    shortcut: "/brand/faction-studio/favicon.ico?v=command-red-2531",
    apple: [{ url: "/brand/faction-studio/apple-touch-icon.png?v=command-red-2531", sizes: "180x180" }],
  },
};

// Members-only like the game and the other creative tools: the Studio streams hundreds of MB of art from Blob storage.
export default function MembersOnly({ children }: { children: ReactNode }) {
  return <SignInGate feature="Faction Studio" header={<SiteHeader />} footer={<SiteFooter />}>{children}</SignInGate>;
}
