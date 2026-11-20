import type { Metadata } from "next";
import { SignInGate } from "../components/SignInGate";
import { ContinueTo } from "./ContinueTo";
import { PathFooter, PathQuestbar, pathShell } from "../components/PathChrome";

export const metadata: Metadata = { title: "Sign in | RTS AI", robots: { index: false, follow: false } };

/** /signin?next=/play/… — where the browser game sends signed-out players; returns them once they're in. */
export default function SignInPage() {
  return <SignInGate feature="game" title="Sign in to play RTS AI" openAccount shell={pathShell} header={<PathQuestbar />} footer={<PathFooter />}><ContinueTo /></SignInGate>;
}
