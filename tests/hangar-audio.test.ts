import assert from "node:assert/strict";
import test from "node:test";
import { validHangarPreview } from "../lib/hangar-audio";
const id = "12345678-1234-1234-1234-123456789012";
const preview = { revision: id, actor: "r2m1a2s", faction: "saudi-arabia", event: "main-gun", name: "Tank candidate", loop: false, url: `http://127.0.0.1:8003/api/audio-lab/asset/${id}.wav` };
test("only the exact local revision bound to the selected actor can override viewer sounds", () => {
  assert.equal(validHangarPreview(preview, id, "r2m1a2s", "saudi-arabia", "8003"), true);
  for (const patch of [{ actor: "other-unit" }, { revision: "other" }, { faction: "china" }, { event: "unknown" }, { url: `https://attacker.example/api/audio-lab/asset/${id}.wav` }, { url: "http://127.0.0.1:8003/api/other" }, { url: `http://user:password@127.0.0.1:8003/api/audio-lab/asset/${id}.wav` }]) assert.equal(validHangarPreview({ ...preview, ...patch }, id, "r2m1a2s", "saudi-arabia", "8003"), false);
});
