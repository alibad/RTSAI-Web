import assert from "node:assert/strict";
import test from "node:test";
import { conditionHolds, demoWeapons, dummyTargets, shotDamage, volleyMs, weaponEffect, type RulesWeapon, type ViewerDummy } from "../lib/weapon-demo";
import { healthAt, planAttack, resultLabel, screenOffset, unitPoseAt, type UnitShape } from "../app/components/art/viewer/attack";
import { rosters } from "../lib/game-content";

const actor = (id: string) => rosters.actors.find(a => a.mode === "ra2" && a.id === id)!;
const weapons = (id: string) => actor(id).behavior.weapons as unknown as RulesWeapon[];
const dummies: ViewerDummy[] = [
  { kind: "infantry", name: "Infantry", health: 125, armor: "None" }, { kind: "vehicle", name: "Tank", health: 400, armor: "Heavy" },
  { kind: "building", name: "Building", health: 500, armor: "Steel" }, { kind: "aircraft", name: "Aircraft", health: 150, armor: "Light" },
  { kind: "ship", name: "Ship", health: 600, armor: "Heavy" }, { kind: "sub", name: "Submarine", health: 600, armor: "Heavy" },
];
const infantry: UnitShape = { turreted: false, defenceTurret: null, kind: "infantry", fireAnimMs: 400, canRun: true };

test("conditions: the armament a unit fires as it stands on the map", () => {
  assert.equal(conditionHolds(null), true);
  assert.equal(conditionHolds("!deployed && !rank-elite"), true);
  assert.equal(conditionHolds("deployed && !rank-elite"), false);
  assert.equal(conditionHolds("deployed && !rank-elite", new Set(["deployed"])), true);
  assert.equal(conditionHolds("(a || b) && !c", new Set(["b"])), true);
  assert.equal(conditionHolds("ammo > 0"), false);
});

test("the Attack demo offers what a unit fires, plus a switchable mode; never elite or passenger variants", () => {
  assert.deepEqual(demoWeapons(weapons("e1")).map(w => [w.id, w.mode]), [["M60", null], ["para", "deployed"]]);
  assert.deepEqual(demoWeapons(weapons("fv")).map(w => w.id), ["HoverMissile"], "the IFV's nine passenger weapons are not offered");
  assert.deepEqual(demoWeapons(weapons("r2cnportable")).map(w => [w.id, w.mode, w.effect]), [["R2ChinaPortableAT", null, "missile"], ["R2ChinaPortableAA", "aa-mode", "missile"]]);
  assert.deepEqual(demoWeapons(weapons("dog")).map(w => [w.id, w.effect]), [["DogJaw", "bite"]]);
  assert.deepEqual(demoWeapons(weapons("yuri")), [], "mind control is not an attack with damage");
  assert.deepEqual(demoWeapons(weapons("carrier")), [], "a carrier launches aircraft; it fires nothing itself");
  assert.deepEqual(demoWeapons(weapons("engineer")), []);
});

test("each weapon flies as its projectile does", () => {
  const effect = (id: string, weapon = 0) => demoWeapons(weapons(id))[weapon].effect;
  assert.equal(effect("e1"), "tracer");
  assert.equal(effect("r2qilin"), "shell");
  assert.equal(effect("r2qilin", 1), "tracer");
  assert.equal(effect("snipe"), "bullet", "a sniper's round flies flat whatever its reach");
  assert.equal(effect("gtgcan"), "artillery");
  assert.equal(effect("ttnk"), "tesla");
  assert.equal(effect("deso"), "rad");
  assert.equal(effect("sref"), "laser");
  assert.equal(effect("sub"), "torpedo");
  assert.equal(effect("zep"), "bomb");
  assert.equal(effect("r2mantis"), "missile");
  assert.equal(weaponEffect({ id: "FlakTrackAAGun", projectile: "Bullet", targets: ["Air"], range: 10 }), "flak");
});

