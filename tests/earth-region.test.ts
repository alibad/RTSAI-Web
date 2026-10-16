import assert from "node:assert/strict";
import test from "node:test";
import { compileBattlefield } from "../lib/earth-battlefield";
import { regionalGeography } from "../lib/earth-region";
import { terrainQuery } from "../lib/earth-evidence";
import terrain from "../data/earth-terrain.json";

const request = { latitude: 26.6, longitude: 56.4, radius: 60000, size: 80 as const, players: 2 as const, seed: 42, title: "Hormuz region", preserveCoast: true };

test("real Hormuz coastlines compile with no live mapping response, preserving open sea and two land starts", async () => {
  const features = regionalGeography(request.latitude, request.longitude, request.radius)!;
  assert.ok(features.length > 3);
  const map = await compileBattlefield(request, features);
  const view = new DataView(map.bin.buffer);
  const typeAt = (lat: number, lon: number) => {
    const u = Math.floor(((lon - request.longitude) * 111320 * Math.cos(request.latitude * Math.PI / 180) / 120000 + .5) * 80);
    const v = Math.floor(((request.latitude - lat) * 111320 / 120000 + .5) * 160);
    const id = view.getUint16(17 + (u * 160 + v) * 3, true);
    return (terrain.templates as Record<string, string[]>)[id][0];
  };
  assert.equal(typeAt(26.6, 56.4), "Water", "open strait is not replaced by a land corridor");
  assert.equal(typeAt(26.12, 56.28), "Clear", "Musandam stays land");
  assert.equal(typeAt(26.8, 56.0), "Clear", "Qeshm stays land");
  assert.equal(typeAt(26.6, 56.995), "Water", "no fabricated land border along the sea");
  assert.equal(map.yaml.match(/: mpspawn\n/g)?.length, 2);
  assert.equal(map.report.validation.connectedBases, false, "separate coasts are reported honestly");
  assert.match(map.report.attribution, /Natural Earth/);
  assert.ok(map.report.validation.homeMines > 0);
});

test("an offshore small selection suggests moving or enlarging instead of inventing land", async () => {
  await assert.rejects(compileBattlefield({ ...request, radius: 1500 }, regionalGeography(26.6, 56.4, 1500)!), /too little usable land.*Move the area/);
  assert.equal(regionalGeography(48, 8, 60000), null, "regional coverage is explicit");
});

test("regional queries omit buildings and minor roads to bound the response", () => {
  const query = terrainQuery(26.6, 56.4, 60000);
  assert.match(query, /coastline/);
  assert.doesNotMatch(query, /building|residential/);
});
