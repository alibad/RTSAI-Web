#!/usr/bin/env node
// The Review inbox from a session's side (docs/review-inbox.md): add clips for the owner, read what the owner
// answered, fetch a voice note, and send a fixed clip back to be checked again.
//
//   node tools/review.mjs add <folder>                        the clips named by <folder>/clips.json
//   node tools/review.mjs feedback [--front battles] [--json] open notes with each clip's facts, time, transcript
//   node tools/review.mjs audio <clip> <note> [--out <file>]  a voice note's audio
//   node tools/review.mjs transcript <clip> <note> --text ".." store a transcript made locally (Whisper)
//   node tools/review.mjs fixed <clip> --reply "what changed" [--in <commit or build>] [--video <file>] [--poster <file>] [--note <id>]...
//   node tools/review.mjs status [--front battles] [--json]   every clip and the owner's answer
//   node tools/review.mjs remove <clip>...                    take clips out of the inbox, with their notes (a broken recording)
//
// Where it talks to:
//   default        the rtsai-net Firestore, as the signed-in gcloud account (`gcloud auth print-access-token`); clip
//                  files go to the Cloudflare Pages project in REVIEW_PAGES_PROJECT (default rtsai-review). Writing
//                  there is refused until the owner has released the inbox (its Firestore rule is deployed).
//   --emulator     the local Firebase emulators (`firebase emulators:start --only auth,firestore --project demo-rtsai`);
//                  clip files are copied to --serve-dir and named by --serve-url (tools/review-preview.mjs serves them)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const verb = argv[0];
const flag = (k) => argv.includes(`--${k}`);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const opts = (k) => argv.flatMap((a, i) => (a === `--${k}` ? [argv[i + 1]] : []));
const VALUE_FLAGS = new Set(["front", "out", "text", "reply", "in", "video", "poster", "note", "serve-dir", "serve-url", "by"]);
const positional = argv.slice(1).filter((a, i, all) => !a.startsWith("--") && !(all[i - 1]?.startsWith("--") && VALUE_FLAGS.has(all[i - 1].slice(2))));
const die = (message) => { console.error(message); process.exit(1); };

const emulator = flag("emulator") || process.env.REVIEW_EMULATOR === "1";
const project = emulator ? "demo-rtsai" : "rtsai-net";
const root = `projects/${project}/databases/(default)/documents`;
const api = `${emulator ? "http://127.0.0.1:8085" : "https://firestore.googleapis.com"}/v1/${root}`;
let token = null;
function headers() {
  if (emulator) return { Authorization: "Bearer owner", "Content-Type": "application/json" };
  token ??= execSync("gcloud auth print-access-token", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  return { Authorization: `Bearer ${token}`, "x-goog-user-project": project, "Content-Type": "application/json" };
}
async function call(method, url, body) {
  const response = await fetch(url.startsWith("http") ? url : `${api}${url}`, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
  const json = await response.json().catch(() => ({}));
  if (!response.ok && !(method === "GET" && response.status === 404)) die(`Firestore ${method} ${url}: ${response.status} ${JSON.stringify(json).slice(0, 400)}`);
  return response.status === 404 ? null : json;
}

/**
 * Nothing is written to production before the owner releases the inbox. The sign that it is released is its rule:
 * the deployed Firestore rules name reviewClips. Until then clips go to the preview (--emulator). Reading is allowed.
 */
async function requireReleased() {
  if (emulator) return;
  const rules = "https://firebaserules.googleapis.com/v1";
  let released = false, why = "";
  try {
    const release = await (await fetch(`${rules}/projects/${project}/releases/cloud.firestore`, { headers: headers() })).json();
    const ruleset = release.rulesetName ? await (await fetch(`${rules}/${release.rulesetName}`, { headers: headers() })).json() : null;
    released = !!ruleset?.source?.files?.some((f) => f.content.includes("match /reviewClips/"));
    if (!ruleset) why = ` (the deployed rules could not be read: ${JSON.stringify(release).slice(0, 160)})`;
  } catch (e) { why = ` (the deployed rules could not be read: ${String(e).slice(0, 160)})`; }
  if (!released) die(`The Review inbox is not released yet${why}: nothing is written to production, or uploaded, before the owner says go.\nPut your clips in the preview instead: add --emulator to the same command (docs/review-inbox.md, "Before the inbox is released").`);
}

// ---- Firestore's typed values
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: toFields(v) } };
}
const toFields = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, toValue(v)]));
function fromValue(v) {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return new Date(v.timestampValue).getTime();
  if ("bytesValue" in v) return Buffer.from(v.bytesValue, "base64");
  if ("arrayValue" in v) return (v.arrayValue.values ?? []).map(fromValue);
  if ("mapValue" in v) return fromFields(v.mapValue.fields ?? {});
  return null;
}
const fromFields = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fromValue(v)]));
const docOf = (d) => ({ id: d.name.split("/").pop(), ...fromFields(d.fields ?? {}) });

