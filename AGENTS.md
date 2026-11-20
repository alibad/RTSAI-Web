# RTS AI web application guidance

- Build and refine the website directly in Next.js; Figma is not part of this product workflow.
- RTS AI is one standalone OpenRA product with modern factions and an optional AI co-commander. No owned Red Alert/RA2 installation is required. Preserve Classic/top-down and isometric gameplay as product modes; the combined mode selector remains integration work. Never describe the legacy owned-RA2 add-on as that Classic mode. Use the generated catalog for the current faction roster. See `../RTSAI-Mod/docs/product-direction.md` and `../RTSAI-Mod/docs/roadmap.md`.
- Primary navigation is Factions and Download. The homepage carries the promise, the three pillars (factions, co-commander, RA2 on OpenRA), the faction entry and an honest download path.
- The maker tools share one navigation (owner, 12 November 2026): `app/components/MakerBar.tsx`, the same bar on the Faction Studio, the Concept Forge, the Workshop pages and the Viewer in the local app, in four groups (Units, Battles, AI, Game). A new maker page joins a group there; never add another menu, tab row or icon strip for it. A page's own controls stay in the page, not in the bar. The game opens in a new tab. Players on rtsai.net keep the public header. The bar's Map editor and Battle simulator are the game's own (`/play/?mode=editor`, `/play/?mode=sandbox`); the website's /workshop page is the older copy the owner replaced on 14 October 2026 and must not be linked as the Map editor.
- On 4 October 2026 the owner approved a live Map Workshop subapp in the primary navigation, with map generation, placement and browser experiments in both modes. Its browser simulation must be labeled approximate; native rules remain authoritative.
- On 4 October 2026 the owner also requested a Campaign Studio under Workshop. It supports local story, character, storyboard, branch and objective editing, both game catalogs, map attachments and browser playtest receipts. Intro export currently produces original silent animated briefings and captions locally; do not describe it as paid AI cinema or native campaign scripting. See `docs/campaign-studio.md`.
- Parked surfaces (Earth studio, Capability Atlas, platform plan) stay reachable for existing links but are `noindex`, out of the sitemap, and never linked from live pages. Do not add new ones without the owner's approval.
- Faction and unit names come only from the generated catalog snapshot (`npm run sync:content`); never hand-write names that the game also displays.
- Never claim RA2 availability before a verified public release says so.
- Preserve server/client component boundaries and validate changes with local lint, tests, and production builds.
- Treat Vercel as the canonical production host. GitHub `main` deploys through Vercel's native Git integration to `rtsai.net` and `www.rtsai.net`.
- Never add GitHub Actions or hosted workflow files.

## The Review inbox: show the owner clips, read the answers (owner, 20 November 2026)

The owner gives feedback on the game by watching short clips at `/admin/review` and answering each with Looks good,
Skip or a voice note. Use it for anything the owner should judge by eye, on any front (battles, campaign, AI,
multiplayer, maps, art, sound, the website). How-to: `docs/review-inbox.md`.

- Add clips: `node tools/review.mjs add <folder with clips.json>`. Watch them yourself first and attach what you
  suspect is wrong.
- Read the answers: `node tools/review.mjs feedback [--front <front>]` (open notes with each clip's facts, the second,
  the transcript, and how to fetch the audio).
- After a fix: film the clip again and send it back with `node tools/review.mjs fixed <clip> --reply "..." --video ...`.
- Keep clips short and few: each needs a reason to exist. Never mass-produce them.

## Where things live (owner, 1 Nov 2026)

| Repository | Holds | GitHub |
|---|---|---|
| `OpenRA` | The engine: our fork of OpenRA/OpenRA (`fork/main`) | public |
| `RTSAI-Mod` | The desktop game, plus the faction catalog master (`catalog/`), the AI companion (`companion/`), the older missions (`missions/`) and the roadmap (`docs/roadmap.md`) | public |
| `RTSAI-WebGame` | The web game at rtsai.net/play, plus its release tool | public |
| `RTSAI-Web` | rtsai.net, plus the Faction Studio (the one review desk) and the Sound Desk | private |
| `RTSAI-Art` | The forge: the look (`bible/`), art sources, the sound tools (`tools/sound`) and the trailers (`film/`) | private |

- **Archived on GitHub (read-only), so don't work in them:**
  - `OpenRA-AI`, now `RTSAI-Mod/companion`, `missions` and `docs/roadmap.md`
  - `RTSAI-Film`, now `RTSAI-Art/film`
  - `OpenRA-RL`
- **Drafts made with AI** (art, sound, film) stay outside git in `D:\Generated\RTSAI\<faction>\<kind>` until the Faction Studio approves them. Approved files go into git.
- **One look:** names come from the catalog (`RTSAI-Mod/catalog/factions.json`), and colours and style come from the bible (`RTSAI-Art/bible`). Read them; never hand-write a faction's name or palette. `RTSAI-Art/film` still has its own palette, which is still to be fixed.

## Branches: commit on main, always from the latest main

Several sessions change RTS AI at the same time; work left on a branch or built from a checkout that is behind gets
lost or ships half-done (14 October 2026).

- `main` is the only long-lived branch and `origin/main` is the truth. Commit on main.
- Before you start, before every commit and before any build you test: `git fetch`, then bring your checkout to the
  latest `origin/main` (`git pull --ff-only`, or `git pull --rebase` with local commits). Never build on a checkout
  that is behind main.
- If another session uses main, coordinate or wait. Worktrees require an explicit owner request; see the policy below.
- Pushing `main` here deploys production (rtsai.net), so it needs the owner's approval. Until then, keep finished work
  as commits on top of the latest `origin/main`, not on a long-lived branch.
- Never force-push, hard-reset or rebase commits that are already on `origin/main` or that belong to another session.

## Worktrees require an explicit owner request (15 October 2026)

- Use the existing canonical checkout. Do not create a Git worktree or a parallel clone unless the owner explicitly asks for it in the current task. This supersedes older instructions permitting worktrees for concurrency, isolation, convenience, or risk.
- Another session using the checkout is not permission to create a worktree. Coordinate non-overlapping changes, wait, or report the specific blocker; preserve all in-progress work.
- In the OpenRA/RTS AI repositories, work and commit on canonical `main`. Fetch the correct owner remote and safely incorporate its main before starting, committing, or validating a build. Never reset, force-push, or rewrite another session's commits.
- If the owner explicitly authorizes a worktree, keep it temporary, start from current main, and integrate validated work back into canonical main. Do not leave the only copy of finished work on a branch or worktree.
- Before retiring an existing branch or worktree, verify that its unique commits, uncommitted files, and user artifacts are preserved and integrated where appropriate. Never delete unique work to make a checkout look clean.
- Keep this policy change and local consolidation local. A request to consolidate on main does not by itself authorize a push, deployment, release, or deletion of branches/worktrees.
