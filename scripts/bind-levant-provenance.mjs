// Bind the Israel and Lebanon art that RTSAI-Mod references but its ART-PROVENANCE.json does not record.
//
//   node --import tsx scripts/bind-levant-provenance.mjs            # write data/levant-art-binding.json
//   node --import tsx scripts/bind-levant-provenance.mjs --check    # fail if the binding is stale
//   options: --mod=../RTSAI-Mod --product=../OpenRA-AI --python=<python with Pillow>
//
// The Levant packs were built by OpenRA-AI scripts/build-levant-art.py (CPU geometry, no image or game-data
// input). The mod keeps that generator's own record, modern-factions/levant-art-provenance.json, which hashes
// every SHP and VXL it wrote, but not the HVA transforms, palettes or build-menu cameos, and the public
// ART-PROVENANCE.json does not cover the packs at all. This script binds each file with one of two kinds of
// evidence, and leaves anything else unbound so the publication guard keeps refusing it:
//
//   generator-record  the mod file's SHA-256 equals the hash the generator recorded when it wrote the file
//                     (re-verified live by sync-mod-art.mjs on every sync);
//   reproduced        the generator, re-run from the pinned OpenRA-AI commit in a temporary sandbox with the
//                     same CPU inputs, writes a byte-identical file;
//   copy-of-recorded  the bytes equal a file of the same type that ART-PROVENANCE.json already records
//                     (build-levant-factions.py copies source-faction packages under new names); the entry
//                     inherits that record and is re-verified on every sync.
//
// It never writes into RTSAI-Mod, OpenRA, OpenRA-AI or RTSAI-Art: the builder runs in a temp directory.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ART_DIR, loadModData, resolveArtLab } from "../lib/art-lab/resolve.ts";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const modRoot = resolve(web, arg("mod", "../RTSAI-Mod"));
const product = resolve(web, arg("product", "../OpenRA-AI"));
const classicRoot = resolve(web, arg("classic", "../OpenRA"));
const python = resolve(web, arg("python", "../OpenRA-AI/.venv/Scripts/python.exe"));
const check = process.argv.includes("--check");
const output = join(web, "data/levant-art-binding.json");

const GENERATOR_COMMIT = "18eb108"; // OpenRA-AI: "Catalog and author Israel and Lebanon faction packs ..."
const GENERATOR_SCRIPT = "scripts/build-levant-art.py";
const LEVANT_RECORD = `${ART_DIR}/levant-art-provenance.json`;

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const reader = {
  text: p => readFileSync(join(modRoot, p), "utf8"),
  bytes: p => new Uint8Array(readFileSync(join(modRoot, p))),
  exists: p => existsSync(join(modRoot, p)),
};

const record = JSON.parse(reader.text(`${ART_DIR}/ART-PROVENANCE.json`));
const levant = JSON.parse(reader.text(LEVANT_RECORD));
const resolution = resolveArtLab(reader, loadModData(reader));
const unbound = [...resolution.files.keys()].filter(key => !record.files[key]).sort();

const typeOf = key => {
  if (key.endsWith(".shp")) return "SHP sprite (infantry 713 frames, 50x39; defence/structure 42 frames, 96x96)";
  if (key.endsWith(".vxl")) return "RA2 voxel model";
  if (key.endsWith(".hva")) return "RA2 voxel animation/transform (HVA)";
  if (key.endsWith("-voxels.pal")) return "voxel palette";
  if (key.endsWith(".pal")) return "palette";
  if (key.startsWith("icons/") && key.endsWith(".png")) return "build-palette cameo, 60x48 RGB PNG rendered from the authored geometry";
  return null;
};
const originOf = key => (key.endsWith(".pal") ? "procedural" : "rendered-from-project-geometry");
// The generator's record hashes the bytes of each SHP and VXL it wrote, keyed by the file's base name.
const recordedHash = key => {
  const name = key.split("/").pop().replace(/\.(shp|vxl)$/, "");
  if (name === key.split("/").pop()) return null;
  const entry = levant.actors?.[name];
  const format = key.endsWith(".shp") ? "SHP" : "VXL/HVA";
  return entry && entry.format === format ? entry.sha256 : null;
};

