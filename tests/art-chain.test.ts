import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { actionCoverage, candidateChecks, checksSummary, decisionState, defaultModelFocus, designFor, failingFirst, fromModel, glbOptions, meshCandidate, nativeCandidates, rosterCounts } from "../lib/art-lab/chain";
import { measuredGroups, plainCheck } from "../lib/art-lab/measurements";
import { candidateLight, candidateRenderSpec, candidateVehicleSprite, parseCandidateRules, sequenceRole, STOCK_VOXEL_LIGHT, type Candidate, type ReviewFile, type UnitWorkspace } from "../lib/art-lab/review";
import { groundFor } from "../app/components/art/review/ground";
import { overlayAnimations, readPreviewStatus, workspaceStamp } from "../lib/art-lab/preview-server";
import { spriteAnimations } from "../lib/art-lab/sprite-anim";
import { spriteRig } from "../lib/art-lab/sprite-compose";
import { artLab, renderSpec, spriteWithUrls } from "../lib/art-lab/manifest";
import type { ModelActor } from "../lib/art-lab/models";

const urls = (files: string[]) => Object.fromEntries(files.map(f => [f, `/api/art-review/file?path=${encodeURIComponent(f)}`]));
const cand = (over: Partial<Candidate> & { id: string; kind: string; createdAt: string }): Candidate => ({ actor: "r2x", files: {}, dir: "", urls: {}, ...over } as Candidate);
const ws = (candidates: Candidate[], actor = "r2x"): UnitWorkspace => ({ actor, spec: null, candidates, comparisons: [] });

const concept = cand({ id: "cameo-v1-role-rebuild", kind: "concept", createdAt: "2026-10-04T10:00:00Z", files: { concept: "master.png" }, urls: urls(["master.png", "preview-master.png"]) });
const mesh = cand({ id: "mesh-v1-role-rebuild", kind: "mesh", createdAt: "2026-10-04T11:00:00Z", fromConcept: concept.id, files: { mesh: "mesh.glb" }, urls: urls(["mesh.glb", "web.glb"]) });
const older = cand({ id: "voxel-v2", kind: "voxel", createdAt: "2026-10-03T00:00:00Z", files: { vxl: ["r2x.vxl"], hva: ["r2x.hva"] }, urls: urls(["r2x.vxl", "r2x.hva"]) });
const glbVoxel = cand({ id: "voxel-v5-glb", kind: "voxel", createdAt: "2026-10-05T00:36:00Z", fromMesh: mesh.id, fromConcept: concept.id, files: { vxl: ["r2x.vxl"], hva: ["r2x.hva"] }, urls: urls(["r2x.vxl", "r2x.hva"]) });

test("chain: the newest native candidate opens, never the placeholder when one exists", () => {
  const w = ws([older, glbVoxel, concept, mesh]);
  assert.deepEqual(nativeCandidates(w).map(c => c.id), ["voxel-v5-glb", "voxel-v2"], "native = VXL/SHP model candidates, newest first");
  assert.equal(defaultModelFocus(w), "voxel-v5-glb");
  assert.equal(defaultModelFocus(w, { chosen: null, rejected: ["voxel-v5-glb"], at: null }), "voxel-v2", "a rejected candidate is skipped");
  assert.equal(defaultModelFocus(ws([concept, mesh])), "current", "no native candidate: what ships now");
});

test("chain: the 3D route is recognised from metadata, an older route is not", () => {
  const all = [older, glbVoxel, mesh];
  assert.equal(fromModel(glbVoxel, all), true);
  assert.equal(fromModel(cand({ id: "sprite-v3-glb", kind: "sprite", createdAt: "x" }), all), true, "the -glb route name");
  assert.equal(fromModel(older, all), false);
  assert.equal(fromModel(mesh, all), false, "a GLB is a source, not a game model");
});

