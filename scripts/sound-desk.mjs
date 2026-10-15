// The Sound desk in one command: `npm run sound-desk` starts this checkout's dev server (admin tools on, the
// /api/sound-review dev API mounted) at http://localhost:3470 and opens the Faction viewer with the desk open.
//
//   npm run sound-desk                 China's announcer and units
//   npm run sound-desk -- iran         another faction (china, iran, turkey, saudi-arabia, yemen, israel, hezbollah)
//   npm run sound-desk -- --no-open    do not open a browser
//
// Reads RTSAI-Mod (read-only) and writes decisions to RTSAI-Art/sound-review.json, both found beside this checkout
// (RTSAI-Art/RTSAI-Mod, or art/mod in a worktree trio); RTSAI_ART_DIR and RTSAI_SOUND_MOD_DIR override them. Saying a
// line again needs OpenRA-AI beside it (or RTSAI_OPENRA_AI_DIR) and a Python with kokoro, chatterbox-tts and
// faster-whisper (RTSAI_VOICE_PYTHON; default: the local Chatterbox service's venv). Apply the decisions to the mod with
// RTSAI-Mod's tools/apply-sound-decisions.py.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.RTSAI_SOUND_DESK_PORT ?? 3470);
const args = process.argv.slice(2);
const faction = args.find(a => !a.startsWith("-")) ?? "china";
const url = `http://localhost:${port}/viewer/${faction}?desk=1`;

const free = await new Promise(ok => { const s = createServer().once("error", () => ok(false)).once("listening", () => s.close(() => ok(true))).listen(port, "127.0.0.1"); });
if (!free) {
  console.log(`Port ${port} is busy: if the Sound desk already runs there, open ${url}`);
  process.exit(1);
}
const near = (...names) => names.map(n => resolve(root, n)).find(existsSync) ?? "(not found)";
console.log(`Sound desk: ${url}\n  decisions  ${process.env.RTSAI_ART_DIR ?? near("../RTSAI-Art", "../art")}\\sound-review.json\n  mod        ${process.env.RTSAI_SOUND_MOD_DIR ?? near("../RTSAI-Mod", "../mod")} (read-only)\n  The first page compiles for about 15 s.`);

const vinext = resolve(root, "node_modules", "vinext", "dist", "cli.js");
const dev = spawn(process.execPath, [vinext, "dev", "--port", String(port)], { cwd: root, stdio: "inherit", env: { ...process.env, RTSAI_ADMIN: "1" } });
const stop = () => { if (!dev.killed) dev.kill(); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
dev.on("exit", code => process.exit(code ?? 0));

if (!args.includes("--no-open")) {
  // Open once the viewer answers (the first request compiles it).
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 1500));
    try { if ((await fetch(url, { signal: AbortSignal.timeout(60_000) })).ok) break; } catch { /* still starting */ }
  }
  const opener = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(opener[0], opener[1], { stdio: "ignore", detached: true }).unref();
}
