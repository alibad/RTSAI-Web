import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyReviewAction, candidateCost, candidateRenderSpec, formatCost, migrateEntry, needsDecision, slotState, validateAction, type Candidate, type ReviewFile, type UnitWorkspace } from "../lib/art-lab/review";
import { reviewEnabled } from "../lib/art-lab/review-gate";
import { createArtReviewMiddleware, safeResolve } from "../lib/art-lab/review-server";
import { artLab, renderSpec } from "../lib/art-lab/manifest";

type Reply = { status: number; type: string; body: string };

/** Drives the connect-style middleware with an in-memory request. */
async function call(handler: ReturnType<typeof createArtReviewMiddleware>, method: string, url: string, init: { body?: string; headers?: Record<string, string> } = {}): Promise<Reply> {
  const req = new IncomingMessage(new Socket());
  req.method = method;
  req.url = url;
  req.headers = { host: "localhost:3461", ...init.headers };
  const res = new ServerResponse(req);
  const chunks: Buffer[] = [];
  const done = new Promise<Reply>(resolve => {
    res.end = ((chunk?: unknown) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
      resolve({ status: res.statusCode, type: String(res.getHeader("content-type") ?? ""), body: Buffer.concat(chunks).toString("utf8") });
      return res;
    }) as typeof res.end;
  });
  const pending = handler(req, res);
  if (init.body !== undefined) req.push(init.body);
  req.push(null);
  await pending;
  return done;
}

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "rtsai-art-"));
  const dir = join(root, "units/r2qilin/candidates/fixture-1");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, "units/r2qilin/spec.json"), JSON.stringify({ actor: "r2qilin" }));
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ id: "fixture-1", actor: "r2qilin", createdAt: "2026-10-03T00:00:00Z", kind: "cameo", fixture: true, files: { cameo: "cameo.png" } }));
  writeFileSync(join(dir, "cameo.png"), Buffer.from([137, 80, 78, 71]));
  writeFileSync(join(root, "secret.txt"), "outside units but inside the workspace");
  return root;
}

test("review gate: on in development, off in production", () => {
  assert.equal(reviewEnabled("production"), false);
  assert.equal(reviewEnabled("development"), true);
  assert.equal(reviewEnabled("test"), true);
});

