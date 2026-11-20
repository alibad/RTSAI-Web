import type { Metadata } from "next";
import { ArrowRight, BrainCircuit, Map, RadioTower, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { CompanionDemo } from "../components/CompanionDemo";
import { gameSource } from "../components/SiteChrome";
import { getMacAlphaRelease, macSigningSentence } from "../../lib/mac-release";
import { PathPage } from "../components/PathChrome";

export const metadata: Metadata = {
  title: "AI Game Companion | RTS AI",
  description: "Optional local co-commander integration: fog-respecting advice, explicit order review and manual control. Public release capabilities vary.",
  alternates: { canonical: "/companion" },
};

export default function CompanionPage() {
  const macAlpha = getMacAlphaRelease();
  return (
    <PathPage><main id="main-content">
      <header className="route-hero route-hero-split">
        <div><span className="eyebrow">OPTIONAL LOCAL CO-COMMANDER</span><h1>A second mind.<br /><em>Your final say.</em></h1>
          <p>Ask for advice, review a proposed order and decide whether to apply it. These controls passed local integration checks; model and voice runtimes are optional.</p>
          <div className="hero-actions"><Link className="primary-action" href="/download">Check release capabilities</Link><a className="text-action" href={gameSource} target="_blank" rel="noreferrer">Inspect the game source <ArrowRight size={16} /></a></div>
        </div><CompanionDemo />
      </header>
      <section className="companion-section"><div className="section-intro"><span className="section-number">LOCALLY VERIFIED CONTROLS</span><h2>Read the battlefield.<br />Review the order.</h2><p>Deterministic OpenRA rules remain authoritative. Advice does not execute orders, and a proposal must identify the action you are reviewing.</p></div>
        <div className="principles">
          <article><RadioTower size={22} /><h3>Grounded advice</h3><p>Critical alerts and grounded strategy answers can run without a model. Local scripted-model checks verify the client boundary, not model quality.</p><span>Observation → advice</span></article>
          <article><BrainCircuit size={22} /><h3>Respects fog of war</h3><p>The companion receives a compact observation of what your player can see. Engine validation checks ownership, targets and current state before accepting an order.</p><span>Visible state → live validation</span></article>
          <article><ShieldCheck size={22} /><h3>You retain command</h3><p>Apply confirms the displayed proposal ID. A lost reply leaves the outcome unknown until its exact receipt is checked. Turning AI Off leaves manual gameplay available.</p><span>Propose · review · apply</span></article>
        </div>
      </section>
      <section className="architecture-section"><div className="architecture-copy"><span className="section-number">CAPABILITIES BY BUILD</span><h2>Local checks.<br />Clear release limits.</h2><p>The public static browser build has no local companion service routes. Locally served development builds support reviewed orders. The macOS 15+ {macAlpha ? "alpha is downloadable and" : "candidate is not published and"} supports Apple silicon companion use, but contains no model, transcription or speech runtime. {macSigningSentence(macAlpha)} Intel companion support and another Mac remain pending.</p><p>Hosted model access requires authenticated, durable budget controls and provider approval. That service is not advertised as available. Native and browser unit-voice language selection is separate from companion speech; human listening review remains pending.</p><Link href="/privacy#ai-co-commander">Read AI privacy <ArrowRight size={16} /></Link></div>
        <div className="route-diagram" aria-label="Local companion architecture"><div><Map size={18} /><span>OpenRA engine<small>visible state and order receipts</small></span></div><i /><div className="active-route"><Sparkles size={18} /><span>Local companion<small>advice + reviewed proposals</small></span></div><i /><div><ShieldCheck size={18} /><span>Player review<small>explicit proposal ID</small></span></div><i /><div className="model-routes"><span>Optional runtime<small>not included in the Mac candidate</small></span></div></div>
      </section>
    </main></PathPage>
  );
}
