import assert from "node:assert/strict";
import test from "node:test";
import { factionNarrative } from "../lib/faction-narrative";
import { factionById, factions } from "../lib/game-content";

test("narrative sections stay hidden until the catalog has the texts", () => {
  for (const faction of factions) {
    const raw = faction as unknown as Record<string, unknown>;
    if (!raw.identity && !raw.rivalViews) assert.equal(factionNarrative(faction), null, faction.id);
  }
  assert.equal(factionNarrative(undefined), null);
});

test("identity and rival views read the catalog shape; voice ideas and unknown rivals are dropped", () => {
  const base = factionById("hezbollah")!;
  const sample = { ...base,
    identity: { motto: "Hold the ridge.", story: "First line.\n\nSecond line.", keywords: ["One", "Two", " "] },
    rivalViews: [{ rival: "israel", kind: "propaganda", text: "A view." }, { rival: "nowhere", kind: "grievance", text: "Dropped." }, { rival: "hezbollah", kind: "grievance", text: "Not its own rival." }],
    flavour: { voiceIdeas: ["Not for the website"] } };
  const n = factionNarrative(sample as unknown as typeof base)!;
  assert.deepEqual(n.identity, { motto: "Hold the ridge.", story: ["First line.", "Second line."], keywords: ["One", "Two"] });
  assert.deepEqual(n.rivalViews.map(v => [v.rival.id, v.kind, v.text]), [["israel", "propaganda", ["A view."]]]);
  assert.doesNotMatch(JSON.stringify(n), /Not for the website/);
});
