# RTS AI web application guidance

- Build and refine the website directly in Next.js; Figma is not part of this product workflow.
- RTS AI is one product: a Red Alert 2 mod for OpenRA with modern factions and an AI co-commander. Use the generated catalog for the current faction roster. See `../OpenRA-AI/docs/roadmap.md`.
- Primary navigation is Factions and Download. The homepage carries the promise, the three pillars (factions, co-commander, RA2 on OpenRA), the faction entry and an honest download path.
- On 4 October 2026 the owner approved a live Map Workshop subapp in the primary navigation, with map generation, placement and browser experiments in both modes. Its browser simulation must be labeled approximate; native rules remain authoritative.
- On 4 October 2026 the owner also requested a Campaign Studio under Workshop. It supports local story, character, storyboard, branch and objective editing, both game catalogs, map attachments and browser playtest receipts. Intro export currently produces original silent animated briefings and captions locally; do not describe it as paid AI cinema or native campaign scripting. See `docs/campaign-studio.md`.
- Parked surfaces (Earth studio, Capability Atlas, platform plan) stay reachable for existing links but are `noindex`, out of the sitemap, and never linked from live pages. Do not add new ones without the owner's approval.
- Faction and unit names come only from the generated catalog snapshot (`npm run sync:content`); never hand-write names that the game also displays.
- Never claim RA2 availability before a verified public release says so.
- Preserve server/client component boundaries and validate changes with local lint, tests, and production builds.
- Treat Vercel as the canonical production host. GitHub `main` deploys through Vercel's native Git integration to `rtsai.net` and `www.rtsai.net`.
- Never add GitHub Actions or hosted workflow files.
