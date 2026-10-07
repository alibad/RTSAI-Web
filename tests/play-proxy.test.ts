import assert from "node:assert/strict";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { brotliCompressSync } from "node:zlib";
import { isPlayPath, proxyTo } from "../lib/play-proxy";
import { encounterHref, sandboxHref, sandboxState } from "../lib/art-lab/sandbox";

const listen = (server: Server) => new Promise<number>(r => server.listen(0, "127.0.0.1", () => r((server.address() as AddressInfo).port)));
const get = (port: number, path: string, method = "GET", headers: Record<string, string> = {}, body?: string) => new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }>((resolve, reject) => {
  const req = request({ hostname: "127.0.0.1", port, path, method, headers }, res => {
    const chunks: Buffer[] = [];
    res.on("data", c => chunks.push(c)); res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
  });
  req.on("error", reject);
  if (body) req.write(body);
  req.end();
});

test("play proxy: headers, ranges, 304, brotli and POST bodies pass through untouched", async () => {
  const pack = Buffer.alloc(3 * 1024 * 1024, 7);
  const br = brotliCompressSync(Buffer.from("<!doctype html>game"));
  const game = createServer((req, res) => {
    if (req.url === "/play/") { res.writeHead(200, { "Content-Type": "text/html", "Content-Encoding": "br", "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", ETag: '"v1"' }); res.end(br); return; }
    if (req.url === "/play/pack.bin") {
      if (req.headers["if-none-match"] === '"p1"') { res.writeHead(304, { ETag: '"p1"' }); res.end(); return; }
      const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range ?? "");
      if (m) { const [a, b] = [Number(m[1]), Number(m[2])]; res.writeHead(206, { "Accept-Ranges": "bytes", "Content-Range": `bytes ${a}-${b}/${pack.length}`, "Cross-Origin-Resource-Policy": "same-origin" }); res.end(pack.subarray(a, b + 1)); return; }
      res.writeHead(200, { "Content-Length": pack.length }); res.end(pack); return;
    }
    if (req.method === "POST" && req.url === "/play/api/verify") { const chunks: Buffer[] = []; req.on("data", c => chunks.push(c)); req.on("end", () => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ got: Buffer.concat(chunks).toString() })); }); return; }
    res.writeHead(404); res.end();
  });
  const gamePort = await listen(game);
  const play = proxyTo(new URL(`http://127.0.0.1:${gamePort}`), "down");
  const gateway = createServer((req, res) => (isPlayPath(req.url) ? play(req, res) : (res.writeHead(418), res.end())));
  const port = await listen(gateway);
  try {
    const page = await get(port, "/play/", "GET", { "Accept-Encoding": "br" });
    assert.equal(page.status, 200);
    assert.deepEqual([page.headers["cross-origin-opener-policy"], page.headers["cross-origin-embedder-policy"], page.headers["content-encoding"], page.headers.etag], ["same-origin", "require-corp", "br", '"v1"']);
    assert.deepEqual(page.body, br, "brotli bytes are not decoded or recompressed");
    const part = await get(port, "/play/pack.bin", "GET", { Range: "bytes=100-199" });
    assert.deepEqual([part.status, part.headers["content-range"], part.headers["cross-origin-resource-policy"], part.body.length], [206, `bytes 100-199/${pack.length}`, "same-origin", 100]);
    assert.equal((await get(port, "/play/pack.bin", "GET", { "If-None-Match": '"p1"' })).status, 304);
    assert.equal((await get(port, "/play/pack.bin")).body.length, pack.length, "large bodies stream through whole");
    assert.equal(JSON.parse((await get(port, "/play/api/verify", "POST", { "Content-Type": "application/json" }, '{"hash":1}')).body.toString()).got, '{"hash":1}');
    assert.equal((await get(port, "/playground")).status, 418, "only /play is the game's");
    game.close();
    const down = await get(port, "/play/");
    assert.deepEqual([down.status, down.body.toString()], [502, "down"]);
  } finally { gateway.close(); game.close(); }
});

test("sandbox link: the Encounter setup in the sandbox's URL contract", () => {
  const setup = { placements: [{ key: "a", id: "r2m1a2s", side: 0 as const, u: 52, v: 66, deploy: false, faction: "saudi", order: "move" as const, destination: { u: 70, v: 66 } }, { key: "b", id: "r2karrar", side: 1 as const, u: 76, v: 66, deploy: false }], factions: ["saudi", "iran"], level: 1, autorun: true };
  const state = sandboxState(setup);
  assert.deepEqual(state.placements[0], { id: "r2m1a2s", side: 0, u: 52, v: 72, order: "move", deploy: false, faction: "saudi", destination: { u: 70, v: 72 } });
  assert.deepEqual([state.placements[1].faction, state.placements[1].order, state.fa, state.fb, state.level, state.autorun], ["iran", "engage", "saudi", "iran", 1, true]);
  const href = sandboxHref(setup);
  assert.match(href, /^\/play\/\?mode=sandbox&s=[A-Za-z0-9_-]+$/);
  const decoded = JSON.parse(Buffer.from(href.split("s=")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  assert.deepEqual(decoded, JSON.parse(JSON.stringify(state)));
});

test("the Studio's Encounter for a unit: it against the default opponent, opened in edit mode unless asked to run", () => {
  const decode = (href: string) => JSON.parse(Buffer.from(href.split("s=")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  const edit = decode(encounterHref("r2qilin", "china"));
  assert.deepEqual([edit.fa, edit.fb, edit.autorun, edit.placements.map((p: { id: string; side: number; faction: string }) => `${p.side}:${p.id}:${p.faction}`)], ["china", "russia", false, ["0:r2qilin:china", "1:htnk:russia"]]);
  assert.equal(decode(encounterHref("r2qilin", "china", { autorun: true })).autorun, true);
});
