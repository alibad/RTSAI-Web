import type { ReactNode } from "react";
import { SignInGate } from "../components/SignInGate";
import { SiteFooter, SiteHeader } from "../components/SiteChrome";

// Members-only like the game and the other creative tools: the Studio streams hundreds of MB of art from Blob storage.
export default function MembersOnly({ children }: { children: ReactNode }) {
  return <SignInGate feature="Faction Studio" header={<SiteHeader />} footer={<SiteFooter />}>{children}</SignInGate>;
}
