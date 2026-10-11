import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { availability, catalog, factionById, factions, mediaById, resolveMode, unitById, units, unitsForFaction, downloadHref, rosters, rosterActors, rosterFactions, rosterFactionById } from "../lib/game-content";
import { verifyEvidence } from "../scripts/release-evidence.mjs";
import modRelease from "../data/rtsai-mod-release.json";

// RTS AI (mode ra2) claims a faction only when the published release manifest names it.
const ra2Release = (id: string) => modRelease.published && (modRelease.ra2FactionIds as string[]).includes(id) ? "In public Windows release" : "Development · release unconfirmed";
test("shared catalog has complete faction, unit, mode and media relationships", () => {
  assert.equal(catalog.schemaVersion, 1);
  assert.equal(new Set(factions.map(f => f.id)).size, 7);
  assert.equal(new Set(units.map(u => u.id)).size, 49);
  assert.deepEqual(catalog.modes.map(m => m.id), ["ra", "ra2"]);
  for (const f of factions) {
    assert.ok(mediaById(f.heroAssetId));
    for (const id of f.unitIds) assert.equal(unitById(id)?.factionId, f.id);
    for (const mode of ["ra", "ra2"] as const) {
      assert.equal(unitsForFaction(f.id, mode).length > 0, f.variants[mode].status === "implemented");
    }
  }
  for (const u of units) for (const id of u.assetIds) assert.ok(mediaById(id), id);
  assert.equal(unitById("cncloud")?.variants.ra?.actorId, "r2cloud");
  assert.equal(unitById("cncloud")?.variants.ra2?.actorId, "r2cloud");
  assert.equal(unitById("cnhaiwang")?.variants.ra2?.actorId, "r2haiwang");
});
test("release coverage is mode-specific and unknown inputs are safe", () => {
  assert.equal(availability(factionById("saudi-arabia")!, "ra"), "Development · release unconfirmed");
  // RTS AI claims follow data/rtsai-mod-release.json, nothing else.
  assert.equal(availability(factionById("saudi-arabia")!, "ra2"), ra2Release("saudi-arabia"));
  assert.equal(availability(factionById("china")!, "ra2"), ra2Release("china"));
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
test("both new factions expose complete native domains; release claims come only from the published manifest", () => {
  for (const id of ["israel", "hezbollah"]) for (const mode of ["ra", "ra2"] as const) {
    const faction = factionById(id)!;
    assert.equal(availability(faction, mode), mode === "ra2" ? ra2Release(id) : "Development · release unconfirmed");
    const roster = rosterFactionById(id, mode)!;
    const actors = rosterActors(roster);
    assert.deepEqual(new Set(actors.map(a => a.category)), new Set(["infantry", "vehicle", "aircraft", "ship", "defense", "structure"]));
    const prefix = "r2" + (id === "israel" ? "il" : "hz");
    const relay = actors.find(a => a.id === prefix + "relay")!;
    const workshop = actors.find(a => a.id === prefix + "workshop")!;
    assert.equal(relay.behavior.weapons.length, 0);
    assert.equal(workshop.behavior.weapons.length, 0);
    assert.ok(relay.behavior.actions.some(a => a.label === "Support aura"));
    assert.ok(workshop.behavior.actions.some(a => a.label === "Power"));
    for (const defense of actors.filter(a => a.category === "defense" && a.id.startsWith(prefix))) assert.ok(defense.behavior.weapons.length > 0, defense.id);
    for (const unit of unitsForFaction(id, mode)) {
      assert.ok(actors.some(a => a.id === unit.variants[mode]?.actorId.toLowerCase()), unit.id);
      for (const asset of unit.assetIds) assert.equal(mediaById(asset)?.faction, id);
    }
  }
});
test("complete rosters retain source names, countries and all buildings", async () => {
  const source = JSON.parse(await readFile(new URL("../data/standalone-facts.generated.json", import.meta.url), "utf8"));
  for (const mode of ["ra", "ra2"] as const) {
    const profile = source.profiles[mode === "ra" ? "rtsai-topdown" : "rtsai"];
    assert.equal(rosterFactions(mode).length, 16);
    const originalActors = new Map(profile.factions.flatMap((f: {units: {id: string}[]}) => f.units.map(a => [a.id, a] as const)));
    assert.deepEqual(rosters.actors.filter(a => a.mode === mode).map(a => a.id).sort(), [...originalActors.keys()].sort());
    for (const faction of rosterFactions(mode)) {
      const original = profile.factions.find((f: {id: string}) => f.id === faction.id);
      assert.equal(faction.name, original.name);
      assert.deepEqual(faction.actors, original.units.map((a: {id: string}) => `${mode}:${a.id}`));
      for (const actor of rosterActors(faction)) {
        const unit = original.units.find((a: {id: string}) => a.id === actor.id);
        for (const key of ["name", "cost", "category", "roles"] as const) assert.deepEqual(actor[key], unit[key]);
        for (const key of ["health", "armor", "speed", "footprint", "weapons", "actions", "targetTypes"] as const) assert.deepEqual(actor.behavior[key], unit.behavior[key]);
        assert.equal(actor.behavior.waterPlacement, unit.category === "ship" || unit.waterPlacement);
      }
    }
  }
  assert.equal(rosterFactionById("saudi-arabia", "ra2")?.id, "saudi");
  assert.equal(rosterFactionById("ukraine", "ra2"), undefined);
  assert.equal(rosterFactionById("__proto__", "ra2"), undefined);
});
test("snapshot carries provenance and archive no longer offers fake modes", async () => {
  const snapshot = JSON.parse(await readFile(new URL("../data/factions.generated.json", import.meta.url), "utf8"));
  assert.match(snapshot.sha256, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.source, "OpenRA-AI/catalog/factions.json");
  // Loading lines and audio-team notes stay in the game's catalog; the website snapshot (bundled into client code) omits them.
  for (const faction of snapshot.catalog.factions) assert.equal(faction.flavour, undefined, `${faction.id} has no flavour in the web snapshot`);
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
