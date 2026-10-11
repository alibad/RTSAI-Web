import assert from "node:assert/strict";
import test from "node:test";
import { installGameMeasurement, normalizeWorldStart } from "../scripts/integration/game-measurement.mjs";

test("game-document adapter counts accepted starts, with separate peer starts and no network", () => {
  const target = new EventTarget(), calls = [];
  const stop = installGameMeasurement(target, (...args) => calls.push(args));
  const send = detail => { const event = new Event("rtsai:world-started"); Object.defineProperty(event, "detail", { value: detail }); target.dispatchEvent(event); };
  target.dispatchEvent(new Event("setup"));
  assert.deepEqual(calls, []);
  for (const transport of ["singleplayer", "direct", "room"]) send({ version: 1, event: "world-started", mode: "classic", transport });
  assert.equal(calls.filter(([name]) => name === "game_world_started").length, 3);
  assert.equal(calls.filter(([name]) => name === "game_peer_started").length, 2);
  assert.deepEqual(calls[0], ["game_world_started", { version: 1, mode: "classic", transport: "singleplayer" }]);
  stop(); send({ version: 1, event: "world-started", mode: "isometric", transport: "room" });
  assert.equal(calls.length, 5);
});

test("unversioned, malformed, ID-bearing and free-text receipts never reach a sink", () => {
  const valid = { version: 1, event: "world-started", mode: "isometric", transport: "direct" };
  for (const value of [null, [], {}, { ...valid, version: 2 }, { ...valid, event: "setup" }, { ...valid, mode: "ra" }, { ...valid, transport: "unknown" }, { ...valid, peer_id: "private" }, { ...valid, question: "free text" }, { ...valid, url: "https://example.com" }]) assert.equal(normalizeWorldStart(value), null);
  assert.deepEqual(normalizeWorldStart(valid), { version: 1, mode: "isometric", transport: "direct" });
});

test("bootstrap installs inside the game document and uses only an explicit bounded sink", async () => {
  const { bootstrapGameMeasurement } = await import("../scripts/integration/game-measurement-bootstrap.mjs");
  const target = new EventTarget(), calls = [];
  target.rtsaiMeasurementSink = (...args) => calls.push(args);
  const stop = bootstrapGameMeasurement(target);
  const event = new Event("rtsai:world-started");
  Object.defineProperty(event, "detail", { value: { version: 1, event: "world-started", mode: "classic", transport: "room" } });
  target.dispatchEvent(event); stop();
  assert.deepEqual(calls.map(([name]) => name), ["game_world_started", "game_peer_started"]);
  assert.deepEqual(Object.keys(calls[0][1]).sort(), ["mode", "transport", "version"]);
});
