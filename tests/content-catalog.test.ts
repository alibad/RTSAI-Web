import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { availability, catalog, factionById, factions, mediaById, resolveMode, unitById, units, unitsForFaction, downloadHref } from "../lib/game-content";
import { verifyEvidence } from "../scripts/release-evidence.mjs";
test("shared catalog has complete faction, unit, mode and media relationships", () => {
  assert.equal(catalog.schemaVersion, 1);
  assert.equal(new Set(factions.map(f => f.id)).size, 7);
  assert.equal(new Set(units.map(u => u.id)).size, 47);
  assert.deepEqual(catalog.modes.map(m => m.id), ["ra", "ra2"]);
  for (const f of factions) {
    assert.ok(mediaById(f.heroAssetId));
    for (const id of f.unitIds) assert.equal(unitById(id)?.factionId, f.id);
    for (const mode of ["ra", "ra2"] as const) {
      assert.equal(unitsForFaction(f.id, mode).length > 0, f.variants[mode].status === "implemented");
    }
  }
  for (const u of units) for (const id of u.assetIds) assert.ok(mediaById(id), id);
  assert.equal(unitById("cncloud")?.variants.ra.actorId, "CNCLOUD");
  assert.equal(unitById("cncloud")?.variants.ra2?.actorId, "r2cloud");
  assert.equal(unitById("cnhaiwang")?.variants.ra2?.actorId, "r2haiwang");
});
test("release coverage is mode-specific and unknown inputs are safe", () => {
  assert.equal(availability(factionById("saudi-arabia")!, "ra"), "In public Windows release");
  // RA2 exists in the mod but no public RA2 release certifies it yet.
  assert.equal(availability(factionById("saudi-arabia")!, "ra2"), "Development · release unconfirmed");
  assert.equal(availability(factionById("china")!, "ra2"), "Development · release unconfirmed");
  assert.equal(resolveMode("ra2"), "ra2");
  assert.equal(resolveMode("ra"), "ra");
  // RA2 is the product mode; callers such as the download page can pin another fallback.
  assert.equal(resolveMode(["ra"]), "ra2");
  assert.equal(resolveMode("unknown"), "ra2");
  assert.equal(resolveMode(undefined, "ra"), "ra");
  assert.equal(factionById("__proto__"), undefined);
  assert.equal(unitById("missing"), undefined);
  assert.equal(downloadHref("china", "ra2"), "/download?faction=china&mode=ra2");
});
test("snapshot carries provenance and archive no longer offers fake modes", async () => {
  const snapshot = JSON.parse(await readFile(new URL("../data/factions.generated.json", import.meta.url), "utf8"));
  assert.match(snapshot.sha256, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.source, "OpenRA-AI/catalog/factions.json");
  const archive = await readFile(new URL("../app/components/FactionArchive.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(archive, /world-war-iii|classic-red-alert/);
});
test("promotion refuses incomplete checks, mismatched hashes and invented signing", () => {
  const hash = "a".repeat(64);
  const index = { engine_commit: "b".repeat(40), product_commit: "c".repeat(40) };
  const assets = [{name: "game-setup.exe", size: 123, digest: "sha256:" + hash}];
  const proof = {schemaVersion:1, version:"1", engineCommit:index.engine_commit, productCommit:index.product_commit, checks:Object.fromEntries(["cleanInstall","upgrade","uninstall","localAI","externalProvider","missingRA2","secondarySteamLibrary"].map(key=>[key,true])), artifacts:{"game-setup.exe":{sha256:hash,sizeBytes:123,authenticode:"unsigned"}}};
  assert.doesNotThrow(()=>verifyEvidence(proof,index,"1",assets));
  assert.throws(()=>verifyEvidence({...proof, checks:{}},index,"1",assets), /acceptance/);
  assert.throws(()=>verifyEvidence(proof,index,"2",assets), /match/);
  assert.throws(()=>verifyEvidence(proof,index,"1",[{...assets[0],digest:"sha256:"+"d".repeat(64)}]), /digest/);
  assert.throws(()=>verifyEvidence({...proof,artifacts:{"game.dmg":{sha256:hash,sizeBytes:123}}},index,"1",[{name:"game.dmg",size:123}]), /Mac signing/);
});
