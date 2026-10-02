import { Github } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { AccountNav } from "./AccountNav";

export const gameSource = "https://github.com/alibad/OpenRA-AI";

function Brand({ footer = false }: { footer?: boolean }) {
  return (
    <Link className="brand" href="/" aria-label="RTS AI home">
      <Image className="brand-symbol" src="/brand/rtsai-mark-64.png" alt="" width={34} height={34} priority={!footer} />
      <span className="brand-wordmark">RTS <b>AI</b>{!footer && <small>Red Alert 2 mod</small>}</span>
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
          <a className="nav-source" href={gameSource} target="_blank" rel="noreferrer"><Github size={15} /> Game source</a>
          <AccountNav />
        </div>
      </nav>
      <p className="legal-strip">Independent project. EA has not endorsed and does not support this product.</p>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer>
      <Brand footer />
      <p>EA has not endorsed and does not support this product. OpenRA AI is an independent GPL-3.0 project.</p>
      <div>
        <Link href="/companion">How the companion works</Link>
        <a href={gameSource}>Game source</a>
        <a href={`${gameSource}/blob/main/LICENSE`}>License</a>
        <Link href="/privacy">Privacy</Link>
      </div>
    </footer>
  );
}
