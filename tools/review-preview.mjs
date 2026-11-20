#!/usr/bin/env node
// The Review inbox on this PC, before or without the website being released: the real page and the real
// firestore.rules against the local Firebase emulators, with the clip files served from a folder. Also the rig of
// tools/review-inbox-browser-test.mjs. What the owner answers here is kept in <data>/firestore (saved every minute
// and on exit) and read with `node tools/review.mjs feedback --emulator`.
//
//   node tools/review-preview.mjs --data <folder> [--port 3472] [--clips-port 3473]
//
// Needs Java (the emulators) and the firebase CLI. Stop it with Ctrl+C.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const data = path.resolve(opt("data") ?? (console.error("usage: node tools/review-preview.mjs --data <folder>"), process.exit(1)));
const port = Number(opt("port", 3472)), clipsPort = Number(opt("clips-port", 3473));
const project = "demo-rtsai", store = path.join(data, "firestore"), clips = path.join(data, "clips");
fs.mkdirSync(clips, { recursive: true });
const log = (...a) => console.log(`[review-preview ${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = async (url) => { try { await fetch(url); return true; } catch { return false; } };
const children = [];
function run(name, command, env = {}) {
  const child = spawn(command, { cwd: repo, shell: true, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const out = fs.createWriteStream(path.join(data, `${name}.log`));
  child.stdout.pipe(out); child.stderr.pipe(out);
  child.on("exit", (code) => log(`${name} stopped (${code})`));
  children.push(child);
  return child;
}

// ---- the clip files: a plain static host with byte ranges (video seeking)
const MIME = { ".mp4": "video/mp4", ".webm": "video/webm", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml" };
http.createServer((req, res) => {
  const file = path.join(clips, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(clips) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
  const size = fs.statSync(file).size, range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  const head = { "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream", "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache" };
  if (range) {
    const start = range[1] ? Number(range[1]) : size - Number(range[2]), end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
    res.writeHead(206, { ...head, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else { res.writeHead(200, { ...head, "Content-Length": size }); fs.createReadStream(file).pipe(res); }
}).listen(clipsPort, "127.0.0.1");

// ---- the emulators, with what was saved last time
if (await up("http://127.0.0.1:8085/")) log("emulators already running: using them (their data is not saved by this run)");
else {
  run("emulators", `firebase emulators:start --only auth,firestore --project ${project}${fs.existsSync(store) ? ` --import "${store}"` : ""} --export-on-exit "${store}"`);
  for (let i = 0; i < 90 && !(await up("http://127.0.0.1:8085/") && await up("http://127.0.0.1:9099/")); i++) await sleep(1000);
  if (!await up("http://127.0.0.1:8085/")) { log("the emulators did not start: see", path.join(data, "emulators.log")); process.exit(1); }
  setInterval(() => void fetch(`http://127.0.0.1:4400/emulator/v1/projects/${project}:export`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: store, initiatedBy: "review-preview" }) }).catch(() => {}), 60000);
}

// ---- the owner's account in the Auth emulator: the email the rules and lib/admin.ts name, verified
const owner = /OWNER_EMAILS = \["([^"]+)"\]/.exec(fs.readFileSync(path.join(repo, "lib/admin.ts"), "utf8"))[1];
const auth = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const signUp = await (await fetch(`${auth}/accounts:signUp?key=demo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: owner, password: "review-preview", returnSecureToken: true }) })).json();
const localId = signUp.localId ?? (await (await fetch(`${auth}/accounts:signInWithPassword?key=demo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: owner, password: "review-preview", returnSecureToken: true }) })).json()).localId;
await fetch(`${auth}/projects/${project}/accounts:update`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer owner" }, body: JSON.stringify({ localId, emailVerified: true }) });

// ---- the website's own page, pointed at the emulators
run("site", `npx vinext dev -p ${port} -H 127.0.0.1`, {
  NEXT_PUBLIC_FIREBASE_EMULATORS: "1", NEXT_PUBLIC_FIREBASE_PROJECT_ID: project, NEXT_PUBLIC_FIREBASE_API_KEY: "demo",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${project}.firebaseapp.com`, NEXT_PUBLIC_FIREBASE_APP_ID: "demo", NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: "",
});
for (let i = 0; i < 120 && !await up(`http://127.0.0.1:${port}/admin/review`); i++) await sleep(1000);

log(`Review inbox:  http://127.0.0.1:${port}/admin/review`);
log(`Add clips:     node tools/review.mjs add <folder> --emulator --serve-dir "${clips}" --serve-url http://127.0.0.1:${clipsPort}`);
log(`Read answers:  node tools/review.mjs feedback --emulator`);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  log("saving and stopping");
  await fetch(`http://127.0.0.1:4400/emulator/v1/projects/${project}:export`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: store, initiatedBy: "review-preview" }) }).catch(() => {});
  for (const child of children) { try { if (process.platform === "win32") execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" }); else child.kill("SIGINT"); } catch { /* already gone */ } }
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
