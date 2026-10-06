import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader, SiteFooter } from "../../components/SiteChrome";
import { BehaviorLab } from "../../components/BehaviorLab";
import { WorkshopNav } from "../../components/WorkshopNav";
import { resolveMode } from "../../../lib/game-content";
import { ADMIN_BUILD } from "../../../lib/admin";
import "../workshop.css";
import "./evals.css";
export const metadata:Metadata={title:"AI Behavior Lab | RTS AI",description:"Compare scripted AI policies, replay behavior experiments and run local headless OpenRA evaluations.",alternates:{canonical:"/workshop/evals"},robots:{index:false,follow:false}};
// Admin tool: 404 in public builds, where vite.config.ts also stubs BehaviorLab out of the bundle (lib/admin.ts).
export default async function EvalsPage({searchParams}:{searchParams:Promise<{mode?:string|string[]}>}){
  if(!ADMIN_BUILD)notFound();
  const mode=resolveMode((await searchParams).mode);
  return <><SiteHeader/><main id="main-content" className="workshop-page eval-page"><header className="workshop-intro"><div><span className="eyebrow">THE WORKSHOP / AI TESTING</span><h1>Put an idea to the test.</h1></div><p>Compare behaviors. Replay decisions. Find the edge.<br/><Link href="/workshop">← Back to map editor</Link></p></header><WorkshopNav mode={mode} active="evals"/><BehaviorLab initialMode={mode}/></main><SiteFooter/></>;
}
