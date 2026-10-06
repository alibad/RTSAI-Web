import assert from "node:assert/strict";
import test from "node:test";
import type { ActorSources, AssetSource } from "../lib/art-lab/asset-source";
import type { PreviewActor } from "../lib/art-lab/chain";
import { candidateOrigin, historyFor, identityCameo, installedSources, parseArchive, previewIconFile } from "../lib/art-lab/installed-art";
import type { Candidate, UnitWorkspace } from "../lib/art-lab/review";

const cand = (id: string, kind: string, createdAt: string, extra: Partial<Candidate> = {}): Candidate => ({
  id, actor: "r2qilin", kind, createdAt, dir: `units/r2qilin/candidates/${id}`, urls: { "cameo.png": `/f/${id}/cameo.png`, "preview.png": `/f/${id}/preview.png` },
  files: { cameo: kind === "cameo" ? "cameo.png" : null, previews: kind === "cameo" ? [] : ["preview.png"] }, ...extra,
} as unknown as Candidate);

const ws: UnitWorkspace = { actor: "r2qilin", spec: null, comparisons: [], candidates: [
  cand("cameo-v1-role-rebuild", "concept", "2026-09-20T00:00:00Z", { model: "built-in image generation tool", files: { cameo: "cameo.png" } } as Partial<Candidate>),
  cand("cameo-v14-ra2-ivory", "cameo", "2026-10-04T00:00:00Z", { model: "gpt-image-2.5-sunburst" }),
  cand("cameo-v3-render", "cameo", "2026-10-06T03:05:09Z", { model: "Blender 5.2 Cycles (CPU); tools/cameo_render.py", route: "3D model -> perspective cameo render -> 60x48" }),
  cand("voxel-v5-glb", "voxel", "2026-10-01T00:00:00Z", { route: "glb-voxel-v5" }),
  cand("sprite-v6-prerender", "sprite", "2026-10-05T00:00:00Z", { model: "Blender 5.2.2 LTS Cycles (CPU) geometry passes", route: "glb-prerender-v2" }),
  cand("concept-v1", "concept", "2026-09-01T00:00:00Z"),
] };
const entry: PreviewActor = { model: "sprite-v6-prerender", icon: "cameo-v3-render", files: ["icons/r2qilin.png", "vehicles/r2qilin.shp"], rules: true };
const src = (kind: AssetSource["kind"], label: string, file?: string): AssetSource => ({ kind, label, pack: "RTS AI · RA2", creator: null, file, evidence: "hash-verified", rights: "project-record", source: { repo: "r", path: "p", commit: "c", date: "2026-09-05" } as AssetSource["source"] });
const release: ActorSources = { model: src("mixed", "Mixed sources"), icon: src("generated", "AI generated", "china-art/qilinicon.png"), files: [src("generated", "AI generated", "china-art/qilinicon.png"), src("project-created", "Project created", "china-art/qilin.vxl")], rules: "RTS AI · RTSAI-Mod" };

test("identity: the preview's installed cameo wins; the release icon is the fallback; stock units keep theirs", () => {
  assert.equal(previewIconFile("r2qilin", entry), "icons/r2qilin.png");
  assert.equal(identityCameo("r2qilin", "/release.png", entry, "abcdef1234567890"), "/api/art-review/preview-file?path=icons%2Fr2qilin.png&v=abcdef123456");
  assert.equal(identityCameo("r2qilin", "/release.png", { ...entry, files: ["vehicles/r2qilin.shp"] }, null), "/release.png");
  assert.equal(identityCameo("e1", "/e1.png", undefined, "h"), "/e1.png");
});

test("sources: installed art is described by its candidate, not as mixed release files", () => {
  assert.equal(candidateOrigin(ws.candidates[4]).label, "Project created · 3D render");
  assert.equal(candidateOrigin(ws.candidates[2]).label, "Project created · 3D render");
  assert.equal(candidateOrigin(ws.candidates[3]).label, "Project created · voxels from 3D");
  assert.equal(candidateOrigin(ws.candidates[1]).label, "AI generated");
  const s = installedSources(ws, entry, release)!;
  assert.equal(s.model.label, "Project created · 3D render");
  assert.equal(s.icon.label, "Project created · 3D render");
  assert.equal(s.model.file, "units/r2qilin/candidates/sprite-v6-prerender");
  assert.ok(!s.files.some(f => f.file === "china-art/qilin.vxl" || f.file === "china-art/qilinicon.png"), "replaced release files are not credited to the installed art");
  assert.equal(installedSources(ws, { ...entry, model: null, icon: null }, release), null);
  // A slot the preview leaves alone keeps the release's credit.
  assert.equal(installedSources(ws, { ...entry, icon: null }, release)!.icon.label, "AI generated");
});