test("review API answers 404 to everything when NODE_ENV is production", async () => {
  const root = workspace();
  try {
    const handler = createArtReviewMiddleware({ root, env: "production" });
    const originals = { modRoot: root, supportDir: root, cacheDir: root };
    const prodWithOriginals = createArtReviewMiddleware({ root, env: "production", originals });
    for (const url of ["/roster", "/ra2/gi.shp", "/ra2/secret.txt"]) assert.equal((await call(prodWithOriginals, "GET", url)).status, 404, `${url} in production`);
    for (const [method, url] of [["GET", "/state"], ["GET", "/file?path=units/r2qilin/spec.json"], ["POST", "/action"]] as const) {
      const reply = await call(handler, method, url, { body: "{}", headers: { "content-type": "application/json" } });
      assert.equal(reply.status, 404, `${method} ${url}`);
    }
    assert.equal(readFileSync(join(root, "secret.txt"), "utf8").length > 0, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("vite.config mounts the review API only on the dev server", () => {
  const config = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  const plugin = config.slice(config.indexOf("function artReviewDevApi"), config.indexOf("export default"));
  assert.match(plugin, /apply: "serve"/);
  assert.match(plugin, /process\.env\.NODE_ENV === "production"\) return/);
  assert.match(plugin, /createArtReviewMiddleware/);
});

test("review API in development: state, safe file reads and review.json writes", async () => {
  const root = workspace();
  try {
    const handler = createArtReviewMiddleware({ root, env: "development" });
    const state = JSON.parse((await call(handler, "GET", "/state")).body);
    assert.equal(state.units[0].actor, "r2qilin");
    assert.equal(state.units[0].candidates[0].fixture, true);
    assert.match(state.units[0].candidates[0].urls["cameo.png"], /^\/api\/art-review\/file\?path=units%2Fr2qilin/);

    assert.equal((await call(handler, "GET", "/file?path=units%2Fr2qilin%2Fcandidates%2Ffixture-1%2Fcameo.png")).type, "image/png");
    for (const bad of ["../package.json", "..%2F..%2Fetc%2Fpasswd", "C:%2FWindows%2Fwin.ini", "%2Fetc%2Fpasswd"]) {
      assert.equal((await call(handler, "GET", `/file?path=${bad}`)).status, 404, bad);
    }
    assert.equal(safeResolve(root, "units/../../x"), null);

    assert.equal((await call(handler, "POST", "/action", { body: "{}", headers: { "content-type": "text/plain" } })).status, 415, "JSON only, so cross-site forms need a preflight");
    assert.equal((await call(handler, "GET", "/state", { headers: { origin: "https://evil.example" } })).status, 403);
    assert.equal((await call(handler, "POST", "/action", { body: JSON.stringify({ type: "approve", actor: "../x", candidate: "a" }), headers: { "content-type": "application/json" } })).status, 400);

    const post = (body: unknown) => call(handler, "POST", "/action", { body: JSON.stringify(body), headers: { "content-type": "application/json" } });
    assert.equal((await post({ type: "comment", actor: "r2qilin", slot: "icon", candidate: "fixture-1", view: "Build icon · 2x", text: "Turret reads too small" })).status, 200);
    assert.equal((await post({ type: "choose", actor: "r2qilin", slot: "icon", candidate: "fixture-1", view: "Build icon · 1x" })).status, 200);
    assert.equal((await post({ type: "choose", actor: "r2qilin", slot: "model", candidate: "current" })).status, 200);
    const review = JSON.parse(readFileSync(join(root, "review.json"), "utf8")) as ReviewFile;
    assert.equal(review.r2qilin.version, 2);
    assert.equal(review.r2qilin.slots.icon.chosen, "fixture-1");
    assert.equal(review.r2qilin.slots.model.chosen, "current", "keep current");
    assert.equal(review.r2qilin.status, "decided", "both decision slots are decided");
    assert.deepEqual(review.r2qilin.comments.map(c => [c.slot, c.text]), [["icon", "Turret reads too small"]], "decisions are logged, not mixed into the Forge comments");
    assert.deepEqual(review.r2qilin.log.map(l => l.action), ["choose", "choose"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("review model: per-slot decisions, keep current, reject, and the decision queue", () => {
  let file: ReviewFile = {};
  file = applyReviewAction(file, { type: "comment", actor: "r2lynx", slot: "model", text: "Lower the turret" }, "2026-10-03T01:00:00Z");
  assert.equal(file.r2lynx.status, "in-review");
  file = applyReviewAction(file, { type: "choose", actor: "r2lynx", slot: "model", candidate: "voxel-v1" }, "2026-10-03T02:00:00Z");
  assert.equal(file.r2lynx.slots.model.chosen, "voxel-v1");
  file = applyReviewAction(file, { type: "reject", actor: "r2lynx", slot: "model", candidate: "voxel-v1" }, "2026-10-03T03:00:00Z");
  assert.equal(file.r2lynx.slots.model.chosen, null, "rejecting the chosen candidate clears the choice");
  assert.deepEqual(file.r2lynx.slots.model.rejected, ["voxel-v1"]);
  file = applyReviewAction(file, { type: "choose", actor: "r2lynx", slot: "model", candidate: "voxel-v1" }, "2026-10-03T04:00:00Z");
  assert.deepEqual(file.r2lynx.slots.model.rejected, [], "choosing a rejected candidate un-rejects it");
  assert.equal(validateAction({ type: "choose", actor: "r2lynx", slot: "turret", candidate: "a" }), "Bad slot");
  assert.equal(validateAction({ type: "reject", actor: "r2lynx", slot: "model", candidate: "current" }), "Only candidates can be rejected");
  assert.equal(validateAction({ type: "comment", actor: "r2lynx", text: "  " }), "Empty comment");
  assert.equal(validateAction({ type: "approve", actor: "r2lynx", candidate: "voxel-v1" }), "Unknown action");

  const ws = (createdAt: string): UnitWorkspace => ({ actor: "r2lynx", spec: null, comparisons: [], candidates: [{ id: "voxel-v2", actor: "r2lynx", createdAt, kind: "voxel", dir: "", urls: {}, files: { vxl: ["a.vxl"] } }] });
  assert.equal(needsDecision(ws("2026-10-03T00:00:00Z"), file.r2lynx), false, "decided after the newest candidate");
  assert.equal(needsDecision(ws("2026-10-03T05:00:00Z"), file.r2lynx), true, "a newer candidate needs a decision");
  assert.equal(needsDecision(ws("2026-10-03T05:00:00Z"), undefined), true, "never reviewed");
  assert.equal(slotState(ws("2026-10-03T00:00:00Z"), file.r2lynx, "model"), "chosen");
  assert.equal(slotState(ws("2026-10-03T00:00:00Z"), file.r2lynx, "icon"), "none");
  const kept = applyReviewAction(file, { type: "choose", actor: "r2lynx", slot: "model", candidate: "current" }, "2026-10-03T06:00:00Z");
  assert.equal(slotState(ws("2026-10-03T05:00:00Z"), kept.r2lynx, "model"), "current");
});

test("review.json version 1 entries migrate to per-slot decisions, keeping the Forge's fields", () => {
  const v1 = {
    status: "approved", approved: "cameo-v6", forgeRecommendation: { cameo: "cameo-v6" },
    comments: [
      { at: "2026-10-03T01:00:00Z", candidate: "voxel-v1", view: "voxel candidate", text: "Rejected: too dark", author: "owner" },
      { at: "2026-10-03T02:00:00Z", candidate: "cameo-v6", view: null, text: "Approved", author: "owner" },
      { at: "2026-10-03T03:00:00Z", candidate: null, view: null, text: "Make the gun longer", author: "owner" },
    ],
  };
  const kinds: Record<string, string> = { "cameo-v6": "cameo", "voxel-v1": "voxel" };
  const entry = migrateEntry(v1, id => kinds[id]);
  assert.equal(entry.version, 2);
  assert.equal(entry.slots.icon.chosen, "cameo-v6");
  assert.deepEqual(entry.slots.model.rejected, ["voxel-v1"]);
  assert.equal(entry.approved, undefined);
  assert.deepEqual(entry.forgeRecommendation, { cameo: "cameo-v6" });
  assert.deepEqual(entry.comments.map(c => c.text), ["Rejected: too dark", "Make the gun longer"], "bare decision notes leave the comment list");
  assert.equal(entry.comments[0].slot, "model");
});

test("candidate cost sums its calls, the concept and the variant it reuses; unknown is a dash", () => {
  const base = { actor: "r2qilin", createdAt: "", dir: "", urls: {}, files: {} };
  const all: Candidate[] = [
    { ...base, id: "concept-v1", kind: "concept", costUsd: 0.055603 },
    { ...base, id: "voxel-v1", kind: "voxel", costUsd: 0.067306, fromConcept: "concept-v1", imageTo3d: { model: "trellis" } },
    { ...base, id: "voxel-v2", kind: "voxel", costUsd: 0, calls: [], fromConcept: "concept-v1", variantOf: "voxel-v1", imageTo3d: { model: "trellis" } },
    { ...base, id: "cameo-x", kind: "cameo" },
  ];
  assert.equal(formatCost(candidateCost(all[2], all)), "$0.123", "v2 reuses v1's reference image; the concept counts once");
  assert.equal(formatCost(candidateCost(all[3], all)), "—");
});

test("voxel candidates are drawn in the current unit's slot: same scale, light and turret pivot", () => {
  const current = renderSpec(artLab.actors.r2qilin);
  const urls = Object.fromEntries(["r2qilin.vxl", "r2qilin.hva", "r2qilintur.vxl", "r2qilintur.hva", "r2qilinbarl.vxl", "r2qilinbarl.hva", "dropin/r2qilintur.vxl", "dropin/r2qilintur.hva", "c.pal"].map(f => [f, `/x/${f}`]));
  const spec = candidateRenderSpec(current, { id: "voxel-v1", actor: "r2qilin", createdAt: "", kind: "voxel", dir: "", urls, files: { vxl: ["r2qilin.vxl", "r2qilintur.vxl", "r2qilinbarl.vxl", "dropin/r2qilintur.vxl"], pal: "c.pal" } })!;
  assert.equal(spec.voxel!.scale, current.voxel!.scale);
  assert.equal(spec.palette!.url, "/x/c.pal");
  assert.deepEqual(spec.palette!.remap, current.palette!.remap);
  const byLabel = Object.fromEntries(spec.voxel!.parts.map(p => [p.label, p]));
  assert.equal(byLabel.body.defaultVisible, true);
  assert.equal(byLabel["turret (drop-in, for current rules)"].defaultVisible, true);
  assert.equal(byLabel.turret.defaultVisible, false, "the split turret is an alternative to the drop-in one");
  assert.deepEqual(byLabel.turret.turretOffset, [0, 0, 0]);
});
