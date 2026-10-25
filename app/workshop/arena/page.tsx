import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader, SiteFooter } from "../../components/SiteChrome";
import { AiArena } from "../../components/AiArena";
import { AdminGate } from "../../components/AdminGate";
import { WorkshopNav } from "../../components/WorkshopNav";
import { resolveMode } from "../../../lib/game-content";
import { ADMIN_BUILD } from "../../../lib/admin";
import "../workshop.css";
import "../evals/evals.css";
import "./arena.css";
export const metadata: Metadata = { title: "AI Arena | RTS AI", description: "Brains play the live game against the built-in AIs and you: win rates, every choice, speed and cost.", alternates: { canonical: "/workshop/arena" }, robots: { index: false, follow: false } };
// Admin tool that needs this machine (lib/admin.ts): on rtsai.net the owner gets a card naming the Arena runner, and
// vite.config.ts stubs AiArena out of the public bundle.
export default async function ArenaPage({ searchParams }: { searchParams: Promise<{ mode?: string | string[] }> }) {
  const mode = resolveMode((await searchParams).mode);
  return <><SiteHeader /><AdminGate surface="arena">{ADMIN_BUILD && <main id="main-content" className="workshop-page eval-page arena-page"><header className="workshop-intro"><div><span className="eyebrow">THE WORKSHOP / AI ARENA</span><h1>Who wins?</h1></div><p>Brains play the live game against the built-in AIs, and against you.<br /><Link href="/workshop">← Back to map editor</Link></p></header><WorkshopNav mode={mode} active="arena" /><AiArena /></main>}</AdminGate><SiteFooter /></>;
}
