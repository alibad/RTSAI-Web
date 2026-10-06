import assert from "node:assert/strict";
import test from "node:test";
import { rosters } from "../lib/game-content";
import { publicItem } from "../lib/unit-art/resolve-public";
import { frameKey } from "../lib/unit-art/types";
import { quantize, toFacing } from "../lib/workshop-units";

test("public unit art is the modern factions' own published art; original and Classic units have none", () => {
  let withArt = 0;
  for (const actor of rosters.actors) {
    const item = publicItem({ key: actor.key, id: actor.id, mode: actor.mode as "ra" | "ra2", category: actor.category });
    if (actor.mode !== "ra2" || !actor.id.startsWith("r2")) { assert.equal(item, null, `${actor.key} must stay a placeholder on the public site`); continue; }
    assert.ok(item, `${actor.key} has published art`);
    withArt++;
    const urls = [item.spec.palette?.url, ...(item.spec.voxel?.parts.flatMap(p => [p.vxl, p.hva]) ?? []), ...(item.sprite?.sequences.map(s => s.file) ?? [])].filter((u): u is string => Boolean(u));
    for (const url of urls) assert.match(url, /^\/art-lab\//, `${actor.key}: ${url} is a committed public file`);
    assert.equal(item.fire, null, "muzzle flashes are original effect art: never on the public site");
  }
  assert.ok(withArt > 100);
});

test("simulation headings map to OpenRA facings and quantize to the art's facings", () => {
  // Classic's rectangular grid: cell axes are world axes.
  assert.equal(toFacing(0, false), 768, "east (+x) is facing 768");
  assert.equal(toFacing(Math.PI / 2, false), 512, "south (+y) is facing 512");
  assert.equal(toFacing(Math.PI, false), 256, "west is facing 256");
  assert.equal(toFacing(-Math.PI / 2, false), 0, "north is facing 0");
  // RA2's isometric grid: a cell step +x is world south-east, +y south-west, -y north-east (OpenRA CenterOfCell).
  assert.equal(toFacing(0, true), 640);
  assert.equal(toFacing(Math.PI / 2, true), 384);
  assert.equal(toFacing(-Math.PI / 2, true), 896);
  assert.equal(quantize(30, 32), 32);
  assert.equal(quantize(1020, 32), 0);
  assert.equal(quantize(200, 8), 256);
  assert.equal(quantize(700, 1), 0);
  assert.notEqual(frameKey({ art: "a", action: "stand", facing: 0, aim: -1, frame: 0, color: "F21818", tint: 1, shadow: true }), frameKey({ art: "a", action: "stand", facing: 0, aim: -1, frame: 0, color: "18BEF2", tint: 1, shadow: true }));
});
