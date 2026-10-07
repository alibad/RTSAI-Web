import type { CSSProperties } from "react";
import { ArrowRight, BrainCircuit, Download, Flag, Globe, Mic, MonitorDown, PackageCheck, ShieldCheck, Zap } from "lucide-react";
import Link from "next/link";
import { CompanionDemo } from "./components/CompanionDemo";
import { HeroTrailer } from "./components/HeroTrailer";
import { SiteFooter, SiteHeader } from "./components/SiteChrome";
import { FactionFlag } from "./components/FactionVisuals";
import { FrontLine } from "./components/FrontLine";
import { getModRelease, isPublished } from "../lib/mod-release";
import { buildTrailer } from "../lib/trailer";
import { factions, dossierForRoster, rosterFactions } from "../lib/game-content";
import { FactionCard } from "./components/FactionCard";
import "./home.css";

const canonicalUrl = "https://rtsai.net";
const description = "Seven real-world factions. One fictional war. A modern real-time strategy game with an AI co-commander. Coming to your browser and Windows.";

export default async function Home() {
  const modRelease = getModRelease();
  const mod = isPublished(modRelease) ? modRelease : null;
  const trailer = buildTrailer();
  const modern = factions.filter(f => f.variants.ra2.status === "implemented");
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": `${canonicalUrl}/#website`, url: canonicalUrl, name: "RTS AI", description, inLanguage: "en" },
      // Announced, not released: no offer, price or download until the owner publishes a build.
      { "@type": ["SoftwareApplication", "VideoGame"], "@id": `${canonicalUrl}/#rtsai`, name: "RTS AI", url: canonicalUrl, description, genre: "Real-time strategy", applicationCategory: "GameApplication", gamePlatform: ["Web browser", "Windows"], image: `${canonicalUrl}/social-card.png` },
    ],
  };
  const pillars = [
    { id: "factions", icon: Flag, status: `${modern.length} factions`, title: "Real-world factions", description: "Each with its own doctrine, signature units, voice and counters. A fictional war, never a real one.", href: "/factions", action: "Choose your side" },
    { id: "companion", icon: BrainCircuit, status: "AI co-commander", title: "A co-commander that talks back", description: "It sees only what you see, speaks up when it matters, answers by voice, and takes command only when you say so.", href: "/companion", action: "How it works" },
    { id: "install", icon: PackageCheck, status: "Coming soon", title: "Nothing else to install", description: "Its own art, sound and maps. Play in your browser at rtsai.net/play, or download it for Windows.", href: "/download", action: "Release status" },
  ];

  return (
    <>
      <SiteHeader />
      <main id="main-content">
        <header className="home-hero" id="top">
          <div className="home-hero-copy">
            <span className="eyebrow">RTS AI · Modern real-time strategy</span>
            <h1>Seven real-world factions.<br /><em>One fictional war.</em></h1>
            <p className="hero-lede">Command a modern army with an AI co-commander at your side. Its own art, sound and maps: nothing else to install.</p>
            <div className="hero-actions">
              {mod ? <Link className="primary-action" href="/download"><Download size={17} /> Download RTS AI {mod.version}</Link> : <span className="soon-action" aria-disabled="true"><Globe size={17} /> Play in your browser <small>Coming soon</small></span>}
              <Link className="text-action" href="/factions">Choose your side <ArrowRight size={17} /></Link>
            </div>
            <ul className="home-platforms" aria-label="Platforms">
              <li><Globe size={15} /> Browser <small>coming soon</small></li>
              <li><MonitorDown size={15} /> Windows <small>{mod ? mod.version : "coming soon"}</small></li>
              <li><PackageCheck size={15} /> Nothing else to install</li>
            </ul>
          </div>
          <nav className="home-flags" aria-label="The seven factions">{modern.map(f =>
            <Link key={f.id} href={`/factions/${f.id}`} style={{ "--faction-accent": f.accent } as CSSProperties}><FactionFlag factionId={f.id} name={f.name} accent={f.accent} size="md" eager /><span>{f.name}</span></Link>)}</nav>
          <FrontLine priority={3} />
        </header>

        <section className="home-experiences" aria-labelledby="pillars-title">
          <div className="home-section-heading">
            <span className="section-number">WHAT YOU GET</span>
            <h2 id="pillars-title">Seven factions.<br />One co-commander.</h2>
            <p>A standalone game in development. Browser and Windows releases are coming soon.</p>
          </div>
          <div className="home-experience-grid">
            {pillars.map((pillar, index) => (
              <Link href={pillar.href} className="home-experience-card" key={pillar.id}>
                <div><span>{String(index + 1).padStart(2, "0")}</span><i>{pillar.status}</i></div>
                <pillar.icon size={26} />
                <h3>{pillar.title}</h3>
                <p>{pillar.description}</p>
                <strong>{pillar.action} <ArrowRight size={16} /></strong>
              </Link>
            ))}
          </div>
        </section>

        <section className="home-companion" aria-labelledby="companion-title">
          <div>
            <span className="section-number">THE AI CO-COMMANDER</span>
            <h2 id="companion-title">Your battlefield.<br /><em>Now it talks back.</em></h2>
            <ul className="hero-proof">
              <li><ShieldCheck size={15} /> Sees only what you see</li>
              <li><Mic size={15} /> Ask by voice</li>
              <li><Zap size={15} /> AUTO when you say so</li>
            </ul>
            <Link className="text-action" href="/companion">How the co-commander works <ArrowRight size={17} /></Link>
          </div>
          {trailer ? <HeroTrailer video={trailer.video} poster={trailer.poster} /> : <CompanionDemo />}
        </section>

        <section className="home-nations" aria-labelledby="faction-entry-title">
          <div className="faction-group-heading"><div><span className="section-number">THE FACTIONS</span><h2 id="faction-entry-title">Choose your side.</h2></div><Link className="text-action" href="/factions">All factions <ArrowRight size={17} /></Link></div>
          <div className="faction-tile-grid">{rosterFactions("ra2").filter(f => dossierForRoster(f)).map(f => <FactionCard key={f.id} faction={f} compact />)}</div>
        </section>

        <section className="closing-section home-closing">
          <div>
            <span className="eyebrow">{mod ? `RTS AI ${mod.version}` : "Coming soon"}</span>
            <h2>Play in your browser.<br />Or on Windows.</h2>
          </div>
          <div>
            <p>{mod ? `RTS AI ${mod.version} is out for Windows. Browser play at rtsai.net/play is coming soon.` : "RTS AI is in development. Browser play at rtsai.net/play and the Windows download are coming soon."}</p>
            <div className="hero-actions">
              <Link className="primary-action" href="/download"><Download size={17} /> {mod ? `Download RTS AI ${mod.version}` : "Release status"}</Link>
              <Link className="text-action" href="/factions">Meet the factions <ArrowRight size={17} /></Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
    </>
  );
}
