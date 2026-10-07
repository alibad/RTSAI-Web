/* Cameos are 60x48 PNGs shown at native and 2x size; next/image would resample them. */
/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ADMIN_BUILD } from "../../lib/admin";
import { ArtLabChrome } from "./ArtLabChrome";
import { RosterBoard, type RosterGroup } from "../components/art/RosterBoard";
import { artFactions, artLab, categoryLabels, factionActors, fileUrl, renderSpec, spriteWithUrls } from "../../lib/art-lab/manifest";
import { artCategories } from "../../lib/art-lab/types";
import { roleLabel } from "../../lib/art-lab/labels";

export const metadata: Metadata = {
  title: "Faction Art Lab | RTS AI",
  description: "Internal review of every modern-faction sprite, voxel model and cameo, as the game draws them.",
  robots: { index: false, follow: false },
};

// The Art Lab shows provenance internals (prompts, seeds, hashes): admin builds only. Players use /viewer.
export default function ArtLabIndex() {
  if (!ADMIN_BUILD) notFound();
  const groups: RosterGroup[] = artCategories
    .map(category => ({
      id: category, label: categoryLabels[category],
      columns: artFactions.map(f => ({
        id: f.id, label: f.name,
        tiles: factionActors(f.id).filter(a => a.category === category).map(a => ({ spec: renderSpec(a), sprite: spriteWithUrls(a), href: `/art/${f.id}/${a.id}`, role: roleLabel(a), feedback: { factionId: f.id, actorId: a.id } })),
      })),
    }))
    .filter(g => g.columns.some(c => c.tiles.length));
  const totals = artFactions.map(f => ({ faction: f, actors: factionActors(f.id) }));
  return (
    <ArtLabChrome active="index">
      <header className="art-hero">
        <span className="eyebrow">Internal review · {Object.keys(artLab.actors).length} buildable units in 5 factions</span>
        <h1>Faction Art Lab</h1>
        <p>Every sprite, voxel model and cameo of the five modern factions, drawn in the browser from the mod&apos;s own files with the game&apos;s rules, projection, lighting and player colours. Open a unit to take it apart, step through its facings and leave feedback.</p>
      </header>
      <section className="art-faction-cards" aria-label="Factions">
        {totals.map(({ faction, actors }) => (
          <Link key={faction.id} href={`/art/${faction.id}`} className="art-faction-card" style={{ ["--faction-accent" as string]: faction.accent }}>
            <span className="eyebrow">{faction.side}</span>
            <h2>{faction.name}</h2>
            <p>{artCategories.map(c => [c, actors.filter(a => a.category === c).length] as const).filter(([, n]) => n).map(([c, n]) => `${n} ${categoryLabels[c].toLowerCase()}`).join(" · ")}</p>
            <div className="art-cameo-strip">{actors.map(a => a.cameo.file && <img key={a.id} src={fileUrl(a.cameo.file)!} width={60} height={48} alt={a.name} title={a.name} loading="lazy" />)}</div>
          </Link>
        ))}
      </section>
      <RosterBoard title="Five-faction comparison" groups={groups} tints={artLab.render.mapTints} />
    </ArtLabChrome>
  );
}