test("chain: design and 3D model follow the candidate's own lineage", () => {
  const otherConcept = cand({ id: "concept-v9", kind: "concept", createdAt: "2026-10-05T03:00:00Z", files: { concept: "c.png" }, urls: urls(["c.png"]) });
  const w = ws([older, glbVoxel, concept, mesh, otherConcept]);
  const source = meshCandidate(w, glbVoxel);
  assert.equal(source?.id, "mesh-v1-role-rebuild");
  const design = designFor(w, source, glbVoxel);
  assert.equal(design?.candidate.id, "cameo-v1-role-rebuild", "the concept it was built from, not the newest concept");
  assert.match(design!.thumb, /preview-master\.png/, "a small preview for the thumbnail");
  assert.equal(designFor(ws([otherConcept]), null, null)?.candidate.id, "concept-v9");
  const library: ModelActor = { key: "ra2:r2x", actor: "r2x", name: "X", category: "vehicle", factions: [], status: "", thumbnail: null, nativeThumbnail: null, nativeFormat: "VXL / HVA", reconstructionNotice: null, requiredWork: [],
    options: [{ id: "current-voxel", label: "Current voxel → GLB", url: "/api/art-review/file?path=a.glb", source: "", bytes: 1, triangles: 1, remap: false, turret: false, status: "" }] };
  assert.deepEqual(glbOptions(library, null), [], "converted existing art is not a new 3D model");
  assert.equal(glbOptions(library, source)[0]?.url, source!.urls["web.glb"], "falls back to the mesh candidate's web GLB");
});

test("chain: actions are checked against the version's own art", () => {
  const rifle = artLab.actors.r2cnrifle;
  const infantry = actionCoverage("infantry", renderSpec(rifle), spriteWithUrls(rifle));
  assert.deepEqual(infantry.map(a => a.label), ["Stand", "Idle", "Walk", "Fire", "Prone", "Die"]);
  assert.equal(infantry.find(a => a.id === "prone")?.present, false, "the current rifleman has no prone art");
  const mantis = actionCoverage("vehicle", renderSpec(artLab.actors.r2mantis), null);
  assert.deepEqual(mantis.map(a => [a.label, a.present]), [["Body", true], ["Turret", true]]);
});

test("checks: only what the art tools saved, failing first, never derived", () => {
  assert.deepEqual(candidateChecks(null), []);
  assert.deepEqual(candidateChecks(glbVoxel), [], "nothing saved: not measured yet");
  assert.equal(checksSummary([]).state, "none");
  // art_metrics.py via glb_route.py (gate.json): one row fails although the file's verdict is recorded as given.
  const gate = { family: ["destroyer", "aegis"], pass: false, rows: [
    { metric: "area_px", candidate: 1792.25, reference: 1909.875, bounds: [1182.75, 3430.86], pass: true, why: "silhouette footprint" },
    { metric: "speckle", candidate: 0.3, reference: 0.1, bounds: [null, 0.2], pass: false, why: "isolated pixels" },
  ] };
  const vehicle = measuredGroups({ "gate.json": gate }, { decodeCheck: { pass: true, problems: [] }, playerColorCheck: { houses: ["F21818", "2050F0"], changedOutsideOwnership: 0 } });
  assert.deepEqual(vehicle.map(g => [g.title, g.pass]), [["Against the stock family", false], ["Decodes in the Studio", true], ["Player colours", null]]);
  assert.deepEqual(vehicle[0].rows.map(r => [r.label, r.stock, r.range, r.pass]), [["Size on screen", "stock 1910", "1183–3431", true], ["Speckle", "stock 0.100", "≤ 0.200", false]]);
  assert.match(vehicle[2].notes[0], /0 pixels changed outside/, "a measurement without a recorded verdict stays a note");
  const summary = checksSummary(vehicle);
  assert.deepEqual([summary.state, summary.failing, summary.passed, summary.total], ["fail", 1, 1, 2]);
  assert.equal(failingFirst(vehicle).failing[0].row.metric, "speckle", "failing checks lead");
  // metrics_building.py: stock family range per metric.
  const building = measuredGroups({ "metrics-building.json": { family: "gun", members: ["sentry", "pillbox"], pass: true, rows: [{ metric: "area_px", candidate: 1212, familyMin: 834.25, familyMax: 997, bounds: [625.688, 1345.95], pass: true, why: "near the stock defenses" }] } },
    { verify: { pass: true, checks: { frameRanges: true, noClipping: true } } });
  assert.deepEqual(building[0].family, ["gun", "sentry", "pillbox"]);
  assert.equal(building[0].rows[0].stock, "stock 834–997");
  assert.deepEqual(building[1].rows.map(r => r.label), ["Frame ranges", "No clipping"]);
  assert.equal(plainCheck("sixColoursOnlyRemapChanges"), "Six colours only remap changes");
  // infantry_route.py verify.json: structure verdict and metrics_infantry.py family gate.
  const infantry = measuredGroups({ "verify.json": { structure: { ok: false, problems: ["frame 12 clipped"], frames: 1016, clippedFrames: [12], remapOutsideOwnership: 0 }, family: { pass: true, rows: [], extras: { candidate: {}, gi: {}, conscript: {} } } } }, {});
  assert.deepEqual(infantry.map(g => [g.title, g.pass]), [["Against the stock family", true], ["SHP structure", false]]);
  assert.deepEqual(infantry[0].family, ["gi", "conscript"]);
  assert.deepEqual(failingFirst(infantry).failedGroups.map(g => g.problems), [["frame 12 clipped"]]);
  assert.equal(checksSummary(infantry).state, "fail");
});