test("history: release art, then older candidates newest first; installed ones and concepts stay out; all Historical", () => {
  const h = historyFor({ actor: "r2qilin", ws, entry, release: { cameo: "/release.png", hasModel: true, sources: release } });
  assert.deepEqual(h.map(e => e.key), [
    "release:icon", "candidate:cameo-v14-ra2-ivory", "candidate:cameo-v1-role-rebuild",
    "release:model", "candidate:voxel-v5-glb",
  ]);
  assert.ok(h.every(e => e.label.startsWith("Historical · ")));
  assert.equal(h[0].label, "Historical · painted icon (current release until the new art is promoted)");
  assert.equal(h[0].date, "2026-09-05");
  assert.equal(h[0].file, "china-art/qilinicon.png");
  assert.equal(h.find(e => e.key === "release:model")!.file, "china-art/qilin.vxl");
  assert.equal(h.find(e => e.key === "candidate:voxel-v5-glb")!.image, "/f/voxel-v5-glb/preview.png");
  // Without preview art (after promotion) the release is the installed art: no release entries.
  const after = historyFor({ actor: "r2qilin", ws, entry: undefined, release: { cameo: "/new.png", hasModel: true, sources: release } });
  assert.ok(!after.some(e => e.origin === "release"));
});

test("history: the promotion archive is read leniently and sorted newest first", () => {
  const url = (f: string) => `/file/${f}`;
  const list = parseArchive({ entries: [
    { file: "cameo-painted.png", kind: "cameo", generator: "qwen-image", date: "2026-09-05" },
    { path: "voxels/qilin.vxl", slot: "model", tool: "forge", archivedAt: "2026-10-06T10:00:00Z", label: "voxel game model" },
    { file: "../escape.png" }, 42,
  ] }, url);
  assert.equal(list.length, 2);
  assert.equal(list[0].url, "/file/cameo-painted.png");
  assert.equal(list[1].slot, "model");
  assert.deepEqual(parseArchive(["a.png", "b.vxl"], url).map(a => a.file), ["a.png", "b.vxl"]);
  const h = historyFor({ actor: "r2qilin", ws: undefined, entry: undefined, release: { cameo: null, hasModel: false }, archive: list });
  assert.deepEqual(h.map(e => e.label), ["Historical · icon", "Historical · voxel game model"]);
  assert.equal(h[1].date, "2026-10-06");
});

test("promotion: preview art the release carries byte for byte is marked released; history drops the release entries", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { withReleased } = await import("../lib/art-lab/preview-server");
  const root = mkdtempSync(join(tmpdir(), "rtsai-released-"));
  const put = (mod: string, file: string, text: string) => { const p = join(root, mod, "mods/rtsai/art-preview", file); mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, text); };
  put("preview", "icons/r2qilin.png", "icon"); put("preview", "vehicles/r2qilin.shp", "tank");
  put("preview", "icons/r2zbd.png", "icon2");
  put("main", "icons/r2qilin.png", "icon"); put("main", "vehicles/r2qilin.shp", "tank");
  put("main", "icons/r2zbd.png", "older");
  const status = { available: true, branch: "rtsai/art-preview", head: "abc", unmatched: [], actors: {
    r2qilin: { ...entry }, r2zbd: { model: null, icon: null, files: ["icons/r2zbd.png"], rules: false },
  } };
  const marked = withReleased(status, join(root, "preview"), join(root, "main"));
  assert.equal(marked.actors.r2qilin.released, true);
  assert.equal(marked.actors.r2zbd.released, undefined);
  assert.equal(withReleased(status, join(root, "preview"), null), status);
  // Promoted by moving the overlay's folders into modern-factions/.
  const moved = (file: string, text: string) => { const p = join(root, "moved", "mods/rtsai/modern-factions", file); mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, text); };
  moved("icons/r2qilin.png", "icon"); moved("vehicles/r2qilin.shp", "tank");
  assert.equal(withReleased(status, join(root, "preview"), join(root, "moved")).actors.r2qilin.released, true);
  const h = historyFor({ actor: "r2qilin", ws, entry: marked.actors.r2qilin, release: { cameo: "/release.png", hasModel: true, sources: release } });
  assert.ok(!h.some(e => e.origin === "release"));
});

