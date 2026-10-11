import assert from "node:assert/strict";
import test from "node:test";
import { standalonePackagePath } from "../scripts/standalone-facts";
import { loadModData, type ModData } from "../lib/art-lab/resolve";
import { actorSounds, type AudioData } from "../lib/art-lab/sounds";
import { parseMiniYaml } from "../lib/art-lab/miniyaml";

const yaml = (text: string) => parseMiniYaml(text, "fixture")[0].value;

test("standalone manifests use bounded profile aliases without changing historical package resolution", () => {
  assert.equal(standalonePackagePath("classic|mode.ftl").path, "mods/rtsai-topdown/mode.ftl");
  assert.equal(standalonePackagePath("rtsai-topdown|mode.ftl").path, "mods/rtsai-topdown/mode.ftl");
  assert.equal(standalonePackagePath("rtsai|rules/world.yaml").path, "mods/rtsai/rules/world.yaml");
  assert.equal(standalonePackagePath("ra2|rules/world.yaml").path, "mods/rtsai/rules/world.yaml");
  for (const reference of ["ra|rules/world.yaml", "ra2|../private", "ra2|/private", "ra2|rules\\world.yaml", "bare.yaml"]) assert.throws(() => standalonePackagePath(reference));
  const files = new Map([["mods/rtsai-topdown/mod.yaml", "Rules:\n\trtsai|rules/world.yaml\nFluentMessages:\n\tclassic|mode.ftl\n"], ["mods/rtsai/rules/world.yaml", "World:\n\tFaction@x:\n\t\tInternalName: x\n"], ["mods/rtsai-topdown/mode.ftl", "fixture-title = Classic fixture\n"]]);
  const data = loadModData({ text: path => files.get(path)!, bytes: () => new Uint8Array(), exists: path => files.has(path) }, { manifestPath: "mods/rtsai-topdown/mod.yaml", resolvePackage: standalonePackagePath });
  assert.ok(data.rules.has("world")); assert.equal(data.messages.get("fixture-title"), "Classic fixture");
});

test("RTSAIVoiced preserves the base family and exposes explicit language selection with pending human review", () => {
  const actor = yaml("actor:\n\tRTSAIVoiced:\n\t\tVoiceSet: Family\n\tDeathSounds:\n\t\tVoice: Die\n");
  const data = { rules: new Map([["actor", actor]]) } as ModData;
  const voice = (clip: string) => yaml(`voice:\n\tVoices:\n\t\tSelect: ra2|modern-factions/audio/${clip}\n\t\tDie: inherited\n`);
  const audio: AudioData = { voices: new Map([["family", voice("base")], ["family__faction", voice("native")], ["family__en", voice("english")]]), notifications: new Map(), music: [] };
  const base = actorSounds(data, audio, "actor", "china");
  assert.equal(base.voiceSet, "Family"); assert.ok(base.groups.some(group => group.kind === "voice"));
  assert.equal(base.voiceOptions?.review, "human-listening-pending");
  assert.equal(actorSounds(data, audio, "actor", "china", "en").voiceSet, "family__en");
  assert.match(actorSounds(data, audio, "actor", "china", "faction").groups[0].files[0].file, /native/);
  audio.voices.delete("family__en"); assert.equal(actorSounds(data, audio, "actor", "china", "en").voiceSet, "Family");
  data.rules.set("actor", yaml("actor:\n\tVoiced:\n\t\tVoiceSet: Family\n"));
  const legacy = actorSounds(data, audio, "actor", "china"); assert.equal(legacy.voiceSet, "Family"); assert.equal(legacy.voiceOptions, undefined);
});
