import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { ArrowRight, Mic, ShieldCheck, Zap } from "lucide-react";
import Link from "next/link";
import { CompanionDemo } from "./components/CompanionDemo";
import { HeroTrailer } from "./components/HeroTrailer";
import { FactionFlag, LineupImage } from "./components/FactionVisuals";
import { FactionCard } from "./components/FactionCard";
import { HqHills, HqStones } from "./components/hq-path/hq-path";
import { getModRelease, isPublished, macInstaller } from "../lib/mod-release";
import { buildTrailer } from "../lib/trailer";
import { factions, dossierForRoster, rosterFactions } from "../lib/game-content";
// Last, so the Path layer (the kit, home-path.css, pages-path.css) loads after the components' own styles.
import { PathPage } from "./components/PathChrome";

const canonicalUrl = "https://rtsai.net";
const description = "Seven real-world factions. One fictional war. A modern real-time strategy game with an AI co-commander. Play in your browser or download the Windows alpha.";

export const metadata: Metadata = { alternates: { canonical: "/" } };

const numberWords = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
const count = (n: number) => numberWords[n] ?? String(n);

export default async function Home() {
  const modRelease = getModRelease();
  const mod = isPublished(modRelease) ? modRelease : null;
  const macRelease = mod ? macInstaller(mod) : null;
  const downloadStatus = mod
    ? `The ${mod.version} alpha is out for Windows${macRelease ? " and macOS" : ""}.`
    : "The Windows download is coming soon.";
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
  const steps = [
    { title: "Choose your side", text: `${count(modern.length)} real-world factions, each with its own doctrine, signature units, voice and counters. A fictional war, never a real one.` },
    { title: "Build and fight", text: "Classic top-down or isometric, in your browser. Its own art, sound and maps: nothing else to install." },
    { title: "Keep the final say", text: "The optional local co-commander sees only what you see, and you review every order. The browser game runs without it." },
  ];

  return (
    <PathPage home>
      <main id="main-content">
        <section className="hqp-hero rts-hero" id="top" aria-labelledby="hero-title">
          <div className="hqp-hero-sun" aria-hidden="true" />
          <div className="hqp-hero-grid">
            <div className="hqp-hero-copy">
              <p className="hqp-eyebrow">RTS AI · Modern real-time strategy</p>
              <h1 className="hqp-display" id="hero-title">Seven real-world factions. <em>One fictional war.</em></h1>
              <p className="hqp-lede">A real-time strategy game with its own art, sound and maps. Play it free in your browser.</p>
              <div className="hqp-ctas">
                <a className="hqp-btn hqp-btn-ember" href="/play/" data-analytics-event="play_browser">Play in your browser</a>
                <Link className="hqp-btn hqp-btn-ghost" href="/factions">Choose your side <ArrowRight size={17} aria-hidden="true" /></Link>
              </div>
              <nav className="rts-flags" aria-label="The seven factions">{modern.map((f, i) =>
                <Link key={f.id} href={`/factions/${f.id}`} style={{ "--faction-accent": f.accent, "--i": i } as CSSProperties}><FactionFlag factionId={f.id} name={f.name} accent={f.accent} size="md" eager /><span>{f.name}</span></Link>)}</nav>
            </div>
            <div className="hqp-hero-art">
              <div className="rts-army" aria-hidden="true">{modern.map((f, i) =>
                <figure key={f.id} className="rts-army-unit" style={{ "--faction-accent": f.accent, "--i": i } as CSSProperties}>
                  <LineupImage factionId={f.id} alt="" sizes="(min-width: 860px) 54vw, 100vw" priority={i === 0} />
                  <figcaption><FactionFlag factionId={f.id} name={f.name} accent={f.accent} size="sm" eager={i === 0} />{f.name}<small>{f.title}</small></figcaption>
                </figure>)}</div>
            </div>
          </div>
          <HqHills />
        </section>

        <section className="hqp-section hqp-tint" aria-labelledby="how-title">
          <div className="hqp-inner">
            <div className="hqp-head">
              <div><p className="hqp-eyebrow">How it plays</p><h2 className="hqp-display" id="how-title">Pick a side. <em>Take command.</em></h2></div>
              <p className="hqp-lede">A standalone game in development, free to play in your browser now. {downloadStatus}</p>
            </div>
            <HqStones steps={steps} />
          </div>
        </section>

        <section className="hqp-section" aria-labelledby="faction-entry-title">
          <div className="hqp-inner">
            <div className="hqp-head">
              <div><p className="hqp-eyebrow">The factions</p><h2 className="hqp-display" id="faction-entry-title">Choose your <em>side.</em></h2></div>
              <Link className="rts-more" href="/factions">All factions <ArrowRight size={17} aria-hidden="true" /></Link>
            </div>
            <div className="rts-factions">{rosterFactions("ra2").filter(f => dossierForRoster(f)).map(f => <FactionCard key={f.id} faction={f} compact />)}</div>
          </div>
        </section>

        <section className="hqp-section hqp-tint" aria-labelledby="companion-title">
          <div className="hqp-inner rts-commander">
            <div>
              <p className="hqp-eyebrow">The AI co-commander</p>
              <h2 className="hqp-display" id="companion-title">Your battlefield. <em>Your final say.</em></h2>
              <ul className="rts-proof">
                <li><ShieldCheck size={18} aria-hidden="true" /> Sees only what you see</li>
                <li><Mic size={18} aria-hidden="true" /> Optional local companion</li>
                <li><Zap size={18} aria-hidden="true" /> Review before applying</li>
              </ul>
              <Link className="rts-more" href="/companion">How the co-commander works <ArrowRight size={17} aria-hidden="true" /></Link>
            </div>
            {trailer ? <div>
              <div className="hqp-screen rts-screen"><div className="hqp-chrome"><i /><i /><i /><span>RTS AI · gameplay</span></div><HeroTrailer video={trailer.video} poster={trailer.poster} /></div>
              <p className="rts-caption">Earlier companion demonstration. Voice and model capabilities depend on the installed runtime.</p>
            </div> : <CompanionDemo />}
          </div>
        </section>

        <section className="hqp-section rts-closing-band" aria-labelledby="closing-title">
          <div className="hqp-inner rts-closing">
            <div>
              <p className="hqp-eyebrow">Play now</p>
              <h2 className="hqp-display" id="closing-title">Play in your browser. <em>Or on your computer.</em></h2>
            </div>
            <div>
              <p>{mod ? `Free to play in your browser at rtsai.net/play. RTS AI ${mod.version} is out for Windows${macRelease ? " and macOS" : ""}.` : "RTS AI is in development and free to play in your browser at rtsai.net/play. The Windows download is coming soon."}</p>
              <div className="hqp-ctas">
                <a className="hqp-btn hqp-btn-ember" href="/play/" data-analytics-event="play_browser">Play in your browser</a>
                {mod && <Link className="hqp-btn hqp-btn-ghost" href="/download">Download for {macRelease ? "Windows or Mac" : "Windows"}</Link>}
              </div>
              <Link className="rts-more" href="/factions">Meet the factions <ArrowRight size={17} aria-hidden="true" /></Link>
            </div>
          </div>
        </section>
      </main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
    </PathPage>
  );
}