test("chain: decisions are read, never assumed", () => {
  assert.equal(decisionState(undefined, glbVoxel).kind, "open");
  assert.equal(decisionState({ chosen: "voxel-v5-glb", rejected: [], at: "2026-10-05T05:00:00Z" }, glbVoxel).kind, "use");
  assert.equal(decisionState({ chosen: null, rejected: ["voxel-v5-glb"], at: null }, glbVoxel).kind, "rejected");
  assert.equal(decisionState({ chosen: "current", rejected: [], at: "2026-10-04T00:00:00Z" }, glbVoxel).kind, "open", "keep-current older than the candidate does not cover it");
  assert.equal(decisionState(undefined, null).kind, "none");
});

test("chain: roster counts are per actor over one denominator", () => {
  const spaces = new Map<string, UnitWorkspace>([
    ["r2a", ws([concept, mesh, glbVoxel, older], "r2a")],
    ["r2b", ws([older], "r2b")],
    ["r2c", ws([concept], "r2c")],
  ]);
  const review: ReviewFile = { r2b: { version: 2, status: "in-review", slots: { model: { chosen: "current", rejected: [], at: "x" }, icon: { chosen: null, rejected: [], at: null }, concept: { chosen: null, rejected: [], at: null } }, comments: [], log: [] } };
  const counts = rosterCounts(["r2a", "r2b", "r2c", "r2d"], spaces, null, { available: true, branch: null, head: null, actors: { r2a: { model: "voxel-v5-glb", icon: null, files: ["voxels/r2a.vxl"], rules: false }, r2d: { model: null, icon: "cameo-v3-render", files: ["icons/r2d.png"], rules: true } }, unmatched: [] }, review);
  assert.deepEqual(counts, { total: 4, designs: 2, models3d: 1, gameModels: 1, inPreview: 1, decided: 1, released: 0 }, "two native routes on r2a still count once; r2b's older candidate is not a 3D game model; r2d's installed icon is not a model in the preview");
});

