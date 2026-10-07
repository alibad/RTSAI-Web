import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = path => readFileSync(join(root, path));
const json = path => JSON.parse(read(path).toString("utf8"));
const walk = dir => readdirSync(dir).flatMap(name => { const p = join(dir, name); return statSync(p).isDirectory() ? walk(p) : [p]; });
const manifest = json("data/faction-art.json");
const provenance = json("data/faction-art-provenance.json");
const artLab = json("data/art-lab.json");

test("every public faction-art file is recorded, content-hashed and made by the project", () => {
  const listed = new Map(provenance.files.map(f => [f.path, f]));
  const files = walk(join(root, "public/faction-art")).map(p => relative(root, p).replaceAll("\\", "/"));
  assert.deepEqual(files.filter(p => !listed.has(p)), [], "no unrecorded file ships");
  for (const path of files) {
    const bytes = read(path), record = listed.get(path);
    assert.equal(record.sha256, createHash("sha256").update(bytes).digest("hex"), path);
    assert.equal(record.bytes, bytes.length, path);
    if (!path.endsWith("LICENSE.txt")) assert.ok(path.includes(`.${record.sha256.slice(0, 12)}.`), `${path} carries its content hash`);
    for (const source of record.derivedFrom ?? []) {
      // Project sources only: the art repo, the mod's installed art, or the Studio's flag-icons copy. Never EA data.
      if (source.path) assert.match(source.path, /^(RTSAI-Art\/|RTSAI-Mod[\w-]*\/mods\/rtsai\/|RTSAI-Web[\w-]*\/(docs\/flag-icons-LICENSE\.txt|app\/components\/art\/review\/flags\.ts))/, `${path} <- ${source.path}`);
      assert.doesNotMatch(JSON.stringify(source), /reference-local|ra2-originals|classic-originals|\.mix\b/i);
    }
  }
  assert.match(provenance.policy, /No EA\/RA2 file/);
});

test("all modern units have a render and a cameo; every faction has a lineup", () => {
  const actors = artLab.factions.flatMap(f => f.actors);
  assert.equal(actors.length, 124);
  for (const id of actors) {
    const unit = manifest.units[id];
    assert.ok(unit, id);
    for (const src of [...Object.values(unit.render.avif), ...Object.values(unit.render.webp), unit.cameo.src, unit.sprite?.src].filter(Boolean)) assert.ok(existsSync(join(root, "public", src)), src);
    assert.equal(unit.render.width / unit.render.height, 1.25, `${id} keeps the 5:4 render frame`);
  }
  assert.ok(Object.values(manifest.units).filter(u => u.sprite).length >= 100, "most units animate");
  assert.deepEqual(Object.keys(manifest.lineups).sort(), artLab.factions.map(f => f.catalogId).sort());
  for (const [id, lineup] of Object.entries(manifest.lineups)) for (const actor of lineup.actors) assert.equal(manifest.units[actor].faction, id, `${id} lineup uses its own units`);
});

test("national flags are flag-icons (MIT); Hezbollah's own flag ships by owner decision with its licence recorded", () => {
  const licence = read("public/faction-art/flags/LICENSE.txt").toString("utf8");
  assert.match(licence, /The MIT License/);
  assert.match(licence, /Panayiotis Lipiridis/);
  for (const id of ["china", "iran", "turkey", "saudi", "yemen", "israel", "hezbollah", "america", "russia", "england", "ukraine"]) assert.ok(manifest.flags[id], id);
  const records = new Map(provenance.files.map(f => [f.path, f]));
  for (const [id, flag] of Object.entries(manifest.flags)) {
    const svg = read(join("public", flag.src)).toString("utf8"), record = records.get(`public${flag.src}`);
    // In-document references (#id) are fine; nothing external, no scripts, no editor metadata.
    assert.doesNotMatch(svg, /flag-icons-|<script|href="(?!#)|url\((?!#)|<image|inkscape|sodipodi/i, flag.src);
    assert.match(svg, /^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"[\s\S]*<\/svg>\s*$/, `${flag.src} is a complete SVG document`);
    assert.ok([...svg].every(c => c.charCodeAt(0) >= 32 || c === "\n" || c === "\r" || c === "\t"), `${flag.src} has no control characters`);
    if (id === "hezbollah") {
      // Not a national flag and not MIT: an organisation flag, published by the owner's decision (docs/faction-art.md).
      assert.equal(record.kind, "organisation flag");
      assert.match(record.licence, /Non-free/);
      assert.match(read("docs/faction-art.md").toString("utf8"), /Hezbollah flag[\s\S]*owner/i);
    } else {
      assert.match(svg, /^<svg[^>]+viewBox="0 0 640 480"/);
      assert.equal(record.kind, "national flag");
      assert.match(record.licence, /^MIT/);
    }
  }
});
