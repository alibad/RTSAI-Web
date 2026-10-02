import type { Metadata } from "next";
import { ArrowRight, Braces, Layers3, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { CapabilityAtlas } from "../components/CapabilityAtlas";
import { FactionArchive } from "../components/FactionArchive";
import { SiteFooter, SiteHeader } from "../components/SiteChrome";
import { capabilities } from "../../lib/capabilities";

export const metadata: Metadata = {
  title: "Capability Atlas | RTS AI",
  description: "Explore the RTS AI companion, Earth-to-battlefield studio, four original faction tracks, 216 visual artifacts, and the research roadmap behind the platform.",
  alternates: { canonical: "/capabilities" },
  robots: { index: false, follow: true },
};

export default function CapabilitiesPage() {
  const playable = capabilities.filter((capability) => capability.status === "Playable now" || capability.status === "Playable alpha").length;
  return (
    <>
      <SiteHeader />
      <main id="main-content">
        <header className="route-hero capability-hero">
          <div>
            <span className="eyebrow">THE FULL PRODUCT, WITHOUT THE WALL OF TEXT</span>
            <h1>Everything built.<br /><em>At the depth you need.</em></h1>
            <p>Start with outcomes. Filter by the experience you care about. Open any capability to see how it works, what proves it, and where its safety boundary sits.</p>
            <div className="hero-actions"><a className="primary-action" href="#atlas-title">Explore capabilities</a><a className="text-action" href="#build-archive">Browse the build archive <ArrowRight size={16} /></a></div>
          </div>
          <div className="capability-hero-readout" aria-label="Capability Atlas summary">
            <div><Layers3 size={18} /><span><b>{capabilities.length}</b> documented capabilities</span></div>
            <div><ShieldCheck size={18} /><span><b>{playable}</b> playable now or alpha</span></div>
            <div><Braces size={18} /><span><b>3 depths</b> outcome · implementation · boundary</span></div>
          </div>
        </header>
        <CapabilityAtlas />
        <FactionArchive />
        <section className="closing-section atlas-closing">
          <div><span className="section-number">READY TO MOVE FROM READING TO PLAYING?</span><h2>Build a battlefield.<br />Then meet it in the game.</h2></div>
          <div><p>The web studio produces the mission package. The native build delivers the companion, theatre, editor, and full OpenRA experience.</p><div className="hero-actions"><Link className="primary-action" href="/studio">Open Earth studio</Link><Link className="text-action" href="/download">Download the game <ArrowRight size={16} /></Link></div></div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
