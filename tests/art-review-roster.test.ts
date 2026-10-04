import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { artLab } from "../lib/art-lab/manifest";
import { conditionHolds, encodePng } from "../lib/art-lab/originals";
import { loadModData, type ModReader } from "../lib/art-lab/resolve";
import { buildableFor, computeRosters, pickReference, type RosterUnit } from "../lib/art-lab/roster";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const modRoot = join(web, "../RTSAI-Mod");

function fixture(): ModReader {
  const files: Record<string, string> = {
    "mods/rtsai/mod.yaml": "Rules:\n\tra2|rules/r.yaml\nSequences:\nModelSequences:\nFluentMessages:\n\tra2|f.ftl\n",
    "mods/rtsai/rules/r.yaml": [
      "World:", "\tFaction@c:", "\t\tName: c-name", "\t\tInternalName: china", "\t\tSide: Allies",
      "\tStartingUnits@c:", "\t\tFactions: china", "\t\tBaseActor: amcv",
      "Player:", "\tProvidesPrerequisite@c:", "\t\tPrerequisite: faction.china", "\t\tFactions: china",
      "\tProvidesTechPrerequisite@all:", "\t\tPrerequisites: techlevel.low",
      "amcv:", "\tTransforms:", "\t\tIntoActor: gacnst", "\tRenderVoxels:",
      "gacnst:", "\tProvidesPrerequisite:", "\t\tPrerequisite: structures.allies",
      "\tProvidesPrerequisite@us:", "\t\tPrerequisite: structures.america", "\t\tFactions: america",
      "gapile:", "\tBuildable:", "\t\tQueue: Building", "\t\tPrerequisites: ~structures.allies", "\tBuilding:", "\tRenderSprites:",
      "\tProvidesPrerequisite@b:", "\t\tPrerequisite: gapile",
      "e1:", "\tBuildable:", "\t\tQueue: Infantry", "\t\tPrerequisites: ~gapile, ~!faction.china", "\tRenderSprites:", "\tWithInfantryBody:",
      "\tStrategicRole:", "\t\tRoles: line-infantry", "\tValued:", "\t\tCost: 200",
      "engineer:", "\tBuildable:", "\t\tQueue: Infantry", "\t\tPrerequisites: ~gapile, ~techlevel.low", "\tRenderSprites:", "\tWithInfantryBody:",
      "seal:", "\tBuildable:", "\t\tQueue: Infantry", "\t\tPrerequisites: ~gapile, ~structures.america", "\tRenderSprites:", "\tWithInfantryBody:",
      "r2rifle:", "\tBuildable:", "\t\tQueue: Infantry", "\t\tPrerequisites: ~gapile, ~faction.china", "\tRenderSprites:", "\tWithInfantryBody:",
      "\tStrategicRole:", "\t\tRoles: line-infantry", "\tValued:", "\t\tCost: 250", "\tTooltip:", "\t\tName: rifle-name",
    ].join("\n") + "\n",
    "mods/rtsai/f.ftl": "c-name = China\nrifle-name = Rifleman\n",
  };
  return { text: p => files[p], bytes: () => new Uint8Array(0), exists: p => p in files };
}

test("rosters come from the rules: starting units, provided prerequisites and faction gates", () => {
  const data = loadModData(fixture());
  const { owned } = buildableFor(data, "china");
  assert.ok(owned.has("gacnst"), "the MCV deploys into the construction yard");
  assert.ok(owned.has("gapile") && owned.has("engineer"));
  assert.ok(!owned.has("e1"), "~!faction.china gates the GI off");
  assert.ok(!owned.has("seal"), "a country-only prerequisite (structures.america) is not China's");
  const { factions, stock } = computeRosters(data, ["china"]);
  const china = factions[0];
  assert.equal(china.name, "China");
  assert.deepEqual(china.units.map(u => [u.id, u.origin]), [["r2rifle", "new"], ["engineer", "original"], ["gapile", "original"]]);
  assert.deepEqual(china.replaced, ["e1"]);
  assert.equal(china.units[0].reference, "e1", "the new rifleman is compared with the GI it replaces");
  assert.equal(china.units[0].name, "Rifleman");
  assert.equal(stock.engineer.name, "Engineer", "names fall back to the capitalised id");
});

