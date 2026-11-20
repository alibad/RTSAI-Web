# The Review inbox

The owner's quick way to say what is right and wrong in the game (asked for on 20 November 2026): short clips, one at
a time, each answered with one click or key. Any session working on the game can put clips in it and read the answers.

- **The owner's page:** `/admin/review` (the maker bar's **Review**, and a tile on `/admin`). One clip, large and
  playing, with who fights whom as flags and unit icons.
  - `G` Looks good, `S` Skip, `V` a voice note pinned to the second where the owner started talking (`Enter` saves and
    moves on, `M` saves and stays for another note), `T` type instead, `Z` undo, `Space` play or pause, arrows step a
    second, `B` before/after on a fixed clip.
  - Suspects a session attached show under the clip: **Wrong** turns one into a note, **Fine** waves it off.
  - Clips a session fixed come back first, marked **Fixed, check again**, with the owner's note and the session's reply.
- **A front** is one line of work: `battles`, `campaign`, `ai`, `multiplayer`, `maps`, `art`, `sound`, `site`
  (`lib/review/model.ts`; add one there when a new front starts). `/admin/review?front=battles` opens on one front.
- **Owner only.** The page sits behind `AdminGate`, and the data behind a Firestore rule (`firestore.rules`, "Review
  inbox") that lets in only a verified sign-in with an owner email: the same list as `OWNER_EMAILS` in `lib/admin.ts`.
  Change both together.

## For sessions: three commands

Run them in `RTSAI-Web`. They talk to the `rtsai-net` Firestore as the signed-in `gcloud` account (the owner's), so
they need no key in the repository.

### 1. Add clips

```sh
node tools/review.mjs add <folder>
```

`<folder>/clips.json` names the clips; paths in it are relative to the folder, and full `https://` addresses are kept
as they are.

```json
{
  "front": "battles",
  "by": "battle review session, 20 Nov 2026",
  "build": { "label": "live /play, 16 Nov", "page": "a6e9eea", "runtime": "rt-93fcc127b22e", "data": "data-ada60803287d" },
  "clips": [
    {
      "id": "battles-iran-america-siege",
      "title": "Rocket launchers shell a bunker line",
      "why": "Do the rockets arc, land and draw a blast?",
      "file": "iran-america-siege.mp4", "poster": "iran-america-siege.jpg", "seconds": 31,
      "mode": { "id": "siege", "label": "Siege" },
      "sides": [
        { "faction": "iran", "name": "Iran", "flag": "flags/iran.svg",
          "units": [{ "id": "r2irrocket", "name": "Rocket launcher", "count": 4, "cls": "vehicle", "icon": "icons/iran-r2irrocket.png" }] },
        { "faction": "america", "name": "America", "flag": "flags/america.svg",
          "units": [{ "id": "gapill", "name": "Pillbox", "count": 3, "cls": "defence", "icon": "icons/america-gapill.png" }] }
      ],
      "repro": { "link": "https://rtsai.net/play/?mode=sandbox&s=...", "map": "web-arena", "seed": 1 },
      "suspects": [{ "t": 14, "text": "The second launcher never fires." }]
    }
  ]
}
```

- `id`: lower-case letters, digits and dashes, unique in the inbox. Start it with the front.
- `title` and `why`: a few words each. `why` is what the owner is asked to judge.
- `sides`, `mode`: for fights. Other fronts can leave them out and use `chips` (`[{ "label": "Mission", "value": "3" }]`).
  Mode ids with their own icon: `direct`, `attack-move`, `siege`, `air-strike`, `anti-air`, `naval`, `garrison`,
  `deployed`, `defence`, `special`. Unit classes: `infantry`, `vehicle`, `aircraft`, `ship`, `defence`, `building`,
  `special`.
- `repro`: how to see it again (a link into the game, the map, the seed, a replay file).
- `build`: what it was filmed on. Per clip, or once for the whole file.
- `suspects`: what you already think is wrong, with the second it shows. Watch your own clips first: the owner should
  confirm or correct, not start from zero.
- Keep clips short (20 to 40 seconds) and few. Each should have a reason to exist.

The files (video, poster, flags, unit icons) go to the Cloudflare Pages project `rtsai-review` as one deployment per
`add`; the clip keeps that deployment's own address, which never changes, so a later upload cannot break an earlier
clip. The project is created on the first upload. It is free; the addresses are unlisted but public, so never put
anything secret in a clip.

A clip that is already in the inbox is refused. `--replace` swaps a broken recording (same round, the owner's answer
is kept). `node tools/review.mjs remove <clip>...` takes clips out again.

### 2. Read the owner's answers

```sh
node tools/review.mjs feedback                 # open notes, every front
node tools/review.mjs feedback --front battles # one front; --json for a program
node tools/review.mjs status                   # every clip and its answer
```

`feedback` prints, for each clip with open notes: its facts (sides, units, mode, map, seed, the link into the game,
the build), then each note with the second it is pinned to, how it was given (voice, typed, or one of your suspects
that the owner confirmed), the transcript, and the command that fetches its audio. Suspects the owner waved off are
listed too, so you stop chasing them.

```sh
node tools/review.mjs audio <clip> <note> --out note.webm       # the owner's voice, as recorded (Opus)
node tools/review.mjs transcript <clip> <note> --text "..."     # store a transcript you made
```

The transcript comes from the browser's own speech recognition while the owner talks. It can be empty or wrong: the
audio is the truth. When a note has no transcript, fetch the audio, transcribe it locally (Hangar's `transcribe`
tool, which runs Whisper on this machine; nothing is sent anywhere or billed), and store the result with `transcript`.

### 3. Send a fix back

```sh
node tools/review.mjs fixed <clip> --reply "what changed, in one sentence" --in <commit or build> \
  --video <re-recorded clip.mp4> --poster <its poster.jpg>
```

Every open note of the clip moves to **re-check** with your reply, and the clip returns to the top of the inbox as
"Fixed, check again", with the old video kept for a before/after switch. The owner answers **Fixed** (the notes
close) or **Still wrong** (a new note; the earlier ones open again). `--note <id>` (repeatable) answers only some of
the notes. Film the clip again on a build that has the fix, and say which build in `--in`.

A note's states: **open** (the owner said it is wrong) → **recheck** (you say it is fixed) → **fixed** (the owner
agreed). A clip's states: `new`, `good`, `skipped`, `noted`, `recheck`.

## Where the data lives, and what it costs

| What | Where | Cost |
|---|---|---|
| Clips' facts, the owner's answers, notes | Firestore `rtsai-net`, `reviewClips/{clip}` and its `notes` | free tier |
| Voice notes | Firestore, `reviewClips/{clip}/audio`, chunks of at most 900 KiB (the project has no Storage bucket) | free tier |
| Clip files | Cloudflare Pages project `rtsai-review` | free |
| Transcripts | the browser's speech recognition; local Whisper as the fallback | free |

A 30-second voice note is about 120 KB. Nothing here adds a Vercel function, a Blob store or a bill.

## Trying it without releasing anything

```sh
node tools/review-preview.mjs --data <folder>     # the real page and rules on the local Firebase emulators
node tools/review.mjs add <clips folder> --emulator --serve-dir <folder>/clips --serve-url http://127.0.0.1:3473
node tools/review.mjs feedback --emulator
node tools/review-inbox-browser-test.mjs --data <folder>   # the whole loop in a browser with a fake microphone
```

The preview opens at `http://127.0.0.1:3472/admin/review` and signs the owner in by itself (emulator only). What is
answered there stays in `<folder>/firestore` on this PC. It needs Java and the `firebase` CLI. Record in a normal
Chrome window: the Claude app's built-in browser pane blocks the microphone.

The test adds four clips on the front `test`, answers them with keys only (Looks good, a suspect waved off and one
confirmed, a voice note, a typed note, Skip, Undo), reads them back with `feedback`, fetches the voice note, sends a
fix back and checks it again, then checks that a stranger's sign-in reads nothing. It removes its clips at the end.

## Releasing a change to it

- The page ships with the website (a push of `main` deploys rtsai.net; ask the owner first).
- The rule ships with `firebase deploy --only firestore:rules --project rtsai-net`. Before that, compare the deployed
  rules with git: other sessions share the file.
