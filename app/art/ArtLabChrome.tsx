import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "../components/SiteChrome";
import { artFactions, artLab } from "../../lib/art-lab/manifest";
import "../art-lab.css";

export function ArtLabChrome({ active, children, wide = false }: { active: string; children: ReactNode; wide?: boolean }) {
  return (
    <>
      <SiteHeader />
      <main id="main-content" className={`art-lab ${wide ? "is-wide" : ""}`}>
        <nav className="art-lab-nav" aria-label="Art Lab">
          <Link href="/art" className="art-lab-brand" aria-current={active === "index" ? "page" : undefined}>Faction Art Lab</Link>
          {artFactions.map(f => (
            <Link key={f.id} href={`/art/${f.id}`} aria-current={active === f.id ? "page" : undefined} style={{ ["--faction-accent" as string]: f.accent }}>{f.name}</Link>
          ))}
          {process.env.NODE_ENV !== "production" && <Link href="/art/review" aria-current={active === "review" ? "page" : undefined} className="art-lab-review-tab">Review</Link>}
        </nav>
        {children}
        <div className="art-lab-source">
          <p>
            Resolved from <code>{artLab.mod.repo}</code> @ <code>{artLab.mod.commit.slice(0, 12)}</code> by <code>npm run sync:art</code>.
            Only files recorded in <code>ART-PROVENANCE.json</code> are published, each checked against its recorded SHA-256 ({Object.keys(artLab.files).length} files).
            Internal review page: not indexed, not linked from the public site.
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
