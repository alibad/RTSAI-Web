# Capability Atlas and Faction Archive design QA

## Evidence

- Existing-product source truth: `C:/Users/Admin/Code/hq/games/RTSAI-Web/.codex-qa/capabilities-desktop-viewport-pass1.png` (1440 x 1000 CSS viewport).
- Archive implementation: `C:/Users/Admin/Code/hq/games/RTSAI-Web/.codex-qa/archive-desktop-final.png` (browser capture emitted 1425 x 990 after scrollbar and app chrome insets).
- Normalized implementation: `C:/Users/Admin/Code/hq/games/RTSAI-Web/.codex-qa/archive-desktop-final-normalized.png`.
- Full-view side-by-side: `C:/Users/Admin/Code/hq/games/RTSAI-Web/.codex-qa/source-vs-archive-final.png` (2880 x 1000).
- Focused source asset: `C:/Users/Admin/Code/hq/games/OpenRA-AI/assets/turkey-faction/concept-sources/turkey-roster-concept.png` (1536 x 1024).
- Focused modal implementation: `C:/Users/Admin/Code/hq/games/RTSAI-Web/.codex-qa/archive-modal-pass1.png` (1425 x 990).
- Focused side-by-side: `C:/Users/Admin/Code/hq/games/RTSAI-Web/.codex-qa/source-vs-modal-final.png` (2850 x 990).
- Mobile archive: `C:/Users/Admin/Code/hq/games/RTSAI-Web/.codex-qa/archive-mobile-grid-pass2.png`, `archive-mobile-cards-pass2.png`, and `archive-mobile-modal-pass2.png` at a 390 x 844 CSS viewport.
- State: signed out, Red Sea 2026 selected by default; Turkey, search, category filters, show-all, provenance, and lightbox states also exercised.

## Full-view comparison

The existing Capability Atlas and new Build Archive were inspected side by side as one image. The archive preserves the product's Geist typography, red and gold accents, sharp one-pixel borders, mono labels, editorial grid, restrained icon weight, and high-contrast calls to action. The light archive canvas is an intentional gallery surface shift; its dark faction dossier keeps continuity with the site hero while helping the real artwork read as evidence rather than decoration.

The archive adds a deeper information hierarchy without duplicating the Capability Atlas. The Atlas explains what exists; the archive exposes the work itself: concept art, native gameplay, mission evidence, cameos, unit sheets, audits, and effects across four faction tracks.

## Focused image comparison

The original Turkey roster concept and its archive lightbox were inspected side by side. The content-hashed WebP retains sharp silhouettes, type, color, and framing. The modal uses `object-fit: contain`, so source assets are never stretched or destructively cropped. Pixel-art categories use nearest-neighbor rendering while concept and gameplay captures remain smoothly scaled.

## Required fidelity surfaces

- Fonts and typography: Geist and Geist Mono remain the rendered families. Heading hierarchy, uppercase mono labels, line lengths, and supporting-copy contrast match the current product.
- Spacing and responsiveness: the desktop dossier, faction tabs, filter rail, gallery, and modal align to the editorial grid. At 390 CSS px, tabs and filters remain horizontally reachable, metrics stay three-across, cards stack cleanly, and modal controls remain visible.
- Colors and tokens: existing ink, paper, red, gold, line, and muted-copy tokens are reused. No unrelated palette was introduced.
- Image quality: 216 source artifacts are converted to optimized, content-hashed WebP files. Large images use visually efficient compression; pixel assets use lossless conversion and pixelated rendering.
- Copy and provenance: every asset exposes category, dimensions, optimized size, repository path, and a source link. Private machine naming is absent.
- Interaction and accessibility: faction tabs expose selection state; search has a visible label; filter buttons expose pressed state; results update live; the lightbox has a dialog label, focusable close action, source link, backdrop dismissal, and Escape dismissal.
- Caching: fingerprinted media is served with one-year immutable cache headers; the generated manifest revalidates after five minutes.

## Comparison history

1. P2 - The initial library sequence opened with production cameos because categories were alphabetized.
   - Fix: introduced an editorial order: concept, live, mission, cameo, unit, audit, effects.
   - Post-fix evidence: `archive-desktop-final.png` and `archive-mobile-cards-pass2.png` lead with high-context concept and gameplay evidence.
2. P2 - The initial mobile dossier stacked three metrics vertically and consumed too much of the first screen.
   - Fix: retained a compact three-column metric row at mobile widths.
   - Post-fix evidence: `archive-mobile-grid-pass2.png`.

## Verification

- [x] Four faction tracks and 216 generated artifacts are present.
- [x] Faction switching works; Turkey shows the Anatolian Guard dossier.
- [x] Search for `Bozkir` returns exactly its cameo, unit sheet, and husk evidence.
- [x] Category filters, show-all, source links, and lightbox interactions work.
- [x] Desktop and mobile surfaces were visually inspected.
- [x] Browser console was checked: no application errors; local Firebase Analytics logged one expected measurement-ID fetch fallback while offline from its service.
- [x] Typecheck and lint pass.
- [x] Production build and all 22 automated tests pass.

## Findings

No actionable P0, P1, or P2 findings remain.

final result: passed
