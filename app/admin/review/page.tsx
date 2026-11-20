import type { Metadata } from "next";
import { SiteHeader } from "../../components/SiteChrome";
import { AdminGate } from "../../components/AdminGate";
import { ReviewInbox } from "../../components/review/ReviewInbox";

export const metadata: Metadata = { title: "Review inbox | RTS AI", robots: { index: false, follow: false } };

// The owner's Review inbox (lib/admin.ts): clips of the game from every front, answered with Looks good, Skip or a
// voice note. It works on rtsai.net and in the local app alike: its data is in Firestore, behind an owner-only rule.
// No footer: the inbox is one screen, the clip as large as the window allows.
export default function ReviewPage() {
  return <div className="rv-page"><SiteHeader /><AdminGate surface="inbox"><ReviewInbox /></AdminGate></div>;
}
