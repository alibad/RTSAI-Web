import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { boundedPath, sha256, verifyFrozenInput } from "./frozen-inputs.mjs";

const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const mod = arg("mod"), identity = arg("mod-identity");
if (!mod || !identity) throw new Error("Provide a frozen --mod and --mod-identity");
verifyFrozenInput(mod, identity);
const web = resolve("."), art = JSON.parse(readFileSync(join(web, "data/art-lab.json"), "utf8")), audio = JSON.parse(readFileSync(join(web, "data/faction-audio.json"), "utf8")), images = JSON.parse(readFileSync(join(web, "data/faction-art-provenance.json"), "utf8"));
let artFiles = 0, clips = 0, imageFiles = 0, wavFiles = 0;
for (const [key, record] of Object.entries(art.files)) {
  const source = boundedPath(mod, `mods/rtsai/modern-factions/${key}`), published = boundedPath(web, `public/art-lab/${key}`);
  if (sha256(readFileSync(source)) !== record.sha256 || sha256(readFileSync(published)) !== record.sha256) throw new Error(`Preserved art changed: ${key}`);
  artFiles++;
}
for (const [key, record] of Object.entries(audio.clips)) {
  if (sha256(readFileSync(boundedPath(mod, key))) !== record.sourceSha256) throw new Error(`Published audio source changed: ${key}`);
  if (!/^\/faction-audio\/[\w.-]+\.[a-f0-9]{12}\.mp3$/.test(record.src)) throw new Error(`Invalid audio output path: ${key}`);
  const bytes = readFileSync(boundedPath(web, `public${record.src}`)), digest = record.src.match(/\.([a-f0-9]{12})\.mp3$/)[1];
  if (sha256(bytes).slice(0, 12) !== digest) throw new Error(`Published MP3 changed: ${key}`);
  clips++;
}
for (const record of images.files) {
  if (sha256(readFileSync(boundedPath(web, record.path))) !== record.sha256) throw new Error(`Published image changed: ${record.path}`);
  imageFiles++;
}
const manifest = JSON.parse(readFileSync(join(mod, "INPUTS.json"), "utf8"));
for (const record of manifest.files.filter(record => record.path.endsWith(".wav") && record.path.startsWith("mods/rtsai/"))) {
  const bytes = readFileSync(boundedPath(mod, record.path));
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") throw new Error(`Invalid WAV: ${record.path}`);
  wavFiles++;
}
console.log(JSON.stringify({ status: "preserved-byte-integrity-pass", modIdentity: identity, artFiles, publishedClips: clips, imageFiles, wavHeaders: wavFiles, scope: "Existing approved media byte integrity and project WAV headers; no perceptual listening, human approval or new export parity claim" }));
