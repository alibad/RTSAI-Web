import { ArrowRight, BrainCircuit, Download, Flag, Mic, ShieldCheck, Swords, Zap } from "lucide-react";
import Link from "next/link";
import { CompanionDemo } from "./components/CompanionDemo";
import { HeroTrailer } from "./components/HeroTrailer";
import { gameSource, SiteFooter, SiteHeader } from "./components/SiteChrome";
import { getGameRelease } from "../lib/release";
import { getModRelease, isPublished, RA2_REQUIREMENT, windowsInstaller } from "../lib/mod-release";
import { buildTrailer } from "../lib/trailer";
import { factions } from "../lib/game-content";
import { CatalogImage } from "./components/ContentGuide";

const canonicalUrl = "https://rtsai.net";
const listFormat = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

export default async function Home() {
  const gameRelease = await getGameRelease();
  const windowsRelease = gameRelease.windows;
  const latestPublicVersion = gameRelease.macos?.version ?? windowsRelease.version;
  const primaryWindowsUrl = windowsRelease.installerUrl ?? windowsRelease.url;
  const modRelease = getModRelease();
  const mod = isPublished(modRelease) ? modRelease : null;
  const modInstaller = windowsInstaller(modRelease);
  const trailer = buildTrailer();
  const inRa2 = factions.filter((faction) => faction.variants.ra2.status === "implemented");
  const comingToRa2 = factions.filter((faction) => faction.variants.ra2.status !== "implemented");
  const pillars = [
    {
      id: "factions",
      icon: Flag,
      status: `${inRa2.length} of ${factions.length} in RA2`,
      title: "Five modern nations",
      description: `${listFormat.format(factions.map((faction) => faction.name))}, each with its own doctrine, signature units and counters.`,
      href: "/factions",
      action: "Meet the factions",
    },
    {
      id: "companion",
      icon: BrainCircuit,
      status: "Playable now",
      title: "An AI co-commander",
      description: "It sees only what you can see, speaks up when it matters, answers spoken questions, and plays for you only when you switch AUTO on.",
      href: "/companion",
      action: "How it works",
    },
    {
      id: "ra2",
      icon: Swords,
      status: mod ? "Alpha" : "In development",
      title: "Red Alert 2 on OpenRA",
      description: "Install the mod, point it at the Red Alert 2 you own on Steam, the EA app or disc, and play. Commercial game files are never bundled.",
      href: "/download",
      action: mod ? "Download the mod" : "Release status",
    },
  ];
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${canonicalUrl}/#website`,
        url: canonicalUrl,
        name: "RTS AI",
        description: "An OpenRA mod for Red Alert 2 with five modern nations and an AI co-commander.",
        inLanguage: "en",
      },
      mod && modInstaller
        ? {
          "@type": ["SoftwareApplication", "VideoGame"],
          "@id": `${canonicalUrl}/#rtsai-mod`,
          name: "RTS AI",
          url: `${canonicalUrl}/download`,
          description: `A Red Alert 2 mod for OpenRA with five modern nations and an AI co-commander. ${RA2_REQUIREMENT}`,
          applicationCategory: "GameApplication",
          operatingSystem: "Windows 10, Windows 11",
          softwareVersion: mod.version,
          downloadUrl: modInstaller.url,
          isAccessibleForFree: true,
          image: `${canonicalUrl}/social-card.png`,
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD", url: `${canonicalUrl}/download` },
        }
        : {
          "@type": ["SoftwareApplication", "VideoGame"],
          "@id": `${canonicalUrl}/#openra-ai`,
          name: "OpenRA AI",
          url: canonicalUrl,
          description: "The public OpenRA AI alpha: an interruptible AI companion, optional AUTO command, and the Red Sea 2026 theatre.",
          applicationCategory: "GameApplication",
          operatingSystem: gameRelease.macos ? "Windows 10, Windows 11, macOS" : "Windows 10, Windows 11",
          softwareVersion: windowsRelease.version,
          downloadUrl: primaryWindowsUrl,
          isAccessibleForFree: true,
          image: `${canonicalUrl}/social-card.png`,
          sameAs: [gameSource],
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD", url: primaryWindowsUrl },
        },
    ],
  };

  return (
    <>
      <SiteHeader />
      <main id="main-content">
        <header className="hero" id="top">
          <div className="hero-radar" aria-hidden="true"><i /><i /><i /><span /></div>
          <div className="hero-copy">
            <Link className="eyebrow hero-release-link" href="/factions"><span className="live-dot" /> A Red Alert 2 mod for OpenRA <ArrowRight size={13} /></Link>
            <h1>Your battlefield.<br /><em>Now it talks back.</em></h1>
            <p className="hero-lede">Five modern nations on the Red Alert 2 battlefield, and an AI co-commander that watches your match, speaks when it matters, and takes command only when you hand it over.</p>
            <div className="hero-actions">
              <Link className="primary-action" href="/factions"><Flag size={17} /> Meet the factions</Link>
              <Link className="text-action" href="/download">{mod ? `Download RTS AI ${mod.version}` : "Play the current alpha"} <ArrowRight size={17} /></Link>
            </div>
            <div className="hero-proof">
              <span><ShieldCheck size={15} /> Sees only what you see</span>
              <span><Mic size={15} /> Ask by voice</span>
              <span><Zap size={15} /> AUTO when you say so</span>
            </div>
          </div>
          {trailer ? <HeroTrailer video={trailer.video} poster={trailer.poster} /> : <CompanionDemo />}
        </header>

        <section className="home-experiences" aria-labelledby="pillars-title">
          <div className="home-section-heading">
            <span className="section-number">WHAT YOU GET</span>
            <h2 id="pillars-title">Five nations.<br />One co-commander.</h2>
            <p>You bring your own copy of Red Alert 2. The mod brings the factions and the AI.</p>
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

        <section className="home-faction-entry" aria-labelledby="faction-entry-title">
          <CatalogImage id="red-sea-key-art" />
          <div>
            <span className="section-number">FACTIONS / RED ALERT 2</span>
            <h2 id="faction-entry-title">A side worth knowing.<br />A force worth mastering.</h2>
            <p>{listFormat.format(inRa2.map((faction) => faction.name))} {inRa2.length === 1 ? "is" : "are"} being built for Red Alert 2 now{comingToRa2.length > 0 ? `; ${listFormat.format(comingToRa2.map((faction) => faction.name))} follow` : ""}. Every faction keeps one identity across the game and this guide.</p>
            <Link className="primary-action" href="/factions">Explore the factions <ArrowRight size={17} /></Link>
          </div>
        </section>

        <section className="closing-section home-closing">
          {mod ? (
            <>
              <div>
                <span className="eyebrow">Free alpha for Windows</span>
                <h2>Bring Red Alert 2. Command.</h2>
              </div>
              <div>
                <p>RTS AI {mod.version} is out for Windows. {RA2_REQUIREMENT}</p>
                <div className="hero-actions">
                  <Link className="primary-action" href="/download"><Download size={17} /> Download RTS AI {mod.version}</Link>
                  <Link className="text-action" href="/companion">How the companion works <ArrowRight size={17} /></Link>
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <span className="eyebrow">Free playable alpha</span>
                <h2>Play what exists today.</h2>
              </div>
              <div>
                <p>The public alpha {windowsRelease.version} runs on OpenRA&apos;s classic Red Alert with the AI companion and the Red Sea 2026 theatre. The Red Alert 2 mod is the next release.</p>
                <div className="hero-actions">
                  <Link className="primary-action" href="/download"><Download size={17} /> Download {latestPublicVersion}</Link>
                  <Link className="text-action" href="/companion">How the companion works <ArrowRight size={17} /></Link>
                </div>
              </div>
            </>
          )}
        </section>
      </main>
      <SiteFooter />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
    </>
  );
}
