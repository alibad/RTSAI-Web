/**
 * What the game the owner plays shows for a unit, and what it replaced.
 *
 * Identity: the rail, the encounter palette and the build-palette mock show the cameo the local PREVIEW copy
 * installs (the art the owner approved), falling back to the release's icon only when the preview has none.
 * Stock units have no preview art and keep the release icon.
 *
 * Sources: art the preview installs is described from the candidate it came from (matched by bytes in
 * preview-server.ts), e.g. "Project created · 3D render", instead of the release files it replaces.
 *
 * History (admin only, tucked away): every earlier picture and model stays reachable, labelled Historical and
 * never presented as current: the release art the preview supersedes, the archive the promotion writes to
 * RTSAI-Art/history/<actor>/, and the older candidates, newest first.
 */
import type { ActorSources, AssetSource } from "./asset-source";
import type { PreviewActor } from "./chain";
import { slotOfKind, type Candidate, type UnitWorkspace } from "./review";

export const PREVIEW_FILE_ROUTE = "/api/art-review/preview-file?path=";
export const HISTORY_ROUTE = "/api/art-review/history";

/** The overlay icon the preview copy installs for this actor (icons/<actor>.png), if any. */
export function previewIconFile(actor: string, entry: PreviewActor | undefined): string | null {
  const icons = (entry?.files ?? []).filter(f => /^icons\/.*\.png$/i.test(f));
  return icons.find(f => f.toLowerCase() === `icons/${actor.toLowerCase()}.png`) ?? icons[0] ?? null;
}

/** The picture that identifies the unit in lists: the preview's cameo, else the release icon. */
export function identityCameo(actor: string, releaseCameo: string | null, entry: PreviewActor | undefined, head: string | null): string | null {
  // Promoted: the release carries the same bytes, so its own icon needs no preview checkout.
  if (entry?.released && releaseCameo) return releaseCameo;
  const file = previewIconFile(actor, entry);
  return file ? `${PREVIEW_FILE_ROUTE}${encodeURIComponent(file)}${head ? `&v=${head.slice(0, 12)}` : ""}` : releaseCameo;
}

const has = (text: string | undefined, re: RegExp) => Boolean(text && re.test(text));

/** How a candidate was made, in the words the rail and Sources use. */
export function candidateOrigin(c: Pick<Candidate, "kind" | "route" | "model">): { kind: AssetSource["kind"]; label: string } {
  const route = c.route ?? "", model = c.model ?? "";
  if (has(route, /glb-voxel|voxel/i) && c.kind === "voxel") return { kind: "project-created", label: "Project created · voxels from 3D" };
  if (has(route, /prerender|render|3d model/i) || has(model, /blender|cycles/i)) return { kind: "project-created", label: "Project created · 3D render" };
  if (has(model, /image.?gen|gpt-image|qwen-image|image generation/i)) return { kind: "generated", label: "AI generated" };
  if (has(model, /authored|procedural|project-geometry/i)) return { kind: "project-created", label: "Project created" };
  return { kind: "unknown", label: "Source unverified" };
}

function candidateSource(c: Candidate, released: boolean): AssetSource {
  const { kind, label } = candidateOrigin(c);
  return {
    kind, label, pack: released ? "RTS AI · RA2" : "RTS AI · RA2 local preview", creator: kind === "unknown" ? null : "RTS AI project", tool: c.model || undefined,
    file: c.dir, evidence: "hash-verified", rights: kind === "unknown" ? "unreviewed" : "project-record",
  };
}

/**
 * Sources for art the preview installs: each slot the preview replaces is described by its candidate; slots it
 * leaves alone keep the release's sources. Null when the preview installs nothing for the actor.
 */