test("targets: what the weapon can hit, the one it hurts most first, damage from its versus table", () => {
  const [gun, coax] = demoWeapons(weapons("r2qilin"));
  assert.deepEqual(dummyTargets(gun, dummies, "vehicle").map(d => d.kind), ["vehicle", "building", "infantry"]);
  assert.deepEqual(dummyTargets(coax, dummies, "vehicle").map(d => d.kind), ["infantry", "building", "vehicle"]);
  assert.equal(shotDamage(gun, "Heavy"), 68);
  assert.equal(shotDamage(gun, "None"), 17);
  assert.deepEqual(dummyTargets(demoWeapons(weapons("r2mantis"))[0], dummies, "vehicle").map(d => d.kind), ["aircraft"], "anti-air fires at aircraft only");
  assert.deepEqual(dummyTargets(demoWeapons(weapons("dog"))[0], dummies, "infantry").map(d => d.kind), ["infantry"]);
  assert.equal(dummyTargets(demoWeapons(weapons("ttnk"))[0], dummies, "vehicle")[0].kind, "vehicle", "a tie goes to the unit's own kind");
  assert.deepEqual(dummyTargets(demoWeapons(weapons("sub"))[0], dummies, "ship").map(d => d.kind), ["ship", "sub"]);
});

test("the demo fires at the weapon's real cadence until the target is destroyed", () => {
  const m60 = demoWeapons(weapons("e1"))[0];
  assert.equal(volleyMs(m60), 800);
  const plan = planAttack({ weapon: m60, dummy: dummies[0], aim: 896, startFacing: 896, shape: infantry });
  assert.equal(plan.distance, 4 * 1024, "the target stands at the weapon's range");
  const at = screenOffset(896, 4 * 1024);
  assert.ok(at.x > 0 && at.y < 0, "north-east of the unit");
  assert.equal(plan.shots.filter(s => s.hit).length, 7, "125 health at 20 a shot");
  assert.deepEqual(plan.shots.slice(0, 3).map(s => s.fire - plan.firstShot), [0, 800, 1600], "one shot per 20-tick reload");
  assert.equal(healthAt(plan, plan.deathAt! - 1), 5);
  assert.equal(healthAt(plan, plan.deathAt!), 0);
  assert.equal(healthAt(plan, plan.respawnAt!), 125, "a fresh target after the wreck clears");
  assert.match(resultLabel(plan), /^Destroyed in 4\.8 s · 7 hits$/);
  const weak = planAttack({ weapon: m60, dummy: dummies[1], aim: 896, startFacing: 896, shape: infantry });
  assert.equal(weak.deathAt, null, "a rifle barely scratches a tank");
  assert.match(resultLabel(weak), /% in .* s · ~\d+ s to destroy$/);
});

test("turrets turn to the target, bodies turn when there is no turret, and the dog runs in and leaps", () => {
  const gun = demoWeapons(weapons("r2qilin"))[0];
  const turret = planAttack({ weapon: gun, dummy: dummies[1], aim: 896, startFacing: 640, shape: { ...infantry, kind: "vehicle", turreted: true, fireAnimMs: 0 } });
  const start = unitPoseAt(turret, 0), aimed = unitPoseAt(turret, turret.firstShot);
  assert.equal(start.facing, 640);
  assert.equal(aimed.facing, 640, "the hull stays");
  assert.equal(aimed.weaponFacing, 896, "the turret faces the target");
  assert.equal(aimed.turret, 256);
  const bite = planAttack({ weapon: demoWeapons(weapons("dog"))[0], dummy: dummies[0], aim: 896, startFacing: 896, shape: { ...infantry, fireAnimMs: 480 } });
  assert.ok(bite.lunge && bite.lunge.runEnd > bite.lunge.runStart, "the dog runs in");
  assert.equal(unitPoseAt(bite, (bite.lunge!.runStart + bite.lunge!.runEnd) / 2).action, "run");
  assert.equal(unitPoseAt(bite, bite.lunge!.runEnd + 10).action, "fire", "then leaps");
  assert.equal(bite.deathAt, bite.lunge!.jumpEnd, "and the bite lands with the leap");
});