test("a Reference prefers the replaced unit of the same role, then the side's standard one", () => {
  const u = (id: string, roles: string[], cost: number, advanced = false): RosterUnit => ({ id, name: id, category: "vehicle", queue: "Vehicle", order: 0, cost, roles, origin: "original", reference: null, advanced, domain: "ground" });
  const mbt = { ...u("r2mbt", ["main-battle-tank"], 1100), origin: "new" as const };
  const grizzly = u("mtnk", ["main-battle-tank"], 700);
  const mirage = u("mgtk", ["main-battle-tank"], 1000, true);
  const ifv = u("fv", ["anti-air"], 600);
  assert.equal(pickReference(mbt, [grizzly, mirage, ifv], [])?.id, "mtnk", "the standard tank beats the tech-gated Mirage");
  assert.equal(pickReference(mbt, [ifv], [u("htnk", ["main-battle-tank"], 900)])?.id, "htnk", "same role outside the replaced list beats a different role");
  assert.equal(pickReference({ ...mbt, category: "ship" }, [ifv], []), null, "never across domains");
  const ship = (id: string, roles: string[], cost: number): RosterUnit => ({ ...u(id, roles, cost), category: "ship", domain: "naval" });
  const heli = { ...u("shad", ["transport"], 1000), category: "aircraft" as const, domain: "air" as const };
  const kunlun = { ...ship("r2kunlun", ["transport"], 1100), origin: "new" as const };
  const pick = pickReference(kunlun, [heli, ship("dest", ["naval-screen"], 1000), ship("lcrf", ["transport"], 900)], []);
  assert.equal(pick?.id, "lcrf", "a landing ship meets the amphibious transport, never the transport helicopter");
  assert.match(pick!.why, /naval · replaced by this faction · same role \(transport\)/);
});

test("original-unit layers drawn only when their condition holds on a fresh unit", () => {
  const spawn = new Set(["undeployed"]);
  assert.equal(conditionHolds("!undeployed && editorhack", spawn), false, "the GI's sandbag turret");
  assert.equal(conditionHolds("mindcontrolled", spawn), false, "the mind-control overlay");
  assert.equal(conditionHolds("!deployed && !rank-elite", spawn), true);
  assert.equal(conditionHolds("(deployed || undeployed) && !parachute", spawn), true);
  assert.equal(conditionHolds("ammo > 0", spawn), false);
});

test("cameo PNGs are valid RGBA images", () => {
  const png = encodePng(2, 1, new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0]));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 2);
  assert.equal(png.readUInt32BE(20), 1);
  assert.equal(png.subarray(png.length - 8, png.length - 4).toString("ascii"), "IEND");
});

test("every faction's real roster from the sibling RTSAI-Mod (skipped without the checkout)", { skip: !existsSync(join(modRoot, "mods/rtsai/mod.yaml")) }, () => {
  const reader: ModReader = {
    text: p => readFileSync(join(modRoot, p), "utf8"), bytes: p => new Uint8Array(readFileSync(join(modRoot, p))), exists: p => existsSync(join(modRoot, p)),
  };
  const { factions, stock } = computeRosters(loadModData(reader));
  const without: string[] = [];
  assert.equal(factions.length, 16, "all nine original and seven modern selectable countries");
  for (const f of factions) {
    const fresh = f.units.filter(u => u.origin === "new").map(u => u.id).sort();
    assert.deepEqual(fresh, [...(artLab.factions.find(a => a.id === f.id)?.actors ?? [])].sort(), `${f.id}: every new unit, as the Art Lab lists them`);
    for (const u of f.units) assert.ok(!f.replaced.includes(u.id), `${f.id}: ${u.id} is gated off but listed`);
    // Every Reference shares its unit's domain (infantry, ground, air, naval, defence, base building).
    for (const u of f.units.filter(x => x.origin === "new")) {
      if (!u.reference) { without.push(`${f.id}/${u.id} (${u.domain})`); continue; }
      assert.equal(stock[u.reference].domain, u.domain, `${f.id}: ${u.id} (${u.domain}) is paired with ${u.reference} (${stock[u.reference].domain})`);
    }
    assert.ok(f.units.some(u => u.origin === "original"), `${f.id} still builds original RA2 units`);
  }
  const ref = (f: string, id: string) => factions.find(x => x.id === f)!.units.find(u => u.id === id)!.reference;
  assert.equal(ref("china", "r2qilin"), "mtnk", "Qilin vs the Grizzly");
  assert.equal(ref("iran", "r2karrar"), "htnk", "Karrar vs the Rhino");
  assert.equal(ref("saudi", "r2m1a2s"), "mtnk");
  assert.equal(ref("china", "r2cnrifle"), "e1", "rifleman vs the GI");
  assert.ok(factions.find(f => f.id === "china")!.replaced.includes("mtnk"));
  assert.equal(ref("china", "r2kunlun"), "lcrf", "Kunlun landing ship vs the Allied Amphibious Transport (a hovercraft)");
  assert.equal(ref("china", "r2crane"), "shad", "a transport helicopter vs the Night Hawk");
  assert.equal(ref("china", "r2jiaolong"), "sub", "a submarine vs the Typhoon sub");
  // New units with no original in their domain (none today); listed so a new one shows up in the test output.
  if (without.length) console.log(`No same-domain original for: ${without.join(", ")}`);
  assert.deepEqual(without, []);
});