export function installedSources(ws: UnitWorkspace | undefined, entry: PreviewActor | undefined, release: ActorSources | undefined): ActorSources | null {
  if (!entry || (!entry.model && !entry.icon)) return null;
  const find = (id: string | null) => (id ? ws?.candidates.find(c => c.id === id) ?? null : null);
  const model = find(entry.model), icon = find(entry.icon);
  if (!model && !icon) return null;
  const unknown = (pack: string): AssetSource => ({ kind: "unknown", label: "Source unverified", pack, creator: null, evidence: "unknown", rights: "unreviewed" });
  // Promoted art is the release byte for byte, so its candidate's record describes the release as well.
  const released = Boolean(entry.released);
  const modelSource = model ? candidateSource(model, released) : release?.model ?? unknown("Current model");
  const iconSource = icon ? candidateSource(icon, released) : release?.icon ?? unknown("Current icon");
  return {
    model: modelSource, icon: iconSource,
    files: [...(model ? [modelSource] : []), ...(icon ? [iconSource] : []), ...(release?.files ?? []).filter(s => !(model && s.file && /\.(vxl|hva|shp)$/i.test(s.file)) && !(icon && s.file && s.file === release?.icon.file))],
    rules: release?.rules ?? (released ? "RTS AI · RTSAI-Mod" : "RTS AI · RTSAI-Mod (local preview overlay)"),
  };
}

export type HistorySlot = "icon" | "model";
/** One release file as the synced manifest records it. */
export type ReleaseArt = { file: string; url: string; sha256: string; origin: string; generator: string | null; date: string | null };
export type PreviousRelease = { icon: ReleaseArt | null; model: ReleaseArt[] };
export type HistoryEntry = {
  key: string;
  slot: HistorySlot;
  /** Always starts with "Historical · ". */
  label: string;
  /** Where it lived: the release, the history archive, or a candidate folder. */
  origin: "release" | "archive" | "candidate";
  image: string | null;
  /** A candidate id the stage can draw (model entries that are still candidates). */
  candidate?: string;
  /** Draw the release model (the stage item "current"). */
  release?: boolean;
  /** Draw the release before the promotion (the synced manifest's drawing). */
  previous?: boolean;
  generator: string | null;
  date: string | null;
  file: string | null;
};

/** One archived file as RTSAI-Art/history/<actor>/manifest.json lists it (fields read leniently). */
export type ArchivedArt = { file: string; url: string | null; slot: HistorySlot | null; label: string | null; generator: string | null; date: string | null; sha256: string | null;
  /** "generated", "procedural", ... as the provenance record has it. */
  origin?: string | null };

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);
/** Provenance records carry the source commit's date beside repo, path and commit. */
const sourceDate = (s: AssetSource | undefined) => day((s?.source as { date?: string } | undefined)?.date);
const newestFirst = (a: Candidate, b: Candidate) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1);

/**
 * Every superseded picture and model for an actor, newest first within each group: the release art the preview
 * replaces (until promotion), the promotion's archive, then the candidates that were not installed.
 */
