// Runs scripts/export-faction-art.py with a Python that has numpy and Pillow (webp + avif):
// RTSAI_PYTHON when set, else the companion's virtual environment (../RTSAI-Mod/companion/.venv), else `python`.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const venv = ["Scripts/python.exe", "bin/python"].map(p => join(web, "..", "RTSAI-Mod", "companion", ".venv", p)).find(existsSync);
const python = process.env.RTSAI_PYTHON ?? venv ?? "python";
const result = spawnSync(python, ["-u", join(web, "scripts", "export-faction-art.py"), ...process.argv.slice(2)], { cwd: web, stdio: "inherit" });
process.exit(result.status ?? 1);
