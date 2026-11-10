import type { ReactNode } from "react";
import { SignInGate } from "../components/SignInGate";
import { PathFooter, PathQuestbar, pathShell } from "../components/PathChrome";

export default function MembersOnly({ children }: { children: ReactNode }) {
  return <SignInGate feature="Map Workshop" shell={pathShell} header={<PathQuestbar />} footer={<PathFooter />}>{children}</SignInGate>;
}