async function list(collection) {
  const out = [];
  let pageToken = "";
  do {
    const page = await call("GET", `/${collection}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
    out.push(...(page?.documents ?? []).map(docOf));
    pageToken = page?.nextPageToken ?? "";
  } while (pageToken);
  return out;
}
const get = async (docPath) => { const d = await call("GET", `/${docPath}`); return d ? docOf(d) : null; };
/** Sets the given fields and leaves the rest of the document alone. */
const patch = (docPath, fields) => call("PATCH", `/${docPath}?${Object.keys(fields).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&")}`, { fields: toFields(fields) });
const put = (docPath, fields) => call("PATCH", `/${docPath}`, { fields: toFields(fields) });

// ---- clip files: static files named by full URL
const MIME = { ".mp4": "video/mp4", ".webm": "video/webm", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml" };
const isUrl = (s) => /^https?:\/\//.test(s);
/**
 * Publishes files (relative paths under `folder`) and answers each one's URL.
 * Emulator: copied under --serve-dir, named by --serve-url. Otherwise: one Cloudflare Pages deployment, whose own
 * address never changes or disappears, so a later upload cannot break an earlier clip.
 */
function publish(folder, files, batch) {
  const unique = [...new Set(files)];
  for (const f of unique) if (!fs.existsSync(path.join(folder, f))) die(`Missing file: ${path.join(folder, f)}`);
  for (const f of unique) if (!MIME[path.extname(f).toLowerCase()]) die(`Not a clip, poster or icon file: ${f}`);
  // Cloudflare Pages takes files up to 25 MiB.
  for (const f of unique) if (fs.statSync(path.join(folder, f)).size > 25 * 1024 * 1024) die(`${f} is over 25 MiB: encode it smaller (a 30-second clip at 1080p fits easily at CRF 24 to 26).`);
  if (emulator) {
    // A running preview says where its clip folder is (tools/review-preview.mjs writes .cache/review-preview.json).
    const pointer = path.join(repo, ".cache", "review-preview.json");
    const preview = fs.existsSync(pointer) ? JSON.parse(fs.readFileSync(pointer, "utf8")) : {};
    const dir = opt("serve-dir", process.env.REVIEW_SERVE_DIR ?? preview.serveDir), url = opt("serve-url", process.env.REVIEW_SERVE_URL ?? preview.serveUrl);
    if (!dir || !url) die("No preview is running. Start one (node tools/review-preview.mjs --data <folder>), or pass --serve-dir <folder> and --serve-url <its address>.");
    for (const f of unique) { const to = path.join(dir, batch, f); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(folder, f), to); }
    return Object.fromEntries(unique.map((f) => [f, `${url.replace(/\/$/, "")}/${batch}/${f.split(path.sep).join("/")}`]));
  }
  const pagesProject = process.env.REVIEW_PAGES_PROJECT ?? "rtsai-review";
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "review-upload-"));
  try {
    for (const f of unique) { const to = path.join(stage, batch, f); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(folder, f), to); }
    // Clip files never change under a name; keep them out of search results.
    fs.writeFileSync(path.join(stage, "_headers"), "/*\n  Cache-Control: public, max-age=31536000, immutable\n  X-Robots-Tag: noindex\n  Access-Control-Allow-Origin: *\n");
    // Run the uploader from the upload folder itself: from the repository it also finds the site build's
    // .wrangler/deploy/config.json and any wrangler.jsonc in a folder above, and refuses to choose (20 Nov 2026).
    const bin = path.join(repo, "node_modules", "wrangler", "bin", "wrangler.js");
    const wrangler = `node "${bin}" pages deploy "${stage}" --project-name ${pagesProject} --branch main --commit-dirty=true`;
    let out;
    try { out = execSync(wrangler, { cwd: stage, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
    catch (e) {
      const text = `${e.stdout ?? ""}${e.stderr ?? ""}`;
      if (!/Project not found|8000007|project "[^"]+" does not exist/i.test(text)) die(`Cloudflare upload failed:\n${text.slice(-1500)}`);
      // First upload ever: the project does not exist yet.
      execSync(`node "${bin}" pages project create ${pagesProject} --production-branch main`, { cwd: stage, stdio: "inherit" });
      out = execSync(wrangler, { cwd: stage, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    }
    const base = /https:\/\/[a-z0-9]+\.[a-z0-9-]+\.pages\.dev/.exec(out)?.[0];
    if (!base) die(`Cloudflare upload gave no address:\n${out.slice(-1500)}`);
    return Object.fromEntries(unique.map((f) => [f, `${base}/${batch}/${f.split(path.sep).join("/")}`]));
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);

// ---- reading
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const sideLine = (side) => `${side.name}: ${side.units.map((u) => `${u.count}× ${u.name}`).join(", ")}`;
async function clipsWithNotes(front, wanted) {
  const clips = (await list("reviewClips")).filter((c) => (!front || c.front === front) && wanted(c));
  for (const c of clips) c.notes = (await list(`reviewClips/${c.id}/notes`)).sort((a, b) => a.t - b.t);
  return clips.sort((a, b) => a.created - b.created);
}
function printClipHead(c) {
  console.log(`\n${c.id}  ·  ${c.title}  ·  ${c.state}, round ${c.round}  ·  ${c.front}`);
  if (c.sides?.length) console.log(`  ${c.sides.map(sideLine).join("   vs   ")}${c.mode ? `   [${c.mode.label}]` : ""}`);
  const b = c.build ?? {};
  console.log(`  build: ${[b.label, b.page && `page ${b.page}`, b.runtime, b.data].filter(Boolean).join(", ")}${c.repro?.map ? `   map ${c.repro.map}` : ""}${c.repro?.seed !== undefined ? `   seed ${c.repro.seed}` : ""}`);
  if (c.repro?.link) console.log(`  fight: ${c.repro.link}`);
  if (c.repro?.replay) console.log(`  replay: ${c.repro.replay}`);
  console.log(`  video: ${c.video}`);
}

// ---- verbs
if (verb === "add") {
  await requireReleased();
  const folder = path.resolve(positional[0] ?? die("usage: node tools/review.mjs add <folder with clips.json>"));
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, "clips.json"), "utf8"));
  const list = Array.isArray(manifest) ? manifest : manifest.clips ?? die("clips.json needs a list of clips.");
  const top = Array.isArray(manifest) ? {} : manifest;
  const by = opt("by", top.by ?? top.session ?? "a session");
  const replace = flag("replace");
  // Two ways to write a clip are taken (docs/review-inbox.md): the full one (why, sides, mode, chips, repro, build,
  // suspects with their second) and the short one the fronts agreed on (shows, facts, filmedAt, suspected).
  const text = (v) => (typeof v === "string" ? v : v === undefined || v === null ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? Object.entries(v).map(([k, x]) => `${k}: ${x}`).join(", ") : String(v));
  const label = (k) => k.charAt(0).toUpperCase() + k.slice(1).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  for (const c of list) {
    if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(c.id ?? "")) die(`Clip id "${c.id}" must be lower-case letters, digits and dashes.`);
    if (!c.title || !c.file) die(`Clip ${c.id} needs a title and a file.`);
    c.front ??= top.front ?? die(`Clip ${c.id} needs a front (battles, campaign, ai, multiplayer, ...), its own or one for the whole file.`);
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(c.front)) die(`Front "${c.front}" must be lower-case letters, digits and dashes.`);
    const existing = await get(`reviewClips/${c.id}`);
    if (existing && !replace) die(`Clip ${c.id} is already in the inbox (${existing.state}). Use "fixed" to send it back after a fix, or --replace to swap a broken recording.`);
    c.existing = existing;
    c.why ??= text(c.shows);
    // facts: a sentence, or named facts. "build" names the build; everything else becomes a small labelled chip.
    const facts = c.facts && typeof c.facts === "object" && !Array.isArray(c.facts) ? { ...c.facts } : c.facts ? { facts: text(c.facts) } : {};
    c.build ??= typeof facts.build === "object" && facts.build ? facts.build : facts.build ? { label: text(facts.build) } : top.build ?? { label: "" };
    delete facts.build;
    c.chips = [...(c.chips ?? []), ...Object.entries(facts).filter(([, v]) => text(v)).map(([k, v]) => ({ label: label(k), value: text(v).slice(0, 160) })), ...(c.filmedAt ? [{ label: "Filmed", value: text(c.filmedAt) }] : [])];
    // suspected: sentences, or { t | at, text } with the second it shows.
    c.suspects = [...(c.suspects ?? []), ...(Array.isArray(c.suspected) ? c.suspected : c.suspected ? [c.suspected] : []).map((x) => (typeof x === "string" ? { t: 0, text: x } : { t: Number(x.t ?? x.at ?? x.second ?? 0) || 0, text: text(x.text ?? x.what ?? x.problem) }))].filter((x) => x.text);
    // A clip without a poster or a length gets them from the file (ffmpeg and ffprobe, when they are installed).
    if (!isUrl(c.file) && fs.existsSync(path.join(folder, c.file))) {
      const file = path.join(folder, c.file);
      if (!c.seconds) { try { c.seconds = Math.round(Number(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${file}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })) * 10) / 10 || 0; } catch { /* no ffprobe: the page reads the length itself */ } }
      if (!c.poster) {
        const poster = `${c.file.replace(/\.[^.]+$/, "")}.poster.jpg`;
        try { execSync(`ffmpeg -y -v error -ss ${Math.max(0.5, (c.seconds || 6) / 3).toFixed(1)} -i "${file}" -frames:v 1 -vf scale=640:-2 -q:v 4 "${path.join(folder, poster)}"`, { stdio: "ignore" }); c.poster = poster; } catch { /* no ffmpeg: the strip shows the front's name */ }
      }
    }
  }
  const local = (v) => (typeof v === "string" && v && !isUrl(v) ? [v] : []);
  const files = list.flatMap((c) => [...local(c.file), ...local(c.poster), ...(c.sides ?? []).flatMap((s) => [...local(s.flag), ...s.units.flatMap((u) => local(u.icon))])]);
  const fronts = [...new Set(list.map((c) => c.front))];
  const urls = publish(folder, files, `${fronts.length === 1 ? fronts[0] : "clips"}/${stamp()}`);
  const url = (v) => (typeof v === "string" && v ? (isUrl(v) ? v : urls[v]) : undefined);
  const now = new Date();
  let n = 0;
  for (const c of list) {
    const facts = {
      front: c.front, title: c.title, why: c.why ?? "", video: url(c.file), poster: url(c.poster), seconds: c.seconds ?? 0,
      sides: c.sides?.map((s) => ({ faction: s.faction, name: s.name, flag: url(s.flag), units: s.units.map((u) => ({ id: u.id, name: u.name, count: u.count ?? 1, cls: u.cls, icon: url(u.icon) })) })),
      mode: c.mode, chips: c.chips.length ? c.chips : undefined, repro: c.repro, build: c.build, suspects: c.suspects, by, updated: now,
    };
    // Each clip a millisecond after the last: the inbox shows them in the order of clips.json.
    if (c.existing) await patch(`reviewClips/${c.id}`, facts);
    else await put(`reviewClips/${c.id}`, { ...facts, dismissed: [], state: "new", round: 1, created: new Date(now.getTime() + n) });
    n++;
    console.log(`${c.existing ? "replaced" : "added"}  ${c.id}  ${facts.video}`);
  }
  console.log(`\n${n} clip(s) in the inbox (${fronts.join(", ")})${emulator ? ", local preview" : ""}.`);
} else if (verb === "feedback") {
  const front = opt("front");
  // Clips with something to act on: open notes, or suspects the owner waved off or left unanswered after answering.
  const clips = await clipsWithNotes(front, (c) => c.state === "noted" || c.state === "recheck" || (c.dismissed?.length ?? 0) > 0);
  const open = clips.map((c) => ({ ...c, notes: c.notes.filter((n) => n.state === "open") })).filter((c) => c.notes.length || (c.dismissed?.length ?? 0) > 0);
  if (flag("json")) console.log(JSON.stringify(open, null, 2));
  else {
    const count = open.reduce((s, c) => s + c.notes.length, 0);
    console.log(`${count} open note(s) on ${open.filter((c) => c.notes.length).length} clip(s)${front ? ` (front: ${front})` : ""}${emulator ? " (local preview)" : ""}`);
    for (const c of open) {
      printClipHead(c);
      for (const n of c.notes) {
        const how = n.said === "voice" ? `voice ${clock(n.audio?.seconds ?? 0)}, transcript: ${n.transcript}` : n.said === "suspect" ? "your suspect, confirmed by the owner" : "typed";
        console.log(`  ● ${clock(n.t)}  [${how}]  note ${n.id}  (round ${n.round})`);
        console.log(`      ${n.text ? JSON.stringify(n.text) : "(no transcript yet: fetch the audio, transcribe it, store it with `transcript`)"}`);
        if (n.audio) console.log(`      audio: node tools/review.mjs audio ${c.id} ${n.id}${emulator ? " --emulator" : ""}`);
      }
      for (const i of c.dismissed ?? []) if (c.suspects?.[i]) console.log(`  ○ ${clock(c.suspects[i].t)}  the owner says this suspect is fine: ${JSON.stringify(c.suspects[i].text)}`);
    }
  }
} else if (verb === "audio") {
  const [clipId, noteId] = positional;
  if (!clipId || !noteId) die("usage: node tools/review.mjs audio <clip> <note> [--out <file>]");
  const note = await get(`reviewClips/${clipId}/notes/${noteId}`) ?? die(`No note ${noteId} on ${clipId}.`);
  if (!note.audio) die("That note was typed: it has no audio.");
  const parts = [];
  for (let i = 0; i < note.audio.chunks; i++) parts.push((await get(`reviewClips/${clipId}/audio/${noteId}_${i}`) ?? die(`Audio chunk ${i} is missing.`)).data);
  const ext = note.audio.type.includes("ogg") ? "ogg" : note.audio.type.includes("mp4") ? "m4a" : "webm";
  const out = path.resolve(opt("out", `${clipId}-${noteId}.${ext}`));
  fs.writeFileSync(out, Buffer.concat(parts));
  console.log(`${out}  (${Buffer.concat(parts).length} bytes, ${note.audio.type}, ${clock(note.audio.seconds)}, pinned at ${clock(note.t)})`);
} else if (verb === "transcript") {
  const [clipId, noteId] = positional, text = opt("text");
  if (!clipId || !noteId || !text) die('usage: node tools/review.mjs transcript <clip> <note> --text "what the owner said"');
  await requireReleased();
  if (!await get(`reviewClips/${clipId}/notes/${noteId}`)) die(`No note ${noteId} on ${clipId}.`);
  await patch(`reviewClips/${clipId}/notes/${noteId}`, { text: text.trim().slice(0, 4000), transcript: "whisper" });
  console.log("transcript stored");
} else if (verb === "fixed") {
  const clipId = positional[0], reply = opt("reply");
  if (!clipId || !reply) die('usage: node tools/review.mjs fixed <clip> --reply "what changed" [--in <commit or build>] [--video <file>] [--poster <file>] [--note <id>]...');
  await requireReleased();
  const clip = await get(`reviewClips/${clipId}`) ?? die(`No clip ${clipId}.`);
  const notes = await list(`reviewClips/${clipId}/notes`);
  const ids = opts("note");
  const answered = notes.filter((n) => (ids.length ? ids.includes(n.id) : n.state === "open"));
  if (!answered.length) die("No open note to answer on that clip.");
  const video = opt("video"), poster = opt("poster");
  let urls = {};
  if (video) {
    const folder = path.dirname(path.resolve(video));
    if (poster && path.dirname(path.resolve(poster)) !== folder) die("Keep the new video and its poster in one folder.");
    urls = publish(folder, [path.basename(video), ...(poster ? [path.basename(poster)] : [])], `${clip.front}/${stamp()}-round${clip.round + 1}`);
  }
  for (const n of answered) await patch(`reviewClips/${clipId}/notes/${n.id}`, { state: "recheck", reply, ...(opt("in") ? { fixedIn: opt("in") } : {}) });
  await patch(`reviewClips/${clipId}`, {
    state: "recheck", round: clip.round + 1, updated: new Date(),
    ...(video ? { before: clip.video, video: urls[path.basename(video)], ...(poster ? { poster: urls[path.basename(poster)] } : {}) } : {}),
  });
  console.log(`${clipId}: back in the inbox as "fixed, check again" (round ${clip.round + 1}); ${answered.length} note(s) answered${video ? "; new video uploaded" : "; same video (pass --video for a re-recording)"}.`);
} else if (verb === "status") {
  const front = opt("front");
  const clips = await clipsWithNotes(front, () => true);
  if (flag("json")) console.log(JSON.stringify(clips, null, 2));
  else {
    const by = (s) => clips.filter((c) => c.state === s).length;
    console.log(`${clips.length} clip(s)${front ? ` in ${front}` : ""}${emulator ? " (local preview)" : ""}: ${by("new")} waiting, ${by("recheck")} to check again, ${by("good")} look good, ${by("noted")} with notes, ${by("skipped")} skipped`);
    for (const c of clips) console.log(`  ${c.state.padEnd(8)} r${c.round}  ${c.id}  ${c.title}${c.notes.length ? `  (${c.notes.map((n) => n.state).join(", ")})` : ""}`);
  }
} else if (verb === "remove") {
  if (!positional.length) die("usage: node tools/review.mjs remove <clip>...");
  // Taking something back out is always allowed, also before the release.
  for (const clipId of positional) {
    if (!await get(`reviewClips/${clipId}`)) { console.log(`${clipId}: not in the inbox`); continue; }
    for (const sub of ["notes", "audio"]) for (const d of await list(`reviewClips/${clipId}/${sub}`)) await call("DELETE", `/reviewClips/${clipId}/${sub}/${d.id}`);
    await call("DELETE", `/reviewClips/${clipId}`);
    console.log(`${clipId}: removed (its files stay where they were uploaded)`);
  }
} else {
  die("usage: node tools/review.mjs add|feedback|audio|transcript|fixed|status|remove ...   (docs/review-inbox.md)");
}
