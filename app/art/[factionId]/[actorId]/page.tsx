/* Cameos are 60x48 PNGs shown at native and 2x size; next/image would resample them. */
/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArtLabChrome } from "../../ArtLabChrome";
import { UnitViewer } from "../../../components/art/UnitViewer";
import { artActor, artFactionById, artLab, categoryLabels, fileUrl, renderSpec, spriteWithUrls } from "../../../../lib/art-lab/manifest";
import { roleLabel } from "../../../../lib/art-lab/labels";
import { unitById } from "../../../../lib/game-content";
import type { ArtFile } from "../../../../lib/art-lab/types";

type Props = { params: Promise<{ factionId: string; actorId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { actorId } = await params;
  const actor = artActor(actorId);
  return { title: actor ? `${actor.name} (${actor.id}) | Faction Art Lab` : "Faction Art Lab", robots: { index: false, follow: false } };
}

const short = (sha: string) => sha.slice(0, 12);
const wdist = (v: number[]) => v.join(", ");

function FileRow({ file }: { file: ArtFile }) {
  const p = file.provenance;
  return (
    <tr>
      <td><a href={file.url} download><code>{file.modPath.replace("mods/rtsai/modern-factions/", "")}</code></a></td>
      <td>{(file.bytes / 1024).toFixed(1)} KB</td>
      <td><code title={file.sha256}>{short(file.sha256)}</code></td>
      <td>{p.origin} · {p.generator}</td>
      <td>
        {p.source ? <>{p.source.repo} <code>{p.source.commit.slice(0, 10)}</code> {p.source.date}<br /><code>{p.source.path}</code></> : null}
        {p.generation ? <>{p.generation.model} rev <code>{p.generation.model_revision?.slice(0, 10)}</code>, seed {p.generation.seed}, variant {p.generation.variant}, {p.generation.runtime}{p.tool ? <>, <code>{p.tool}</code></> : null}{p.date ? `, ${p.date}` : ""}</> : null}
        {p.script ? <><br /><code>{p.script}</code>{p.geometry ? <> · geometry <code>{p.geometry}</code></> : null}</> : null}
      </td>
    </tr>
  );
}

export default async function ActorArtPage({ params }: Props) {
  const { factionId, actorId } = await params;
  const faction = artFactionById(factionId);
  const actor = artActor(actorId);
  if (!faction || !actor || actor.factionId !== faction.id) notFound();
  const catalogUnit = actor.catalogUnitId ? unitById(actor.catalogUnitId) : undefined;
  const v = actor.voxel;
  const s = actor.sprite;
  const palette = artLab.palettes[v?.palette ?? s?.palette ?? ""];
  const index = faction.actors.indexOf(actor.id);
  const prev = faction.actors[(index - 1 + faction.actors.length) % faction.actors.length];
  const next = faction.actors[(index + 1) % faction.actors.length];
  const cameoUrl = fileUrl(actor.cameo.file);
  const prompt = actor.cameo.file ? artLab.files[actor.cameo.file]?.provenance.generation : undefined;
  return (
    <ArtLabChrome active={faction.id}>
      <nav className="art-unit-nav" aria-label="Units">
        <Link href={`/art/${faction.id}`}>← {faction.name} overview</Link>
        <span>
          <Link href={`/art/${faction.id}/${prev}`}>← {artActor(prev)?.name}</Link>
          <Link href={`/art/${faction.id}/${next}`}>{artActor(next)?.name} →</Link>
        </span>
      </nav>
      <header className="art-unit-hero" style={{ ["--faction-accent" as string]: faction.accent }}>
        <div className="art-unit-cameos">
          {cameoUrl ? <><img src={cameoUrl} width={60} height={48} alt="" className="art-cameo-native" /><img src={cameoUrl} width={120} height={96} alt={`${actor.name} cameo`} className="art-cameo-2x" /></> : <span className="art-empty">No published cameo</span>}
          <small>Cameo 60×48 · 1× and 2×</small>
        </div>
        <div>
          <span className="eyebrow">{faction.name} · {categoryLabels[actor.category]} · {roleLabel(actor)}{actor.cost !== null ? ` · $${actor.cost}` : ""}</span>
          <h1>{actor.name}</h1>
          <p className="art-unit-id"><code>{actor.id}</code> · rules <code>{actor.definedIn.replace("mods/rtsai/", "")}</code> · {actor.render === "voxel" ? "voxel model" : "SHP sprite"}</p>
          {actor.description && <p className="art-unit-desc">{actor.description}</p>}
          {catalogUnit && (
            <div className="art-catalog">
              <span className="section-number">CATALOG · {catalogUnit.variants.ra2?.role ?? catalogUnit.role}</span>
              <b>{catalogUnit.variants.ra2?.name ?? catalogUnit.name}</b>
              <p>{catalogUnit.story}</p>
              <Link href={`/units/${catalogUnit.id}`}>Public unit page →</Link>
            </div>
          )}
        </div>
      </header>

      <UnitViewer spec={renderSpec(actor)} sprite={spriteWithUrls(actor)} tints={artLab.render.mapTints} feedback={{ factionId: faction.id, actorId: actor.id }} check sheet eager />

      {v && (
        <section className="art-facts" aria-label="How the parts come together">
          <h2>How the parts come together</h2>
          <p className="art-hint">From the resolved rules: each trait draws one model sequence of image <code>{v.image}</code>; turrets pivot at <code>Turreted.Offset</code> and turn with the body plus their own facing.</p>
          <div className="art-table-wrap"><table className="art-table">
            <thead><tr><th>Part</th><th>Trait / sequence</th><th>Files</th><th>Sections (HVA)</th><th>Attachment</th></tr></thead>
            <tbody>{v.parts.map(p => (
              <tr key={p.id}>
                <td><b>{p.label}</b>{p.requiresCondition ? <><br /><small>when <code>{p.requiresCondition}</code></small></> : null}</td>
                <td><code>{p.id}</code><br /><small>sequence <code>{p.model.sequence}</code>{p.tickRate !== null ? `, TickRate ${p.tickRate}` : ""}{p.showShadow ? "" : ", no shadow"}</small></td>
                <td>{p.model.vxl ? <><a href={fileUrl(p.model.vxl)!} download><code>{p.model.vxl}</code></a><br /><a href={fileUrl(p.model.hva)!} download><code>{p.model.hva}</code></a></> : <small>{p.model.external?.reason}</small>}</td>
                <td>{p.model.sections.map(sec => <div key={sec.name}><code>{sec.name}</code> {sec.size.join("×")} vox, scale {sec.scale.toFixed(4)}, bounds [{sec.bounds.join(", ")}], {sec.voxels.toLocaleString()} voxels ({sec.remapVoxels} remap), normals {sec.normalsMode === 4 ? "RA2" : sec.normalsMode === 2 ? "TS" : sec.normalsMode}</div>)}<small>{p.model.frames} HVA frame{p.model.frames === 1 ? "" : "s"}</small>{p.model.problems.map(x => <div key={x} className="art-warn">{x}</div>)}</td>
                <td>{p.turret ? <>Turreted <code>{p.turret.name}</code>: offset ({wdist(p.turret.offset)}), initial facing {p.turret.initialFacing}, turn speed {p.turret.turnSpeed}</> : <>Body offset ({wdist(p.offset)})</>}{p.barrel ? <><br />Barrel: offset ({wdist(p.barrel.localOffset)}), recoil {p.barrel.recoil}, recovery {p.barrel.recoilRecovery}</> : null}</td>
              </tr>
            ))}</tbody>
          </table></div>
          {v.unusedSequences.length > 0 && (
            <div className="art-issues"><h3>Defined but not drawn</h3><ul>{v.unusedSequences.map(u => <li key={u.sequence}>Model sequence <code>{u.sequence}</code> ({u.vxl ? <code>{u.vxl}</code> : u.external?.reason}) exists in the model sequences, but no rules trait on <code>{actor.id}</code> draws it.</li>)}</ul></div>
          )}
          <h3>Armaments</h3>
          <ul className="art-list">{v.armaments.map(a => <li key={a.name + a.weapon}><code>{a.name}</code> {a.weapon ?? "(no weapon)"} · turret <code>{a.turret}</code> · local offset {a.localOffset.length ? a.localOffset.map(o => `(${wdist(o)})`).join(" ") : "none"} · recoil {a.recoil}{a.muzzleSequence ? ` · muzzle ${a.muzzleSequence} (RA2 effect art, not published)` : ""}</li>)}</ul>
          <h3>Render settings</h3>
          <ul className="art-list">
            <li>RenderVoxels: Scale {v.scale} ({(v.scale / 12).toFixed(3)} px per voxel), LightPitch {v.lightPitch}, LightYaw {v.lightYaw}, ambient ({v.ambient.join(", ")}), diffuse ({v.diffuse.join(", ")})</li>
            <li>BodyOrientation: CameraPitch {v.cameraPitch} ({((v.cameraPitch * 360) / 1024).toFixed(1)}°), QuantizedFacings {v.quantizedFacings}{v.quantizedFacings === 0 ? " (any facing)" : ""}, classic perspective fudge {String(v.useClassicPerspectiveFudge)}</li>
            <li>Normals palette <code>{v.normals.palette}</code> ({v.normals.type}); shadow palette <code>{v.shadowPalette}</code> (black, alpha {artLab.render.shadowColor[3]}/255){v.cruiseAltitude !== null ? `; cruise altitude ${v.cruiseAltitude}` : ""}</li>
          </ul>
        </section>
      )}

      <section className="art-facts" aria-label="Palette and remap">
        <h2>Palette and player colour</h2>
        {palette ? <p className="art-hint">Draws with <code>{palette.name}</code> ({palette.definedBy}) from <code>{palette.file}</code>{palette.remap.length ? <>; remap indices {palette.remap[0]}–{palette.remap[palette.remap.length - 1]} take the player colour (OpenRA PlayerColorRemap)</> : null}{palette.basePalette ? <>; base palette <code>{palette.basePalette}</code></> : null}. Index 0 is transparent.</p> : <p className="art-hint">No published palette.</p>}
      </section>

      <section className="art-facts" aria-label="Generator source">
        <h2>Generator source</h2>
        {actor.generator.length ? actor.generator.map(g => (
          <div key={g.commit + g.script} className="art-gen">
            <p><a href={g.scriptUrl} target="_blank" rel="noreferrer"><code>{g.script}</code></a> in {g.repo} at <code>{g.commit.slice(0, 10)}</code>{g.geometry ? <> · meshes from <code>{g.geometry}</code></> : null}</p>
            <ul className="art-list">{g.functions.map(f => <li key={f.url + f.part}><a href={f.url} target="_blank" rel="noreferrer"><code>{f.name}</code></a> <small>{f.file}:{f.line}{f.part ? ` · ${f.part}` : ""}</small></li>)}</ul>
            {g.note && <p className="art-hint">{g.note}</p>}
          </div>
        )) : <p className="art-hint">No generator recorded.</p>}
        {prompt && <div className="art-gen"><p>Cameo: text-to-image, {prompt.model} (seed {prompt.seed}, variant {prompt.variant}).</p><blockquote>{prompt.prompt}</blockquote></div>}
      </section>

      <section className="art-facts" aria-label="Provenance">
        <h2>Provenance</h2>
        <p className="art-hint">Every published file below is listed in <code>ART-PROVENANCE.json</code> with this SHA-256; the sync refuses anything else.</p>
        <div className="art-table-wrap"><table className="art-table">
          <thead><tr><th>File</th><th>Size</th><th>SHA-256</th><th>Origin</th><th>Source</th></tr></thead>
          <tbody>{actor.files.map(key => artLab.files[key] && <FileRow key={key} file={artLab.files[key]} />)}</tbody>
        </table></div>
      </section>
    </ArtLabChrome>
  );
}