test("voxel candidates: declared light, rotor roles and HVA frames", () => {
  assert.deepEqual(candidateLight({ renderLight: "stock" }), STOCK_VOXEL_LIGHT);
  assert.deepEqual(candidateLight({ renderLight: { scale: 11.7, ambient: -0.5, diffuse: 1.4 } }), { scale: 11.7, ambient: [-0.5, -0.5, -0.5], diffuse: [1.4, 1.4, 1.4] });
  assert.deepEqual(candidateLight({}), {}, "absent: the actor's current rules");
  const gunship = renderSpec(artLab.actors.r2ilgunship);
  const files = ["r2ilgunship.vxl", "r2ilgunship.hva", "r2ilgunshiptur.vxl", "r2ilgunshiptur.hva"];
  const c = cand({ id: "voxel-v5-glb", kind: "voxel", createdAt: "x", actor: "r2ilgunship", files: { vxl: [files[0], files[2]], hva: [files[1], files[3]] }, urls: urls(files), hvaFrames: { r2ilgunshiptur: 8 }, renderLight: "stock" });
  const spec = candidateRenderSpec(gunship, c)!;
  const rotor = spec.voxel!.parts.find(p => p.vxl.includes("r2ilgunshiptur"))!;
  assert.equal(rotor.turretOffset, null, "the gunship's 'tur' file is its rotor, not a turret");
  assert.equal(rotor.trait, "WithVoxelHelicopterBody");
  assert.deepEqual([rotor.frames, rotor.tickRate], [8, 1], "candidate HVA frames play at the rules' TickRate");
  assert.equal(spec.voxel!.scale, 11.7);
  const mantis = renderSpec(artLab.actors.r2mantis);
  const m = cand({ id: "v", kind: "voxel", createdAt: "x", actor: "r2mantis", files: { vxl: ["r2mantis.vxl", "r2mantistur.vxl"], hva: ["r2mantis.hva", "r2mantistur.hva"] }, urls: urls(["r2mantis.vxl", "r2mantistur.vxl", "r2mantis.hva", "r2mantistur.hva"]), voxelize: { turretOffsetWorld: [-35, 0, 0] } });
  assert.deepEqual(candidateRenderSpec(mantis, m)!.voxel!.parts.find(p => p.label === "turret")?.turretOffset, [-35, 0, 0], "a real turret uses the candidate's pivot");
});

test("sprite candidates: a defence's sequences file, roles and turret fire", () => {
  const bastion = artLab.actors.r2bastion;
  const current = spriteWithUrls(bastion);
  assert.deepEqual(sequenceRole("critical-idle", "defense", [], current), ["WithSpriteBody (damaged)"]);
  assert.deepEqual(sequenceRole("fire", "defense", ["WithTurretAttackAnimation"], current), ["WithTurretAttackAnimation"]);
  assert.deepEqual(sequenceRole("make", "defense", [], null), ["WithMakeAnimation (build-up)"]);
  const rules = "r2bastion:\n\tWithTurretAttackAnimation:\n\t\tSequence: fire\n^Palettes:\n\tPaletteFromFile@b:\n\t\tName: b\n\t\tFilename: b.pal\n\t\tShadowIndex: 1\n\tPlayerColorPalette@b:\n\t\tBasePalette: b\n\t\tBaseName: bp\n\t\tRemapIndex: 16, 17\n";
  const sequences = "r2bastion:\n\tDefaults:\n\t\tFilename: ra2|art-preview/buildings/r2bastion.shp\n\t\tOffset: 4, -16, 16\n\tidle:\n\t\tStart: 0\n\t\tShadowStart: 3\n\tturret:\n\t\tStart: 6\n\t\tFacings: 32\n\tfire:\n\t\tStart: 102\n\t\tLength: 2\n\t\tFacings: 32\n\tmake:\n\t\tStart: 294\n\t\tLength: 12\n";
  const c = cand({ id: "sprite-v3-glb", kind: "sprite", createdAt: "x", actor: "r2bastion", files: { shp: ["r2bastion.shp"], pal: "r2bastion.pal" }, urls: urls(["r2bastion.shp", "r2bastion.pal"]), rulesText: `${rules}\n${sequences}` });
  const made = candidateVehicleSprite(renderSpec(bastion), c, current)!;
  assert.ok(made, "the candidate is drawable from its own sequences");
  assert.equal(made.sprite.turret?.initialFacing, current?.turret?.initialFacing, "unchanged rules keep the current InitialFacing");
  assert.deepEqual(made.spec.palette?.shadow, [1]);
  assert.deepEqual(made.sprite.sequences.find(s => s.name === "idle")?.offset, [4, -16, 16], "Defaults apply to every sequence");
  const anims = spriteAnimations(made.sprite);
  assert.deepEqual(anims.map(a => a.id).slice(0, 3), ["body", "make", "fire"]);
  const rig = spriteRig(made.sprite, "fire")!;
  assert.equal(rig.body.name, "idle", "the defence keeps its body while firing");
  assert.equal(rig.turret?.name, "fire", "the turret sequence is swapped for the fire frames");
});

