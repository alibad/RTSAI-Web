import type { Metadata } from "next";
import type { ReactNode } from "react";

// The Faction Art Lab is an internal review tool: reachable by URL, never indexed, never in the sitemap or nav.
export const metadata: Metadata = {
  title: "Faction Art Lab | RTS AI",
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

export default function ArtLabLayout({ children }: { children: ReactNode }) {
  return children;
}
