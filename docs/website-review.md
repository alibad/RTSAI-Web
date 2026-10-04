# Local website review — 4 October 2026

Measured scope from the current game-rule export:

| Mode | Factions | Unique units | Buildings and defenses |
| --- | ---: | ---: | ---: |
| Red Alert 2 | 14 | 115 | 51 |
| Classic | 10 | 112 | 47 |

Modern nations lead the home page and faction directory. All original countries
have text dossiers and full rosters. Country names follow the selected game's
rules, including Turkey in Classic and Türkiye in RA2. Category counts and
costs are source facts; doctrine descriptions remain editorial guidance.

Home, Download, modern faction and unit dossiers, Companion and Privacy share
the existing dark palette, simpler spacing and typography. Download separates
the unpublished RA2 mod from the earlier Classic alpha. Planned installer
details are collapsed until publication. The co-commander example explicitly
labels its scenarios and has functional Pause/Next controls without an account.
The game source link now points to the canonical RA2 mod.

Measured verification: content validation, TypeScript, production build,
ESLint and all 63 tests passed. The rendered journey test visits all 24
country/mode combinations and checks every actor name. Browser verification
covered the mode switch, example controls, roster category expansion and setup
disclosure. At a 390-pixel phone viewport, Home, Factions, original-faction
dossier, Download (including expanded setup), Companion and Privacy showed no
horizontal page overflow. Desktop and phone screenshots were visually reviewed.

Screenshots and the local test log are ignored under `.codex-qa/`. The review
images show website UI and text only. Original game assets are not copied into
the new roster snapshot or original-country cards. No paid model requests,
pushes, deployments or release publishing were performed. Existing API tests
use mocked providers and stores.

Visual assessment (inferred): fewer repeated status blocks and art contact
sheets make faction selection and release availability easier to scan. This
is a design assessment, not a measured user-study result.
