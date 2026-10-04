# Campaign Studio

The owner requested this Workshop app on 4 October 2026. Open `/workshop/campaigns?mode=ra2` (or `mode=ra`) on the local preview. Development and delivery remain local.

## Authoring

- Up to eight browser drafts, 24 chapters per campaign, 12 characters, eight shots per chapter, six objectives and four outcome branches.
- Edit character backgrounds, chapter prose, shot order, captions, dialogue, visual mood and duration. Undo/redo retains 20 authoring snapshots.
- Branches carry community trust and supplies through a journal. Choosing a branch starts the next chapter's silent intro preview. These values are story state, not native game bonuses.
- Campaign JSON import/export includes the complete graph, characters, storyboards and optional edited battlefields. The Markdown storyboard and WebVTT captions are separate exports.
- Valid drafts autosave locally; invalid fields stay editable and show checks. Browser storage can be cleared by the browser, so export files for durable backups. There is no cloud save.

Imports whitelist fields, bound text and numbers, resolve actor/faction references against the selected catalog, and reject broken references, duplicate IDs and loops. Unknown URLs, scripts and metadata are dropped. Changing the game mode is blocked while custom maps are attached; restore generated maps first to retain clear actor references.

## Intro videos

The exporter animates original Canvas scenery, parallax, light, captions and titles at 1280 × 720, requesting 30 fps. It records in real time using the browser's MediaRecorder (VP9 WebM, VP8 WebM or supported MP4). Cancellation stops timers and capture tracks. Video previews and Blob URLs are released after editing/navigation.

WebM recordings receive a finite duration based on Matroska `Info/Duration` and `TimestampScale`, following the [Matroska element specification](https://www.matroska.org/technical/elements.html). The helper is scoped to unindexed MediaRecorder output. It rejects unsupported metadata instead of silently corrupting indexed files.

These are **silent motion briefings**, not generative cinema or spoken narration. No paid model, GPU inference, original EA asset, external upload or API key is involved. Paid video generation remains a separate future integration requiring owner approval of the provider and spend cap.

## Mission playtests

Playtest opens the existing Map Workshop in a separate campaign sandbox. Reach, repair, protect and survive objectives are evaluated against actual browser simulation positions, health and time. Move a selected actor with the Move tool; repair through the actor inspector. These approximate mechanics use catalog actors as stand-ins. Native OpenRA objectives, scripts, cutscenes, campaign progression and balancing are not generated.

Return to Campaign records the measured browser result. Attach Map & Return also saves the edited terrain and placements into the chapter. Receipt application checks the exact source draft before attaching a map; stale receipts cannot overwrite a revised campaign. Objectives must still reference actors present in the attached scene. The regular Workshop saved battlefield is preserved.

## Starter fiction

**Between the Lines** contains five chapters about a civilian engineer, paramedic and a conflicted local volunteer in fictional Lebanese districts. It presents personal experiences and contested memories under Hezbollah's influence without endorsing the organization or portraying its violence as heroic. It is explicitly fictional and is not a verified historical account. Game actor factions do not establish the characters' affiliation.

## Verification

`npm run test` includes campaign graph, import, mode, branch, progress, map, real browser world objective, caption and WebM metadata checks, along with rendered routes for both modes. `npm run lint` checks interface and accessibility conventions. Review local browser screenshots and an actual recorded/downloaded clip before reporting video export verified.
