import type { ReactNode } from "react";
import { SignInGate } from "../components/SignInGate";
import { SiteFooter, SiteHeader } from "../components/SiteChrome";

export default function MembersOnly({ children }: { children: ReactNode }) {
  return <SignInGate feature="Faction viewer" header={<SiteHeader />} footer={<SiteFooter />}>{children}</SignInGate>;
}
