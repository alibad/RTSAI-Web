import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";

export const sha256 = value => createHash("sha256").update(value).digest("hex");
// Windows has no executable bit. Python's os.stat, which wrote the manifest (RTSAI-Mod tools/build-inputs.py), reports
// one for .exe/.bat/.cmd/.com files and Node's for none, so on Windows read it the way Python does.
const executable = (path, stat) => process.platform === "win32" ? /\.(exe|bat|cmd|com)$/i.test(path) : Boolean(stat.mode & 0o111);
export function boundedPath(root, relative) {
  if (typeof relative !== "string" || relative.includes("\\") || relative.startsWith("/") || relative.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Invalid relative input path");
  const base = resolve(root), path = resolve(base, relative);
  if (!path.startsWith(base + sep)) throw new Error("Input path escapes root");
  let current = base;
  for (const part of relative.split("/")) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error("Input symlink refused");
  }
  return path;
}
export function verifyFrozenInput(root, expected) {
  const manifest = JSON.parse(readFileSync(join(root, "INPUTS.json"), "utf8"));
  if (!/^[a-f0-9]{64}$/.test(expected) || manifest.sourceSha256 !== expected) throw new Error("Frozen identity mismatch");
  const normalized = manifest.files.map(record => ({ executable: record.executable, path: record.path, sha256: record.sha256, size: record.size }));
  if (sha256(JSON.stringify(normalized)) !== expected) throw new Error("Frozen manifest identity mismatch");
  const expectedPaths = new Set(manifest.files.map(record => record.path));
  if (expectedPaths.size !== manifest.files.length) throw new Error("Duplicate frozen paths");
  const visit = relative => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error("Frozen input symlink refused");
      if (entry.isDirectory()) visit(name);
      else if (name !== "INPUTS.json" && !expectedPaths.has(name)) throw new Error(`Unexpected frozen file: ${name}`);
    }
  };
  visit("");
  for (const record of manifest.files) {
    const path = boundedPath(root, record.path), stat = lstatSync(path), bytes = readFileSync(path);
    if (!stat.isFile() || stat.size !== record.size || executable(record.path, stat) !== record.executable || sha256(bytes) !== record.sha256) throw new Error(`Frozen file changed: ${record.path}`);
  }
  return manifest;
}
