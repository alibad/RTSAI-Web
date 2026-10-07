/* Cameos are 60x48 PNGs shown at native and 2x size; next/image would resample them. */
/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ADMIN_BUILD } from "../../../lib/admin";
import { ArtLabChrome } from "../ArtLabChrome";
import { RosterBoard, type RosterGroup } from "../../components/art/RosterBoard";
import { artFactionById, artLab, categoryLabels, factionActors, fileUrl, renderSpec, spriteWithUrls } from "../../../lib/art-lab/manifest";
import { artCategories } from "../../../lib/art-lab/types";
import { roleLabel } from "../../../lib/art-lab/labels";

type Props = { params: Promise<{ factionId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const faction = artFactionById((await params).factionId);
  return { title: faction ? `${faction.name} art | Faction Art Lab` : "Faction Art Lab", robots: { index: false, follow: false } };
}

export default async function FactionArtPage({ params }: Props) {
  if (!ADMIN_BUILD) notFound();
  const faction = artFactionById((await params).factionId);
  if (!faction) notFound();
  const actors = factionActors(faction.id);
  const groups: RosterGroup[] = artCategories
    .map(category => ({
      id: category, label: categoryLabels[category],
      tiles: actors.filter(a => a.category === category).map(a => ({ spec: renderSpec(a), sprite: spriteWithUrls(a), href: `/art/${faction.id}/${a.id}`, role: roleLabel(a), feedback: { factionId: faction.id, actorId: a.id } })),
    }))
    .filter(g => g.tiles.length);
  const issues = actors.flatMap(a => [
    ...(a.voxel?.unusedSequences.filter(s => !/^slow-/.test(s.sequence)).map(s => `${a.name}: model sequence “${s.sequence}” (${s.vxl ?? s.external?.ref}) is defined but no rules trait draws it.`) ?? []),
    ...(a.voxel?.parts.flatMap(p => p.model.problems.map(x => `${a.name} ${p.label}: ${x}`)) ?? []),
    ...(a.voxel?.parts.filter(p => p.model.external).map(p => `${a.name} ${p.label}: drawn from ${p.model.external!.reason}, not published here.`) ?? []),
  ]);
  return (
    <ArtLabChrome active={faction.id}>
      <header className="art-hero" style={{ ["--faction-accent" as string]: faction.accent }}>
        <span className="eyebrow">{faction.side} · {actors.length} buildable units</span>
        <h1>{faction.name}</h1>
        <p>The whole roster as the battlefield draws it, then every build-palette cameo. Open a unit for its parts, sequences, palettes, generator source and provenance.</p>
        {faction.catalogId && <p className="art-crosslink">Public dossier: <Link href={`/factions/${faction.catalogId}`}>/factions/{faction.catalogId}</Link></p>}
      </header>
      {issues.length > 0 && (
        <section className="art-issues" aria-label="Found while resolving the rules">
          <h2>Found while resolving the rules</h2>
          <ul>{issues.map(i => <li key={i}>{i}</li>)}</ul>
        </section>
      )}
      <RosterBoard groups={groups} tints={artLab.render.mapTints} />
      <section className="art-cameo-wall" aria-label="Build-palette cameos">
        <h2>Build-palette cameos</h2>
        <p>60×48, shown at native size and at 2×, in build-palette order per queue.</p>
        <div className="art-cameo-grid">
          {actors.map(a => (
            <Link key={a.id} href={`/art/${faction.id}/${a.id}`} className="art-cameo-card">
              {a.cameo.file ? <><img src={fileUrl(a.cameo.file)!} width={60} height={48} alt="" className="art-cameo-native" loading="lazy" /><img src={fileUrl(a.cameo.file)!} width={120} height={96} alt={`${a.name} cameo`} className="art-cameo-2x" loading="lazy" /></> : <span className="art-empty">No published cameo</span>}
              <span><b>{a.name}</b><small>{categoryLabels[a.category]} · {roleLabel(a)}</small></span>
            </Link>
          ))}
        </div>
      </section>
    </ArtLabChrome>
  );
}