test("history after promotion, before the archive: the synced manifest's release shows as Historical with its provenance", () => {
  const previous = {
    icon: { file: "mods/rtsai/modern-factions/icons/r2qilin.png", url: "/art-lab/icons/r2qilin.png", sha256: "old-icon", origin: "generated", generator: "Qwen/Qwen-Image", date: "2026-10-02" },
    model: [{ file: "mods/rtsai/modern-factions/voxels/r2qilintur.vxl", url: "/t", sha256: "old-tur", origin: "rendered-from-project-geometry", generator: "project-geometry", date: null },
      { file: "mods/rtsai/modern-factions/voxels/r2qilin.vxl", url: "/b", sha256: "old-body", origin: "rendered-from-project-geometry", generator: "project-geometry", date: "2026-09-05" }],
  };
  const promoted = { ...entry, released: true, iconShas: ["new-icon"], modelShas: ["new-shp"] };
  const h = historyFor({ actor: "r2qilin", ws, entry: promoted, release: { cameo: "/new.png", hasModel: true }, previous });
  const icon = h.find(e => e.key === "previous:icon")!, model = h.find(e => e.key === "previous:model")!;
  assert.equal(icon.label, "Historical · painted icon (release before the new art was promoted)");
  assert.deepEqual([icon.generator, icon.date, icon.file, icon.image], ["Qwen/Qwen-Image", "2026-10-02", "mods/rtsai/modern-factions/icons/r2qilin.png", "/art-lab/icons/r2qilin.png"]);
  assert.equal(model.file, "mods/rtsai/modern-factions/voxels/r2qilin.vxl", "the body names the model");
  assert.equal(model.previous, true);
  // Once the manifest is synced from the promoted mod (same bytes) or the archive holds them, they are not repeated.
  assert.ok(!historyFor({ actor: "r2qilin", ws, entry: { ...promoted, iconShas: ["old-icon"], modelShas: ["old-tur", "old-body"] }, release: { cameo: null, hasModel: true }, previous }).some(e => e.key.startsWith("previous:")));
  const archive = [{ file: "icon.png", url: "/a", slot: "icon" as const, label: null, generator: null, date: null, sha256: "old-icon" }];
  assert.ok(!historyFor({ actor: "r2qilin", ws, entry: promoted, release: { cameo: null, hasModel: true }, previous, archive }).some(e => e.key === "previous:icon"));
  // Before promotion the live release itself is the entry; the manifest record is not shown twice.
  assert.ok(!historyFor({ actor: "r2qilin", ws, entry, release: { cameo: "/release.png", hasModel: true, sources: release }, previous }).some(e => e.key.startsWith("previous:")));
});

test("history: the real archive schema (history/<actor>/manifest.json) groups model parts and names painted icons", () => {
  const manifest = { schemaVersion: 1, actor: "r2qilin", entries: [
    { sha256: "a1", what: "build-menu cameo, 60x48", modPath: "mods/rtsai/modern-factions/icons/r2qilin.png", file: "20261002-bc65a64158-r2qilin.png", source: { origin: "generated", generator: "openai-image-tool", date: "2026-09-03" } },
    { sha256: "a2", what: "build-menu cameo, 60x48", file: "20261002-b00bfe12f6-r2qilin.png", source: { origin: "generated", generator: "qwen-image", date: "2026-10-02" } },
    { sha256: "h1", what: "placeholder voxel model, body (procedural mesh from the faction port)", modPath: "x/r2qilin.hva" },
    { sha256: "v1", what: "placeholder voxel model, body (procedural mesh from the faction port)", file: "20261002-ed1d08d085-r2qilin.vxl", source: { origin: "procedural", generator: "project-geometry" }, installed: { first: { date: "2026-10-02" } } },
    { sha256: "v2", what: "placeholder voxel model, turret (procedural mesh from the faction port)", file: "20261002-87731af779-r2qilintur.vxl", source: { generator: "project-geometry" } },
    { sha256: "g1", what: "GLB voxel route model, body (art preview, superseded by the prerendered sprite)", file: "20261005-94ce000fc9-r2qilin.vxl", installed: { first: { date: "2026-10-05" } } },
    { sha256: "g2", what: "GLB voxel route model, turret (art preview, superseded by the prerendered sprite)", file: "20261005-9a1773b78d-r2qilintur.vxl" },
    { sha256: "p1", what: "placeholder voxel palette", file: "20261004-aaaaaaaaaa-r2qilin.pal" },
  ] };
  const list = parseArchive(manifest, f => `/file/${f}`);
  assert.equal(list.length, 6, "palettes and uncopied files are not versions");
  const h = historyFor({ actor: "r2qilin", ws: undefined, entry: { ...entry, released: true }, release: { cameo: "/new.png", hasModel: true }, archive: list });
  assert.deepEqual(h.map(e => [e.label, e.file]), [
    ["Historical · painted icon", "20261002-b00bfe12f6-r2qilin.png"],
    ["Historical · painted icon", "20261002-bc65a64158-r2qilin.png"],
    ["Historical · GLB voxel route model, body (art preview, superseded by the prerendered sprite)", "20261005-94ce000fc9-r2qilin.vxl"],
    ["Historical · placeholder voxel model, body (procedural mesh from the faction port)", "20261002-ed1d08d085-r2qilin.vxl"],
  ]);
  assert.equal(h[0].generator, "qwen-image");
  assert.equal(h[1].date, "2026-09-03");
  // Promoted: lists show the release's own icon.
  assert.equal(identityCameo("r2qilin", "/release.png", { ...entry, released: true }, "abc"), "/release.png");
});
