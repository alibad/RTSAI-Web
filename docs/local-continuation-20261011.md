# Local continuation snapshot — 11 October 2026

This records the local acceptance before the owner subsequently authorized publication on 11 October. The separate `data/rtsai-mac-release.json` now records the Mac prerelease; its support limits and remaining human/device gates still apply.

The new standalone catalog derives both mode rosters from frozen rtsai and rtsai-topdown rules. Historical Art/AI catalogs and human review records remain unchanged. Public release availability continues to come exclusively from the preserved release manifests.

Run npm run sync:content to reconstruct the website snapshot from repository-owned frozen inputs, or npm run check:content to verify it without reading sibling checkouts. To refresh the rule facts, first use scripts/standalone-facts.ts with explicit verified Mod/engine/catalog inputs, then scripts/standalone-content.mjs; preserve the recorded input digests. The frozen-input adapter additionally rechecks the complete source archives when supplied --frozen-inputs=<verified configuration>.

The 48-second local review candidate is under public/review-media/2026-10-11 with poster and captions. data/local-review-media.generated.json binds its exact hashes. It uses accepted browser captures and labeled native stills, with the existing original soundtrack and no narration. Human listening and public release remain separate decisions. The reviewed 42-second public trailer is preserved.

The separate game document can install scripts/integration/game-measurement-bootstrap.mjs before game launch, using the verified single-file bundle and WebGame integrate-static-script tool. Only accepted world starts emit bounded local mode/transport/version receipts. No production analytics sink is installed; CTA clicks are separate evidence. S10 local topology checks do not establish remote analytics delivery.

At local acceptance, the Mac DMG was a macOS15+ local ad-hoc candidate: universal game, ARM64 companion only, not notarized, with no neural runtime/model/microphone demonstration. Other-device, Intel, cross-network, Safari, human campaign/balance, fluent voice and distribution checks remain pending.