test("sprite candidates: a building's own overlay and attack traits never replace its idle body", () => {
  const pal = "^Palettes:\n\tPaletteFromFile@b:\n\t\tName: b\n\t\tFilename: b.pal\n\t\tShadowIndex: 1\n";
  const seqs = (actor: string, extra: string) => `${actor}:\n\tDefaults:\n\t\tFilename: ra2|art-preview/buildings/${actor}.shp\n\t\tOffset: 4, -20, 20\n\tidle:\n\t\tStart: 0\n\t\tShadowStart: 3\n${extra}\tmake:\n\t\tStart: 102\n\t\tLength: 12\n`;
  // Signal Post: a new dish overlay the current actor does not have.
  const relay = artLab.actors.r2hzrelay;
  const relayRules = `r2hzrelay:\n\tWithIdleOverlay@dish:\n\t\tSequence: active\n\t\tRequiresCondition: !build-incomplete\n\t\tOffset: 193,-24,0\n${pal}\n${seqs("r2hzrelay", "\tactive:\n\t\tStart: 6\n\t\tLength: 32\n\t\tShadowStart: 70\n")}`;
  const r = candidateVehicleSprite(renderSpec(relay), cand({ id: "sprite-v3-glb", kind: "sprite", createdAt: "x", actor: "r2hzrelay", files: { shp: ["r2hzrelay.shp"], pal: "r2hzrelay.pal" }, urls: urls(["r2hzrelay.shp", "r2hzrelay.pal"]), rulesText: relayRules }), spriteWithUrls(relay))!;
  const relayRig = spriteRig(r.sprite, "stand")!;
  assert.equal(relayRig.body.name, "idle", "the dish is not the body");
  assert.deepEqual(relayRig.overlays.map(o => [o.seq.name, o.offset]), [["active", [193, -24, 0]]], "the dish sits where its trait's Offset puts it");
  // Bunker: fires by swapping its body (WithAttackAnimation); it stands on its idle frame.
  const bunker = artLab.actors.r2hzbunker;
  const bunkerRules = `r2hzbunker:\n\t-WithSpriteTurret:\n\tWithAttackAnimation:\n\t\tSequence: fire\n${pal}\n${seqs("r2hzbunker", "\t-turret:\n\tfire:\n\t\tStart: 6\n\t\tLength: 2\n\t\tShadowStart: 8\n")}`;
  const b = candidateVehicleSprite(renderSpec(bunker), cand({ id: "sprite-v3-glb", kind: "sprite", createdAt: "x", actor: "r2hzbunker", files: { shp: ["r2hzbunker.shp"], pal: "r2hzbunker.pal" }, urls: urls(["r2hzbunker.shp", "r2hzbunker.pal"]), rulesText: bunkerRules }), spriteWithUrls(bunker))!;
  assert.equal(spriteRig(b.sprite, "stand")!.body.name, "idle");
  const fire = spriteAnimations(b.sprite).find(a => a.label === "Fire");
  assert.equal(fire?.body?.name, "fire", "its attack frames are an animation of their own");
  assert.deepEqual(sequenceRole("active", "defense", [], null), [], "an undeclared extra sequence is never a building body");
});