function reproduce() {
  if (!existsSync(python)) throw new Error(`No Python at ${python}; pass --python=<python with Pillow>`);
  const sandbox = mkdtempSync(join(tmpdir(), "levant-repro-"));
  try {
    // The builder resolves ROOT as the parent of OpenRA-AI, so the sandbox mirrors the workspace layout.
    const scripts = join(sandbox, "OpenRA-AI");
    mkdirSync(scripts, { recursive: true });
    // Read-only export of the pinned builder: no checkout, index or work-tree change in OpenRA-AI.
    for (const path of git(product, "ls-tree", "-r", "--name-only", GENERATOR_COMMIT, "scripts").split(/\r?\n/).filter(p => p.endsWith(".py"))) {
      mkdirSync(dirname(join(scripts, path)), { recursive: true });
      writeFileSync(join(scripts, path), execFileSync("git", ["-C", product, "show", `${GENERATOR_COMMIT}:${path}`], { maxBuffer: 64 << 20 }));
    }
    const inputs = [
      [join(modRoot, "engine/OpenRA.Mods.Cnc/Traits/World/VoxelNormalsPalette.cs"), "RTSAI-Mod/engine/OpenRA.Mods.Cnc/Traits/World/VoxelNormalsPalette.cs"],
      [join(classicRoot, "mods/common/FreeSansBold.ttf"), "OpenRA/mods/common/FreeSansBold.ttf"],
      ...["israel", "lebanon", "levant-common"].map(name => [join(classicRoot, `mods/ra/rules/${name}.yaml`), `OpenRA/mods/ra/rules/${name}.yaml`]),
    ];
    for (const [from, to] of inputs) { mkdirSync(dirname(join(sandbox, to)), { recursive: true }); copyFileSync(from, join(sandbox, to)); }
    for (const dir of ["RTSAI-Mod/mods/rtsai/modern-factions/icons", "RTSAI-Mod/mods/rtsai/modern-factions/voxels", "RTSAI-Mod/mods/rtsai/modern-factions/israel-art",
      "RTSAI-Mod/mods/rtsai/modern-factions/lebanon-art", "OpenRA/mods/ra/sequences", "OpenRA/mods/ra/bits/levant", "OpenRA/mods/ra/uibits", "RTSAI-Art/rebuild"]) mkdirSync(join(sandbox, dir), { recursive: true });
    const runner = "import runpy,sys,PIL;sys.path.insert(0,'.');g=runpy.run_path('build-levant-art.py');g['main']();print('PIL',PIL.__version__,'python',sys.version.split()[0])";
    const log = execFileSync(python, ["-c", runner], { cwd: join(scripts, "scripts"), encoding: "utf8" });
    const versions = log.trim().split(/\r?\n/).pop();
    const hashes = new Map();
    for (const key of unbound) {
      const file = join(sandbox, "RTSAI-Mod", ART_DIR, key);
      if (existsSync(file)) hashes.set(key, sha256(readFileSync(file)));
    }
    return { hashes, versions };
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

const generatorCommit = git(product, "rev-parse", GENERATOR_COMMIT);
const { hashes: reproduced, versions } = reproduce();
const files = {};
const refused = [];
for (const key of unbound) {
  const actual = sha256(reader.bytes(`${ART_DIR}/${key}`));
  const type = typeOf(key);
  const recorded = recordedHash(key);
  const evidence = recorded === actual ? "generator-record" : reproduced.get(key) === actual ? "reproduced" : null;
  if (!evidence) {
    const twins = Object.keys(record.files).sort().filter(k => record.files[k].sha256 === actual && typeOf(k) === type && !k.includes("#"));
    // Many identity HVAs are byte-equal; name the one that belongs to the same copied model when it exists.
    const modelTwin = key.endsWith(".hva") ? Object.keys(record.files).find(k => k.endsWith(".vxl") && record.files[k].sha256 === sha256(reader.bytes(`${ART_DIR}/${key.replace(/\.hva$/, ".vxl")}`))) : null;
    const twin = twins.find(k => modelTwin && k === modelTwin.replace(/\.vxl$/, ".hva")) ?? twins[0];
    if (type && twin) {
      // Inherit the recorded entry except its own hash and its "referenced by rules" runtime note.
      const inherited = Object.fromEntries(Object.entries(record.files[twin]).filter(([k]) => k !== "sha256" && k !== "runtime"));
      files[key] = { ...inherited, sha256: actual, evidence: "copy-of-recorded", copiedFrom: twin, copiedBy: "OpenRA-AI scripts/build-levant-factions.py (copies source-faction packages under the new actor name)", reproduced: false };
      continue;
    }
  }
  if (!type || !evidence) { refused.push(`${key}: ${!type ? "not a Levant art type" : "not recorded by the generator, not reproduced byte-identically and not a copy of a recorded file"}`); continue; }
  files[key] = {
    sha256: actual, type, origin: originOf(key), generator: "project-geometry",
    source: { repo: "OpenRA-AI (local)", path: GENERATOR_SCRIPT, commit: generatorCommit },
    script: `${GENERATOR_SCRIPT} (build)`,
    evidence,
    reproduced: reproduced.get(key) === actual,
  };
}

const binding = {
  schemaVersion: 1,
  generatedBy: "scripts/bind-levant-provenance.mjs",
  scope: "Israel and Lebanon art files referenced by RTSAI-Mod rules or sequences but absent from modern-factions/ART-PROVENANCE.json.",
  generator: {
    repo: "OpenRA-AI (local; commit not on origin when bound)", commit: generatorCommit, script: GENERATOR_SCRIPT,
    kind: "project-geometry: CPU renders and exports of meshes defined in Python. Inputs: project code, project material colours, OpenRA's GPL-3.0 voxel normal table (format data) and the GPL-2.0 FreeSans font used only for Classic icons. No image, SHP, VXL, HVA, PAL or MIX input.",
  },
  mod: { repo: "alibad/RTSAI-Mod", commit: git(modRoot, "rev-parse", "HEAD"), levantRecordSha256: sha256(reader.text(LEVANT_RECORD).replace(/\r\n/g, "\n")) },
  method: {
    "generator-record": "SHA-256 of the mod file equals the hash build-levant-art.py stored in levant-art-provenance.json when it wrote the file. Re-checked on every sync.",
    reproduced: `build-levant-art.py at ${generatorCommit.slice(0, 7)}, re-run in a temporary sandbox (${versions}), wrote a byte-identical file.`,
    "copy-of-recorded": "Bytes equal a same-type file already recorded in ART-PROVENANCE.json; the entry inherits that record. Re-checked on every sync.",
  },
  summary: {
    files: Object.keys(files).length,
    generatorRecord: Object.values(files).filter(f => f.evidence === "generator-record").length,
    reproducedOnly: Object.values(files).filter(f => f.evidence === "reproduced").length,
    copyOfRecorded: Object.values(files).filter(f => f.evidence === "copy-of-recorded").length,
    recordedButNotReproduced: Object.entries(files).filter(([, f]) => f.evidence === "generator-record" && !f.reproduced).map(([key]) => key),
    unbound: refused,
  },
  files,
};
const text = JSON.stringify(binding, null, 1) + "\n";
if (check) {
  const current = existsSync(output) ? JSON.parse(readFileSync(output, "utf8")) : null;
  const same = current && JSON.stringify(current.files) === JSON.stringify(files) && current.mod.commit === binding.mod.commit;
  if (!same) throw new Error("data/levant-art-binding.json is stale; run node --import tsx scripts/bind-levant-provenance.mjs");
} else writeFileSync(output, text);
console.log(`Levant binding: ${binding.summary.files}/${unbound.length} files bound (${binding.summary.generatorRecord} by the generator's record, ${binding.summary.reproducedOnly} by reproduction, ${binding.summary.copyOfRecorded} as copies of recorded files); ${refused.length} left unbound`);
if (refused.length) console.log(`- ${refused.join("\n- ")}`);
