import type { ReactNode } from "react";
import { Github } from "lucide-react";
import Link from "next/link";
import { AccountNav } from "./AccountNav";
import { EaTopline, gameSource, modSource } from "./SiteChrome";
import { HqFamilyFooter, HqSunset } from "./hq-path/hq-path";
import "./hq-path/hq-path.css";
import "../home-path.css";
import "../pages-path.css";

// The Human Quest hub. Kept here, not imported from the kit: a constant from a client module is only a reference on the server.
const hub = "https://www.humanquest.net";
const familyFonts = "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..800;1,9..144,300..600&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap";

/** The Human Quest questbar for RTS AI: its own mark, the family chip, the site's real nav, sign-in and one Play button. */
export function PathQuestbar() {
  return (
    <>
      {/* The kit CSS imports these fonts too; this link keeps them if a production bundle drops a non-leading @import. React hoists it into <head>. */}
      <link rel="stylesheet" href={familyFonts} precedence="default" />
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <EaTopline />
      <header className="hqp-questbar" data-hqp-t="tools">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <Link className="hqp-mark" href="/" aria-label="RTS AI home"><img src="/brand/rtsai-mark-64.png?v=command-red-2531" alt="" width={34} height={34} /><span>RTS <b>AI</b></span></Link>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <a className="hqp-family" href={hub} title="Part of Human Quest"><img src={`${hub}/logos/humanquest.svg`} alt="" />Human Quest · Tools</a>
        <nav className="hqp-nav" aria-label="Primary navigation">
          <Link href="/factions">Factions</Link>
          <Link href="/download">Download</Link>
          <a href={modSource} target="_blank" rel="noreferrer"><Github size={15} aria-hidden="true" /> Game source</a>
        </nav>
        <details className="hqp-menu"><summary>Menu</summary>
          <div><Link href="/factions">Factions</Link><Link href="/download">Download</Link><a href={modSource} target="_blank" rel="noreferrer">Game source</a><a href={hub}>Human Quest</a></div>
        </details>
        <AccountNav />
        {/* /play is the browser game's own Vercel project behind a proxy, not a page of this app: a plain link. */}
        <a className="hqp-btn hqp-btn-ember hqp-btn-cta" href="/play/" data-analytics-event="play_browser">Play</a>
      </header>
    </>
  );
}

/** The sun setting behind the hills, the family footer with the site's own links, and the EA notice. */
export function PathFooter() {
  return (
    <>
      <HqSunset sunX={900} />
      <HqFamilyFooter current="RTS AI" territory="tools" extra={[
        { label: "How the companion works", href: "/companion" },
        { label: "Game source", href: modSource },
        { label: "Companion license", href: `${gameSource}/blob/main/LICENSE` },
        { label: "Privacy", href: "/privacy" },
        { label: "Terms", href: "/terms" },
      ]} />
      <div className="rts-legal"><p>Independent project. EA has not endorsed and does not support this product.</p></div>
    </>
  );
}

/** Classes for a public page in the Path night look. The sign-in gate takes them too (SignInGate's shell). */
export const pathShell = "rts-path rts-inner hqp-page";

/**
 * A public page of rtsai.net in the Human Quest family look, kept at night (RTS AI has no day mode).
 * `home` leaves out the inner-page layer (pages-path.css keys on .rts-inner).
 */
export function PathPage({ children, home = false }: { children: ReactNode; home?: boolean }) {
  return (
    <div className={home ? "rts-path hqp-page" : pathShell} data-hqp-t="tools">
      <PathQuestbar />
      {children}
      <PathFooter />
    </div>
  );
}