test("preview mod: an actor is in local preview only by installed bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "rtsai-chain-"));
  try {
    const art = join(root, "art"), mod = join(root, "mod");
    const cdir = join(art, "units/r2mantis/candidates/voxel-v5-glb");
    mkdirSync(cdir, { recursive: true });
    mkdirSync(join(art, "units/r2mantisx/candidates"), { recursive: true });
    writeFileSync(join(cdir, "r2mantis.vxl"), "hull");
    writeFileSync(join(cdir, "r2mantistur.vxl"), "turret");
    writeFileSync(join(cdir, "meta.json"), JSON.stringify({ id: "voxel-v5-glb", files: { vxl: ["r2mantis.vxl", "r2mantistur.vxl"] } }));
    assert.equal(readPreviewStatus(art, mod).available, false, "no overlay: no preview");
    const overlay = join(mod, "mods/rtsai/art-preview");
    mkdirSync(join(overlay, "voxels"), { recursive: true });
    writeFileSync(join(overlay, "voxels/r2mantis.vxl"), "hull");
    writeFileSync(join(overlay, "voxels/r2mantistur.vxl"), "turret");
    writeFileSync(join(overlay, "voxels/zz.vxl"), "?");
    writeFileSync(join(overlay, "vehicles.yaml"), "# overlay\nr2mantis:\n\tRenderVoxels:\n\t\tScale: 11.7\n");
    const before = workspaceStamp(art, mod);
    const status = readPreviewStatus(art, mod);
    const sha = (text: string) => createHash("sha256").update(text).digest("hex");
    assert.deepEqual(status.actors.r2mantis, { model: "voxel-v5-glb", icon: null, files: ["voxels/r2mantis.vxl", "voxels/r2mantistur.vxl"], rules: true,
      iconShas: [], modelShas: [sha("hull"), sha("turret")] });
    assert.deepEqual(status.unmatched, ["voxels/zz.vxl"]);
    writeFileSync(join(overlay, "voxels/r2mantistur.vxl"), "edited turret");
    assert.equal(readPreviewStatus(art, mod).actors.r2mantis.model, null, "different bytes: installed, but not this candidate");
    assert.notEqual(workspaceStamp(art, mod), before, "the Studio's fingerprint notices new preview art");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("candidate rules: removal keys are not sequences; overlays keep their role; ships sit on water", () => {
  const rules = parseCandidateRules("r2spectrum:\n\tDefaults:\n\t\tFilename: r2spectrum.shp\n\t-turret:\n\t-damaged-turret:\n\tidle:\n\t\tStart: 0\n\tactive:\n\t\tStart: 6\n\t\tLength: 32\n", "r2spectrum");
  assert.deepEqual(Object.keys(rules.sequences), ["idle", "active"]);
  assert.deepEqual(rules.removed, ["turret", "damaged-turret"]);
  const spectrum = artLab.actors.r2spectrum;
  assert.deepEqual(sequenceRole("active", "defense", [], spriteWithUrls(spectrum)), ["WithIdleOverlay@dish"], "the dish loop stays an overlay on the idle body");
  assert.equal(groundFor("ship", "sand"), "water");
  assert.equal(groundFor("vehicle", "grass"), "grass");
});

test("voxel candidates match parts served under the dev roster's hashed file names", () => {
  const crane = renderSpec(artLab.actors.r2crane);
  const rosterLike = { ...crane, voxel: { ...crane.voxel!, parts: crane.voxel!.parts.map(p => ({ ...p, vxl: `/api/art-review/mod/92827ae1d573-${p.vxl.split("/").pop()}?mode=ra2` })) } };
  const c = cand({ id: "voxel-v5-glb", kind: "voxel", createdAt: "x", actor: "r2crane", files: { vxl: ["r2crane.vxl"], hva: ["r2crane.hva"] }, urls: urls(["r2crane.vxl", "r2crane.hva"]), hvaFrames: { r2crane: 4 } });
  const part = candidateRenderSpec(rosterLike, c)!.voxel!.parts[0];
  assert.deepEqual([part.frames, part.tickRate], [4, 1], "the rotor frames play at the helicopter body's TickRate");
});

test("checks: the route's full metrics record, and format checks alone are not 'all passed'", () => {
  const full = { schema: "rtsai.voxel-metrics/1", tool: "tools/glb_route.py (art_metrics.py gate)", pass: true, family: ["flaktrack", "ifv"],
    familyLeaveOneOut: [{ unit: "flaktrack", pass: true }, { unit: "ifv", pass: false }],
    checks: [{ metric: "area_px", value: 1108.75, reference: 1111.125, bounds: [597.75, 1649.375], pass: true, why: "footprint" }] };
  const groups = measuredGroups({ "metrics.json": full }, { gate: { family: ["flaktrack"], pass: true, metrics: "metrics.json" } });
  assert.equal(groups.filter(g => g.id === "family").length, 1, "the full record replaces the summary");
  assert.deepEqual([groups[0].rows[0].value, groups[0].rows[0].stock], [1108.75, "stock 1111"]);
  assert.match(groups[0].notes[0], /1 of 2 stock units pass/);
  assert.equal(measuredGroups({ "metrics.json": { readability: 1 } }, {}).length, 0, "an image route's metrics.json is not a gate");
  const summaryOnly = measuredGroups({}, { gate: { family: ["v3"], pass: true, metrics: "metrics.json" } });
  assert.deepEqual([summaryOnly[0].pass, summaryOnly[0].rows.length], [true, 0], "a recorded verdict without detail stays a verdict");
  assert.equal(checksSummary(measuredGroups({}, { decodeCheck: { pass: true, problems: [] } })).state, "partial", "decoding is not an art check");
});

test("preview rules: drone propellers and radars spin where the preview copy's rules play them", () => {
  const root = mkdtempSync(join(tmpdir(), "rtsai-spin-"));
  try {
    const overlay = join(root, "overlay");
    mkdirSync(overlay, { recursive: true });
    writeFileSync(join(overlay, "voxels.yaml"), "r2mohajer:\n\tidle: ra2|art-preview/voxels/r2mohajer\nr2mantis:\n\tidle: ra2|art-preview/voxels/r2mantis\n\tradar: ra2|art-preview/voxels/r2mantisradar\n");
    writeFileSync(join(overlay, "vehicles.yaml"), "r2mantis:\n\tWithAnimatedVoxelModel@radar:\n\t\tSequence: radar\n\t\tTickRate: 3\n\t\tTurret: primary\nr2toufan:\n\t-WithVoxelBody:\n\tWithVoxelHelicopterBody:\n\t\tSequence: idle\n");
    writeFileSync(join(overlay, "vehicles-fx.yaml"), "r2mohajer:\n\t-WithVoxelBody:\n\tWithVoxelHelicopterBody:\n\t\tTickRate: 1\n");
    const anims = overlayAnimations(overlay, ["voxels.yaml", "vehicles.yaml", "vehicles-fx.yaml"], ["r2mohajer", "r2mantis", "r2toufan"]);
    assert.deepEqual(anims.r2mohajer, [{ trait: "WithVoxelHelicopterBody", sequence: "idle", file: "r2mohajer", tickRate: 1, turret: null, condition: null, airborne: true }]);
    assert.deepEqual(anims.r2mantis.map(a => [a.trait, a.file, a.tickRate, a.turret]), [["WithAnimatedVoxelModel@radar", "r2mantisradar", 3, "primary"], ["sequence", "r2mantis", null, null]],
      "a remapped sequence no animation trait names is listed for the actor's own traits to play");
    assert.equal(anims.r2toufan[0].tickRate, null, "an omitted TickRate is inherited from the actor's rules");

    // Drone: a propeller section in the body's HVA frames, played by the preview's helicopter body.
    const mohajer = renderSpec(artLab.actors.r2mohajer);
    const drone = cand({ id: "voxel-v5-glb", kind: "voxel", createdAt: "x", actor: "r2mohajer", files: { vxl: ["r2mohajer.vxl"], hva: ["r2mohajer.hva"] }, urls: urls(["r2mohajer.vxl", "r2mohajer.hva"]), hvaFrames: { r2mohajer: 4 } });
    const before = actionCoverage("aircraft", candidateRenderSpec(mohajer, drone), null, { spec: mohajer }).find(a => a.id === "hva")!;
    assert.equal(before.present, false, "without rules that play them, HVA frames do not count");
    const spun = candidateRenderSpec(mohajer, drone, anims.r2mohajer)!;
    assert.equal(spun.voxel!.parts[0].tickRate, 1);
    const after = actionCoverage("aircraft", spun, null, { spec: mohajer }).find(a => a.id === "hva")!;
    assert.equal(after.present, true);
    assert.match(after.note ?? "", /local preview copy's rules: WithVoxelHelicopterBody/);

    // Gunship: the preview's helicopter body inherits the actor's own TickRate.
    const toufan = renderSpec(artLab.actors.r2toufan);
    const heli = cand({ id: "voxel-v5-glb", kind: "voxel", createdAt: "x", actor: "r2toufan", files: { vxl: ["r2toufan.vxl"], hva: ["r2toufan.hva"] }, urls: urls(["r2toufan.vxl", "r2toufan.hva"]), hvaFrames: { r2toufan: 4 } });
    assert.equal(candidateRenderSpec(toufan, heli, anims.r2toufan)!.voxel!.parts[0].tickRate, 1);

    // Radar: its own model rides the turret and cycles at the trait's TickRate.
    const mantis = renderSpec(artLab.actors.r2mantis);
    const files = ["r2mantis.vxl", "r2mantistur.vxl", "r2mantisradar.vxl"];
    const radar = cand({ id: "voxel-v5-glb", kind: "voxel", createdAt: "x", actor: "r2mantis", files: { vxl: files, hva: files.map(f => f.replace(".vxl", ".hva")) }, urls: urls([...files, ...files.map(f => f.replace(".vxl", ".hva"))]), hvaFrames: { r2mantis: 1, r2mantistur: 1, r2mantisradar: 8 }, voxelize: { turretOffsetWorld: [-36, 0, 0] } });
    const dish = candidateRenderSpec(mantis, radar, anims.r2mantis)!.voxel!.parts.find(p => p.label === "radar")!;
    assert.deepEqual([dish.defaultVisible, dish.tickRate, dish.turretOffset], [true, 3, [-36, 0, 0]]);
    assert.equal(candidateRenderSpec(mantis, radar)!.voxel!.parts.find(p => p.vxl.includes("radar"))!.defaultVisible, false, "without the rules it stays hidden");
    const spin = actionCoverage("vehicle", candidateRenderSpec(mantis, radar, anims.r2mantis), null, { spec: mantis }).find(a => a.id === "hva")!;
    assert.deepEqual([spin.label, spin.present], ["Radar spin", true]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a slit-firing bunker is complete without a turret", () => {
  const bunker = artLab.actors.r2hzbunker;
  const pal = "^Palettes:\n\tPaletteFromFile@b:\n\t\tName: b\n\t\tFilename: b.pal\n\t\tShadowIndex: 1\n";
  const rules = `r2hzbunker:\n\t-WithSpriteTurret:\n\tWithAttackAnimation:\n\t\tSequence: fire\n${pal}\nr2hzbunker:\n\tDefaults:\n\t\tFilename: ra2|art-preview/buildings/r2hzbunker.shp\n\t-turret:\n\tidle:\n\t\tStart: 0\n\tdamaged-idle:\n\t\tStart: 1\n\tfire:\n\t\tStart: 6\n\t\tLength: 2\n\tmake:\n\t\tStart: 18\n\t\tLength: 12\n`;
  const made = candidateVehicleSprite(renderSpec(bunker), cand({ id: "sprite-v3-glb", kind: "sprite", createdAt: "x", actor: "r2hzbunker", files: { shp: ["r2hzbunker.shp"], pal: "r2hzbunker.pal" }, urls: urls(["r2hzbunker.shp", "r2hzbunker.pal"]), rulesText: rules }), spriteWithUrls(bunker))!;
  const actions = actionCoverage("defense", made.spec, made.sprite, { spec: renderSpec(bunker), sprite: { ...spriteWithUrls(bunker)!, turret: { sequence: "turret", name: "primary", offset: [0, 0, 0], initialFacing: 0 } } });
  assert.equal(actions.find(a => a.id === "turret"), undefined, "no missing turret");
  assert.deepEqual(actions.filter(a => !a.present), []);
  assert.equal(actions.find(a => a.id === "fire")?.label, "Fires from its slit");
});

test("checks: the metrics file written with the art wins over a stale meta summary", () => {
  const stale = { metrics: { file: "metrics-building.json", family: "support", members: ["tesla", "gap"], pass: false, fails: ["area_px", "dark_share"] } };
  const file = { "metrics-building.json": { family: "support", members: ["tesla", "gap"], pass: true, rows: [{ metric: "area_px", candidate: 1382, familyMin: 1738, familyMax: 2743, bounds: [1304, 3703], pass: true, why: "size" }] } };
  const groups = measuredGroups(file, stale);
  assert.deepEqual(groups.map(g => [g.file, g.pass]), [["metrics-building.json", true]]);
  assert.equal(checksSummary(groups).state, "pass");
  const summaryOnly = measuredGroups({}, stale);
  assert.deepEqual(summaryOnly.map(g => [g.file, g.pass, g.problems]), [["meta.json (metrics)", false, ["Size on screen", "Deep recesses"]]]);
});
