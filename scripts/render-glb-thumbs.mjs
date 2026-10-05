// Pre-render the asset chain's "3D model" thumbnails, so the chain shows each GLB before its step is opened.
//
//   npm run thumbs:glb                 # renders missing or changed thumbnails into .cache/glb-thumbs/
//   options: --art=../RTSAI-Art --blender="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
//
// Reads (never writes) RTSAI-Art/units/*/candidates/*/meta.json for generated 3D models (kind "mesh") and renders
// their web GLB with Blender's Cycles on the CPU (scripts/glb-thumb.py; no GPU). The index maps each GLB to its
// thumbnail with the GLB's size and modification time, so a changed model is re-rendered and a stale picture is
// never served (lib/art-lab/model-library-server.ts checks the stamp on every request).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const art = resolve(web, arg("art", "../RTSAI-Art"));
const blender = arg("blender", process.env.BLENDER ?? "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe");
const out = join(web, ".cache/glb-thumbs");
const indexPath = join(out, "index.json");
mkdirSync(out, { recursive: true });
const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : {};
const readJson = p => { try { return JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, "")); } catch { return null; } };
const dirs = p => { try { return readdirSync(p).filter(n => statSync(join(p, n)).isDirectory()); } catch { return []; } };

const jobs = [];
for (const actor of dirs(join(art, "units"))) {
  for (const folder of dirs(join(art, "units", actor, "candidates"))) {
    const meta = readJson(join(art, "units", actor, "candidates", folder, "meta.json"));
    if (meta?.kind !== "mesh" || !meta.files?.mesh) continue;
    const rel = `units/${actor}/candidates/${folder}/${meta.files.webMesh ?? "web.glb"}`;
    const glb = existsSync(join(art, rel)) ? rel : `units/${actor}/candidates/${folder}/${meta.files.mesh}`;
    if (!existsSync(join(art, glb))) continue;
    const s = statSync(join(art, glb));
    const stamp = `${s.size}:${Math.round(s.mtimeMs)}`;
    const name = `${actor}--${folder}.png`;
    if (index[glb]?.stamp === stamp && existsSync(join(out, index[glb].thumb))) continue;
    jobs.push({ glb: join(art, glb).replaceAll("\\", "/"), out: name, rel: glb, stamp });
  }
}
if (!jobs.length) { console.log(`GLB thumbnails: all ${Object.keys(index).length} up to date`); process.exit(0); }
if (!existsSync(blender)) throw new Error(`No Blender at ${blender}; pass --blender=<path>`);
const jobFile = join(out, "jobs.json");
writeFileSync(jobFile, JSON.stringify(jobs.map(({ glb, out: o }) => ({ glb, out: o }))));
console.log(`GLB thumbnails: rendering ${jobs.length} on the CPU…`);
const t0 = Date.now();
await new Promise((resolveRun, reject) => {
  const child = spawn(blender, ["-b", "--factory-startup", "-P", join(web, "scripts/glb-thumb.py"), "--", out, jobFile], { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", chunk => {
    for (const line of String(chunk).split(/\r?\n/)) {
      const m = /^RENDERED (.+\.png)$/.exec(line.trim());
      if (!m) continue;
      const job = jobs.find(j => j.out === m[1]);
      if (job) { index[job.rel] = { stamp: job.stamp, thumb: job.out }; writeFileSync(indexPath, JSON.stringify(index, null, 1)); }
    }
  });
  child.on("error", reject);
  child.on("close", code => (code === 0 ? resolveRun() : reject(new Error(`Blender exited ${code}`))));
});
const done = jobs.filter(j => index[j.rel]?.stamp === j.stamp).length;
console.log(`GLB thumbnails: ${done}/${jobs.length} rendered in ${Math.round((Date.now() - t0) / 1000)} s`);
