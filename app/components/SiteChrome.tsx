import { Gamepad2, Github } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { AccountNav } from "./AccountNav";
import { PrivacyChoicesLink } from "./ConsentBanner";

export const gameSource = "https://github.com/alibad/OpenRA-AI";
export const modSource = "https://github.com/alibad/RTSAI-Mod";

function Brand({ footer = false }: { footer?: boolean }) {
  return (
    <Link className="brand" href="/" aria-label="RTS AI home">
      <Image className="brand-symbol" src="/brand/rtsai-mark-64.png?v=command-red-2531" alt="" width={34} height={34} priority={!footer} unoptimized />
      <span className="brand-wordmark">RTS <b>AI</b>{!footer && <small>Modern real-time strategy</small>}</span>
    </Link>
  );
}

export function SiteHeader() {
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <nav className="site-nav" aria-label="Primary navigation">
        <Brand />
        <div className="nav-links">
          <Link href="/factions">Factions</Link>
          <Link href="/download">Download</Link>
        </div>
        <div className="nav-actions">
          <a className="nav-play" href="/play/" data-analytics-event="play_browser"><Gamepad2 size={15} /> Play</a>
          <a className="nav-source" href={modSource} target="_blank" rel="noreferrer"><Github size={15} /> Game source</a>
          <AccountNav />
        </div>
      </nav>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer>
      <Brand footer />
      <p>Independent project. EA has not endorsed and does not support this product.</p>
      <div>
        <Link href="/companion">How the companion works</Link>
        <a href={modSource}>Game source</a>
        <a href={`${gameSource}/blob/main/LICENSE`}>Companion license</a>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <PrivacyChoicesLink />
      </div>
    </footer>
  );
}