export function historyFor(args: {
  actor: string; ws: UnitWorkspace | undefined; entry: PreviewActor | undefined;
  release: { cameo: string | null; hasModel: boolean; sources?: ActorSources };
  archive?: ArchivedArt[];
  /** The synced manifest's release record: after a promotion, the art the new release replaced. */
  previous?: PreviousRelease;
}): HistoryEntry[] {
  const { ws, entry, release, archive = [], previous } = args;
  const out: HistoryEntry[] = [];
  // Once promoted (entry.released) the release IS the installed art; what it replaced lives in the archive.
  const iconInstalled = Boolean(entry && !entry.released && previewIconFile(args.actor, entry));
  const modelInstalled = Boolean(entry && !entry.released && (entry.model || entry.files.some(f => /\.(vxl|shp)$/i.test(f) && !/^icons\//i.test(f))));
  if (iconInstalled && release.cameo) {
    const painted = release.sources?.icon.kind === "generated";
    out.push({ key: "release:icon", slot: "icon", origin: "release", image: release.cameo, release: true,
      label: `Historical · ${painted ? "painted icon" : "release icon"} (current release until the new art is promoted)`,
      generator: release.sources?.icon.tool ?? release.sources?.icon.label ?? null, date: sourceDate(release.sources?.icon), file: release.sources?.icon.file ?? null });
  }
  // The body file names the model (r2qilin.vxl rather than its turret r2qilintur.vxl).
  const modelFiles = (release.sources?.files ?? []).filter(s => s.file && /\.(vxl|shp)$/i.test(s.file) && s.file !== release.sources?.icon.file);
  const base = (f: string | undefined) => (f ?? "").split("/").pop()!.toLowerCase().replace(/\.(vxl|shp)$/, "");
  const modelFile = modelFiles.find(s => base(s.file) === args.actor.toLowerCase()) ?? modelFiles[0];
  if (modelInstalled && release.hasModel) {
    out.push({ key: "release:model", slot: "model", origin: "release", image: null, release: true,
      label: "Historical · game model (current release until the new art is promoted)",
      generator: release.sources?.model.tool ?? release.sources?.model.label ?? null, date: sourceDate(modelFile),
      file: modelFile?.file ?? release.sources?.model.file ?? null });
  }
  // Promoted, not yet archived: the release before the promotion, from the manifest synced at the time.
  const archived = new Set(archive.map(a => a.sha256).filter(Boolean));
  if (entry?.released && previous?.icon && !entry.iconShas?.includes(previous.icon.sha256) && !archived.has(previous.icon.sha256)) {
    const p = previous.icon;
    out.push({ key: "previous:icon", slot: "icon", origin: "release", image: p.url,
      label: `Historical · ${p.origin === "generated" ? "painted icon" : "release icon"} (release before the new art was promoted)`, generator: p.generator, date: day(p.date), file: p.file });
  }
  const body = previous?.model.find(m => m.file.split("/").pop()!.toLowerCase().replace(/\.(vxl|shp)$/, "") === args.actor.toLowerCase()) ?? previous?.model[0];
  if (entry?.released && body && previous!.model.some(m => !entry.modelShas?.includes(m.sha256)) && !previous!.model.every(m => archived.has(m.sha256))) {
    out.push({ key: "previous:model", slot: "model", origin: "release", image: null, previous: true,
      label: "Historical · game model (release before the new art was promoted)", generator: body.generator, date: day(body.date), file: body.file });
  }
  // Archive files are named <installed yyyymmdd>-<sha>-<file>: newest first by that, else by the recorded date. A
  // model's parts (body, turret, barrel) archived together are one version, shown by its body file.
  const order = (a: ArchivedArt) => /^(\d{8})-/.exec(a.file.split("/").pop()!)?.[1] ?? (a.date ?? "").replace(/-/g, "").slice(0, 8);
  const groups = new Map<string, ArchivedArt[]>();
  for (const a of archive) {
    const slot = a.slot ?? (/\.(png|jpe?g)$/i.test(a.file) ? "icon" : "model");
    const key = slot === "icon" ? `icon|${a.file}` : `model|${order(a)}|${(a.label ?? "").replace(/,?\s*\b(body|turret|barrel)\b/gi, "")}`;
    groups.set(key, [...(groups.get(key) ?? []), { ...a, slot }]);
  }
  const isBody = (a: ArchivedArt) => a.file.split("/").pop()!.toLowerCase().replace(/^\d{8}-[0-9a-f]+-/, "").replace(/\.(vxl|shp)$/, "") === args.actor.toLowerCase();
  const newer = (x: ArchivedArt, y: ArchivedArt) => { const a = `${order(x)}|${x.date ?? ""}`, b = `${order(y)}|${y.date ?? ""}`; return a < b ? 1 : a > b ? -1 : 0; };
  const picked = [...groups.values()].map(list => list.find(isBody) ?? list[0]).sort(newer);
  for (const a of picked) {
    const slot = a.slot!;
    const name = slot === "icon" ? (a.origin === "generated" ? "painted icon" : a.label ?? "icon") : a.label ?? "game model";
    out.push({ key: `archive:${a.file}`, slot, origin: "archive", image: slot === "icon" ? a.url : null,
      label: `Historical · ${name}`, generator: a.generator, date: day(a.date), file: a.file });
  }
  const installed = new Set([entry?.model, entry?.icon].filter(Boolean));
  for (const c of [...(ws?.candidates ?? [])].sort(newestFirst)) {
    // An early icon may be filed as a concept (cameo-v1-role-rebuild); its cameo file still makes it an icon.
    const kindSlot = slotOfKind(c.kind), slot = kindSlot === "concept" && typeof c.files.cameo === "string" ? "icon" : kindSlot;
    if ((slot !== "icon" && slot !== "model") || installed.has(c.id)) continue;
    const url = (f: unknown) => (typeof f === "string" ? c.urls[f.replace(/\\/g, "/")] ?? null : null);
    const preview = Array.isArray(c.files.previews) ? c.files.previews.map(url).find(Boolean) ?? null : null;
    out.push({ key: `candidate:${c.id}`, slot, origin: "candidate", ...(kindSlot === slot ? { candidate: c.id } : {}),
      image: slot === "icon" ? url(c.files.cameo) : preview,
      label: `Historical · ${slot === "icon" ? "icon" : c.kind === "voxel" ? "voxel model" : "sprite model"} ${c.id}`,
      generator: c.model ?? null, date: day(c.createdAt), file: c.dir });
  }
  // Icons first, then models; each group keeps the order above (release, archive, candidates newest first).
  return [...out.filter(e => e.slot === "icon"), ...out.filter(e => e.slot === "model")];
}

/**
 * Reads a promotion manifest leniently: RTSAI-Art/history/<actor>/manifest.json ({ entries: [{ file, what, modPath,
 * sha256, source: { generator, date }, installed: { first: { date } } }] }), or a plain list of objects or paths.
 * Only pictures (PNG) and game models (VXL/SHP) that were copied into the archive are listed; palettes, HVA files and
 * entries that only reference a file elsewhere are not separate versions.
 */
export function parseArchive(json: unknown, urlOf: (file: string) => string): ArchivedArt[] {
  const list = Array.isArray(json) ? json : json && typeof json === "object"
    ? (["entries", "files", "items", "archived"].map(k => (json as Record<string, unknown>)[k]).find(Array.isArray) as unknown[] | undefined) ?? [] : [];
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  const obj = (v: unknown) => (v && typeof v === "object" ? v as Record<string, unknown> : {});
  const seen = new Set<string>();
  return list.flatMap((raw): ArchivedArt[] => {
    const o = typeof raw === "string" ? { file: raw } : raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
    const file = o && (str(o.file) ?? str(o.path) ?? str(o.archived) ?? str(o.archivePath));
    if (!o || !file || file.includes("..") || !/\.(png|jpe?g|vxl|shp)$/i.test(file) || seen.has(file)) return [];
    seen.add(file);
    const slotText = [str(o.slot), str(o.what), str(o.kind), str(o.type)].filter(Boolean).join(" ");
    const slot: HistorySlot | null = /icon|cameo/i.test(slotText) ? "icon" : /model|voxel|sprite|vxl|shp/i.test(slotText) ? "model" : null;
    const source = obj(o.source), first = obj(obj(o.installed).first);
    return [{ file, url: /\.(png|jpe?g)$/i.test(file) ? urlOf(file) : null, slot, label: str(o.label) ?? str(o.title) ?? str(o.what),
      generator: str(o.generator) ?? str(o.tool) ?? str(o.model) ?? str(source.generator),
      date: str(o.date) ?? str(o.archivedAt) ?? str(o.createdAt) ?? str(source.date) ?? str(first.date), sha256: str(o.sha256), origin: str(o.origin) ?? str(source.origin) }];
  });
}
