export const capabilityCategories = [
  { id: "all", label: "Everything" },
  { id: "companion", label: "Companion" },
  { id: "earth", label: "Earth studio" },
  { id: "theatres", label: "Theatres" },
  { id: "agents", label: "Autonomous agents" },
  { id: "ai-layer", label: "AI layer" },
  { id: "delivery", label: "Play + ship" },
] as const;

export type CapabilityCategory = Exclude<(typeof capabilityCategories)[number]["id"], "all">;
export type CapabilityStatus = "Playable now" | "Playable alpha" | "Development build" | "Research track" | "In progress";

export type Capability = {
  id: string;
  category: CapabilityCategory;
  status: CapabilityStatus;
  surface: string;
  title: string;
  summary: string;
  playerExperience: string;
  howItWorks: string;
  boundary: string;
  proofPoints: string[];
  docsUrl?: string;
  docsLabel?: string;
  searchTerms?: string[];
};

const source = "https://github.com/alibad/OpenRA-AI";

export const capabilities: Capability[] = [
  {
    id: "adaptive-briefings", category: "companion", status: "Playable now", surface: "In match", title: "Adaptive battlefield briefings",
    summary: "Short, relevant observations replace a constant stream of generic commentary.",
    playerExperience: "The companion calls out meaningful changes such as a power crisis, new armor, a lost harvester, or an exposed attack window.",
    howItWorks: "Deterministic game-state transitions pass through a relevance gate before any model is asked to phrase an update.",
    boundary: "Routine updates stay silent and low priority; gameplay continues if the AI layer is unavailable.",
    proofPoints: ["Importance tiers", "Voice budget", "No-token deterministic alerts"], docsUrl: `${source}#in-game-companion-controls`, docsLabel: "Companion controls",
  },
  {
    id: "voice-tactical-feed", category: "companion", status: "Playable now", surface: "In match", title: "Push-to-talk + tactical feed",
    summary: "Ask naturally, see what was heard, and keep a compact history of advice and orders.",
    playerExperience: "Hold Ctrl+Space to ask. The transcript appears in game, followed by a concise answer you can interrupt.",
    howItWorks: "Audio routes through the configured transcription capability while the feed records advice, alerts, transcripts, orders, and execution results.",
    boundary: "Voice can be muted independently and the feed remains available without speech output.",
    proofPoints: ["Visible transcription", "80-entry tactical log", "Interruptible speech"], docsUrl: `${source}#in-game-companion-controls`, docsLabel: "Voice controls",
    searchTerms: ["microphone", "speech", "transcription"],
  },
  {
    id: "priority-alerts", category: "companion", status: "Playable now", surface: "In match", title: "Priority-aware alerts",
    summary: "Information, warnings, and critical threats are treated differently.",
    playerExperience: "Low-priority context can appear quietly while profound or urgent changes may use voice and a stronger visual treatment.",
    howItWorks: "A deterministic threat and novelty score assigns the notification tier before text or speech generation.",
    boundary: "The player can disable voice, change the speaking threshold, or disable the companion without affecting the match.",
    proofPoints: ["Quiet updates", "Critical-only speech", "Threat indicator"], docsUrl: `${source}#in-game-companion-controls`, docsLabel: "Notification behavior",
  },
  {
    id: "safe-actions", category: "companion", status: "Playable now", surface: "In match", title: "Safe action proposals",
    summary: "The companion can propose a bounded order without silently taking control.",
    playerExperience: "Review a proposed action, confirm with Ctrl+Enter, reject with Ctrl+Backspace, or simply ignore it.",
    howItWorks: "Model output is translated into a small allowlist of validated OpenRA orders rather than arbitrary engine calls.",
    boundary: "No surrender, support powers, or hidden-information actions; confirmation is required unless AUTO was explicitly enabled.",
    proofPoints: ["Allowlisted actions", "Explicit confirmation", "Execution receipt"], docsUrl: `${source}#in-game-companion-controls`, docsLabel: "Action safety",
  },
  {
    id: "auto-command", category: "companion", status: "Playable now", surface: "In match", title: "Optional AUTO command",
    summary: "Delegate real-time play to OpenRA's native bot stack and take command back instantly.",
    playerExperience: "AUTO can handle economy, production, expansion, defense, and combat while the companion explains significant decisions.",
    howItWorks: "The feature uses the full ModularBot implementation, with voice or hotkey strategy changes for aggressive, defensive, naval, or adaptive play.",
    boundary: "AUTO is opt-in, visibly indicated, and can be stopped immediately with Ctrl+Shift+A.",
    proofPoints: ["Full ModularBot", "Strategy switching", "Instant take-back"], docsUrl: `${source}#in-game-companion-controls`, docsLabel: "AUTO controls",
  },
  {
    id: "fog-respecting-vision", category: "companion", status: "Playable now", surface: "In match", title: "Fog-respecting dual-view vision",
    summary: "The AI receives battlefield context without receiving information the player has not earned.",
    playerExperience: "Advice can account for the current viewport and remembered whole-map tactical state, including an attack already under way.",
    howItWorks: "Compact structured state is paired with a viewport image and a fog-filtered tactical overview for capable vision routes.",
    boundary: "Unexplored and currently hidden information is filtered before the observation reaches the model.",
    proofPoints: ["Viewport image", "Tactical overview", "Fog filter"], docsUrl: `${source}#in-game-companion-controls`, docsLabel: "Vision contract",
  },
  {
    id: "earth-recon", category: "earth", status: "Playable alpha", surface: "Web studio", title: "Earth reconnaissance",
    summary: "Search any place, move the live map, and define the real-world footprint that becomes the battlefield.",
    playerExperience: "Pin a landmark or region, inspect the source terrain, choose scale and mission shape, then create from the selected area.",
    howItWorks: "The studio combines map interaction, geocoding, satellite-style imagery, coordinates, and a deterministic mission blueprint.",
    boundary: "Source attribution and the selected geographic footprint remain visible before generation.",
    proofPoints: ["Place search", "Interactive map", "Scale-aware footprint"], docsUrl: `${source}#earth-mission-studio`, docsLabel: "Earth Mission Studio",
    searchTerms: ["satellite", "map", "location"],
  },
  {
    id: "terrain-understanding", category: "earth", status: "Playable alpha", surface: "Web + game", title: "Terrain understanding",
    summary: "Roads, waterways, built areas, vegetation, relief, and landmarks become explicit generation evidence.",
    playerExperience: "The generation pipeline shows what it is reading instead of hiding the source-to-map translation behind a spinner.",
    howItWorks: "Geographic data and the exact terrain view can be routed through a vision model, then normalized into an OpenRA-safe terrain plan.",
    boundary: "AI interpretation guides the plan; native OpenRA rules remain responsible for legal tiles and gameplay.",
    proofPoints: ["Exact terrain image", "Detected feature cards", "Visible pipeline"], docsUrl: `${source}#earth-mission-studio`, docsLabel: "Generation pipeline",
  },
  {
    id: "native-map-translation", category: "earth", status: "Playable alpha", surface: "Web + game", title: "Native OpenRA translation",
    summary: "Earth evidence becomes native terrain, resources, routes, spawn points, and an editable map package.",
    playerExperience: "The result looks and behaves like an OpenRA battlefield rather than a picture stamped onto a grid.",
    howItWorks: "A deterministic translator hands the terrain plan to OpenRA-compatible map generation primitives and packages map.bin, YAML, and metadata.",
    boundary: "The generator only emits known tiles, actors, and map structures supported by the selected mod.",
    proofPoints: ["Native tile vocabulary", "Resource placement", "Spawn generation"], docsUrl: `${source}#earth-mission-studio`, docsLabel: "Map package format",
  },
  {
    id: "map-validation", category: "earth", status: "Playable alpha", surface: "Web + game", title: "Passability + connectivity validation",
    summary: "A generated map must be traversable and playable before it is offered to the player.",
    playerExperience: "Validation reports route safety, connected starts, reachable resources, and legal map structure.",
    howItWorks: "Tracked-unit movement rules are used to test paths between spawn regions and key gameplay targets after terrain generation.",
    boundary: "Failed validation blocks the ready state instead of presenting an attractive but unusable map.",
    proofPoints: ["Tracked-unit paths", "Connected starts", "Reachable resources"], docsUrl: `${source}#earth-mission-studio`, docsLabel: "Validation contract",
  },
  {
    id: "oramap-export", category: "earth", status: "Playable alpha", surface: "Web studio", title: "Compile + share .oramap",
    summary: "The browser compiles a real map package that can move into the native game.",
    playerExperience: "Download the generated battlefield, install it locally, and reproduce the same terrain with the same mission blueprint and seed.",
    howItWorks: "The browser-side compiler builds a zipped .oramap with map data, rules, actors, and a source manifest.",
    boundary: "The package records its source and generation parameters so the result is inspectable and reproducible.",
    proofPoints: ["Real .oramap output", "Source manifest", "Deterministic seed"], docsUrl: `${source}#earth-mission-studio`, docsLabel: "Export workflow",
  },
  {
    id: "editor-handoff", category: "earth", status: "Development build", surface: "Native game", title: "Native editor handoff",
    summary: "Continue from generated terrain into OpenRA's map editor for authored objectives and polish.",
    playerExperience: "Start from a playable Earth-derived base, then refine terrain, actors, resources, and mission logic with native tools.",
    howItWorks: "Generated packages preserve normal OpenRA map structure instead of introducing a closed proprietary format.",
    boundary: "Generation accelerates the blank-canvas work; authors keep final creative and gameplay control.",
    proofPoints: ["Editable package", "Native editor", "Authored mission layer"], docsUrl: `${source}#earth-mission-studio`, docsLabel: "Editor workflow",
  },
  {
    id: "red-sea-2026", category: "theatres", status: "Playable alpha", surface: "Native game", title: "Red Sea 2026 campaign",
    summary: "A three-mission theatre proves RTS AI can ship authored experiences beyond generated skirmishes.",
    playerExperience: "Play Jizan Corridor, Hodeidah Lifeline, and Bab al-Mandab Passage as Saudi Arabia or Yemen.",
    howItWorks: "The theatre combines faction rules, objectives, bot priorities, localized voices, and source-dated mission contracts.",
    boundary: "It is an original fictional RTS scenario, not a claim of real-world prediction or simulation accuracy.",
    proofPoints: ["Three missions", "Two factions", "Bilingual radio"], docsUrl: `${source}/blob/main/docs/red-sea-2026.md`, docsLabel: "Theatre documentation",
  },
  {
    id: "iran-faction", category: "theatres", status: "Playable alpha", surface: "Native game", title: "Iran distributed-denial faction",
    summary: "A complete combined-arms roster turns distributed reconnaissance, layered air defense, drones, and littoral pressure into counterable RTS systems.",
    playerExperience: "Coordinate Karrar armor, Raad air defense, Fajr standoff fire, reusable and expendable UAVs, coastal forces, and the fictional Shadow One commando.",
    howItWorks: "Fourteen production roles use native OpenRA ammunition, rearming, stealth, targeting, naval movement, bot production, and prerequisite contracts.",
    boundary: "The roster is a fictional balanced interpretation grounded in dated capability sources, not an order of battle or claim about current readiness.",
    proofPoints: ["14 production roles", "10 doctrine contracts", "Live combat evidence"], docsUrl: `${source}/blob/main/docs/iran-faction-research.md`, docsLabel: "Research + gameplay translation",
  },
  {
    id: "turkey-faction", category: "theatres", status: "Playable alpha", surface: "Native game", title: "Türkiye combined-arms faction",
    summary: "A versatile mechanized force links armor, electronic warfare, drones, amphibious mobility, aircraft, and naval control.",
    playerExperience: "Field sixteen original combat actors through a full technology tree and play the Straits Shield land-air-sea mission.",
    howItWorks: "Original sprites, effects, voices, AI production rules, and one construction-enabled mission reuse OpenRA's native movement, rearm, naval, and bot systems.",
    boundary: "The fictional Anatolian Guard and Orion Group scenario avoid reproducing a real attack, deployment, or readiness assessment.",
    proofPoints: ["16 combat actors", "54 sprite packages", "Live AI progression"], docsUrl: `${source}/blob/main/docs/turkey-faction-validation.md`, docsLabel: "Delivery + validation record",
  },
  {
    id: "china-faction", category: "theatres", status: "Playable alpha", surface: "Native game", title: "China networked-force faction",
    summary: "A complete land, air, and naval roster explores how battlefield networking can become legible, counterable strategy gameplay.",
    playerExperience: "Use network specialists to coordinate armor, air defense, amphibious forces, aviation, and naval units in Haitian Network.",
    howItWorks: "Seventeen combat actors, original procedural effects, bilingual voice lines, bot rules, and native renderer evidence form a reproducible faction package.",
    boundary: "The faction is an original fictional RTS interpretation, not a simulation of a real operation or a claim about real-world force performance.",
    proofPoints: ["17 combat actors", "32 original effects", "Native renderer proof"], docsUrl: `${source}/blob/main/docs/china-faction-validation.md`, docsLabel: "Delivery + validation record",
  },
  {
    id: "original-theatre-assets", category: "theatres", status: "Playable alpha", surface: "Native game", title: "Original units, art + audio",
    summary: "Each faction track has its own recognizable battlefield identity instead of simply recoloring legacy content.",
    playerExperience: "Distinct rosters, directional vehicle sprites, faction-specific voices, UI art, effects, and battlefield evidence make every force feel authored.",
    howItWorks: "Assets and rules live in the mod structure, are audited against OpenRA's directional, palette, and packaging requirements, and are indexed into the public build archive.",
    boundary: "Assets are original or appropriately licensed and remain separate from private model infrastructure.",
    proofPoints: ["216 visual artifacts", "4 faction tracks", "Native render evidence"], docsUrl: `${source}/blob/main/docs/red-sea-2026.md`, docsLabel: "Asset inventory",
  },
  {
    id: "reusable-theatres", category: "theatres", status: "In progress", surface: "Platform", title: "Reusable theatre framework",
    summary: "Red Sea 2026 is the first instance of a broader system for complete new mods and campaigns.",
    playerExperience: "Future releases can introduce new factions, units, stories, voices, maps, and rules without rewriting the core platform.",
    howItWorks: "Shared platform contracts separate companion capabilities, Earth generation, distribution, and theatre-specific content.",
    boundary: "Future theatres are a roadmap direction; only shipped builds are labeled playable.",
    proofPoints: ["Mod boundaries", "Replaceable showcase", "Shared AI contracts"], docsUrl: `${source}`, docsLabel: "Game repository",
  },
  {
    id: "headless-commander", category: "agents", status: "Research track", surface: "Local tools", title: "Headless autonomous commander",
    summary: "An agent can observe and command local OpenRA matches through a bounded tool surface.",
    playerExperience: "Developers can run repeatable experiments in which an agent plays a match, records evidence, and explains its decisions.",
    howItWorks: "A local MCP server exposes a safe observation and action allowlist to an Agents SDK commander.",
    boundary: "Autoplay requires explicit authorization and the tool surface excludes destructive or hidden-information actions.",
    proofPoints: ["Local MCP server", "Safe action allowlist", "Headless runs"], docsUrl: `${source}#autonomous-agent-research`, docsLabel: "Agent research",
  },
  {
    id: "agent-learning-loop", category: "agents", status: "Research track", surface: "Local tools", title: "Evidence, grading + lessons",
    summary: "Agent experiments can become durable learning rather than isolated playthroughs.",
    playerExperience: "Each attempt leaves a readable trail: observations, actions, outcomes, grades, and lessons for the next run.",
    howItWorks: "Run evidence is graded against explicit objectives and condensed lessons are injected into subsequent attempts.",
    boundary: "Learning artifacts are local, inspectable, and do not silently modify the shipped game bot.",
    proofPoints: ["Evidence logs", "Outcome grading", "Lesson injection"], docsUrl: `${source}#autonomous-agent-research`, docsLabel: "Learning loop",
  },
  {
    id: "provider-neutral-routing", category: "ai-layer", status: "Playable now", surface: "AI layer", title: "Provider-neutral AI routing",
    summary: "The game asks for named capabilities rather than hard-coding a model company or machine.",
    playerExperience: "Players can use hosted models for simplicity or local routes for privacy, latency, and cost control.",
    howItWorks: "Companion text, terrain vision, transcription, and speech are independent routes behind one generic AI layer contract.",
    boundary: "Provider credentials stay outside the game and private infrastructure names never appear in the public product.",
    proofPoints: ["Named capabilities", "Cloud or local", "No provider lock-in"], docsUrl: `${source}#models`, docsLabel: "Model routes",
    searchTerms: ["openai", "anthropic", "claude", "ollama", "local model"],
  },
  {
    id: "local-ai-pack", category: "ai-layer", status: "Development build", surface: "Local install", title: "Optional Local AI Pack",
    summary: "Install a curated local route bundle without loading every model into memory at startup.",
    playerExperience: "Download the pack separately, choose local capabilities, and keep core gameplay usable when no model is running.",
    howItWorks: "The pack prepares routes for battlefield language/vision, transcription, and speech; each capability can be started independently.",
    boundary: "Local AI is optional, hardware-dependent, and never required to launch or play OpenRA AI.",
    proofPoints: ["Qwen3-VL route", "Local Whisper", "Local Kokoro"], docsUrl: `${source}#models`, docsLabel: "Local models",
  },
  {
    id: "in-game-ai-settings", category: "ai-layer", status: "Playable now", surface: "Native game", title: "In-game AI settings + cost view",
    summary: "Configure provider, model routes, voice behavior, pace, and connection health from the game.",
    playerExperience: "Friendly presets keep the common path simple while advanced routing and masked credentials remain available when needed.",
    howItWorks: "Settings map friendly provider/model choices to AI-layer routes and estimate text, transcription, and speech usage.",
    boundary: "Secrets are masked, advanced details are collapsed, and no endpoint is required for standard hosted-provider presets.",
    proofPoints: ["Provider presets", "Connection test", "Session cost estimate"], docsUrl: `${source}#ai-availability-and-settings`, docsLabel: "AI settings",
  },
  {
    id: "verified-windows-release", category: "delivery", status: "Playable now", surface: "Download", title: "Verified Windows release",
    summary: "A setup installer and portable archive provide a direct path from the website into the native game.",
    playerExperience: "Download a versioned build, verify its checksum, install or extract it, and launch the companion or current theatre.",
    howItWorks: "The web app discovers real release assets and exposes version, size, checksum, and local smoke-test status.",
    boundary: "The site never presents a placeholder as a working download.",
    proofPoints: ["Setup installer", "Portable ZIP", "Published checksums"], docsUrl: `${source}/releases`, docsLabel: "Game releases",
  },
  {
    id: "web-mission-accounts", category: "delivery", status: "Playable alpha", surface: "Web app", title: "Accounts, blueprints + feedback",
    summary: "The web surface supports signed-in AI work, mission blueprints, release discovery, and contextual feedback.",
    playerExperience: "Sign in with Google or email, create a mission package, download the game, and report feedback with the relevant page context.",
    howItWorks: "Firebase authentication gates AI-backed work while private analytics use pseudonymous account identifiers.",
    boundary: "Names and emails are not sent as analytics event parameters; written feedback is handled separately.",
    proofPoints: ["Google sign-in", "Mission package export", "Contextual feedback"], docsUrl: "https://rtsai.net/privacy", docsLabel: "Privacy details",
  },
  {
    id: "macos-release", category: "delivery", status: "Playable now", surface: "Download", title: "Signed macOS release",
    summary: "A signed, Apple-notarized, and stapled Apple silicon DMG provides a direct path into the native game.",
    playerExperience: "Download the disk image, copy OpenRA AI to Applications, and launch the same companion and creation experience available on Windows.",
    howItWorks: "Release discovery exposes the published arm64 DMG, version, size, and checksum alongside the Windows packages.",
    boundary: "Only the published Apple silicon package is labeled ready; an Intel build is not advertised until a real artifact exists.",
    proofPoints: ["Developer ID signature", "Apple notarization", "Published checksum"], docsUrl: `${source}/releases`, docsLabel: "Game releases",
  },
];

export const capabilitiesById = Object.fromEntries(capabilities.map((capability) => [capability.id, capability])) as Record<string, Capability>;
