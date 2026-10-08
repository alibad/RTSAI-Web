/**
 * Shared rules for `data/rtsai-mod-release.json`, the committed manifest of the
 * RTS AI mod's public release (GitHub releases of alibad/RTSAI-Mod).
 *
 * Plain JavaScript so both the site (lib/mod-release.ts) and the Node sync
 * script (scripts/sync-mod-release.mjs) apply exactly the same checks. The
 * site never renders a download that fails them.
 */

export const MOD_REPOSITORY = "alibad/RTSAI-Mod";
export const MOD_ASSET_KINDS = ["installer", "portable", "ai-pack", "other"];
export const MOD_PLATFORMS = ["windows-x64", "windows-x86", "macos", "linux", "any"];
/** Co-commander modes a release's installer offers besides "No AI". Empty: the download has no co-commander. */
export const MOD_AI_MODES = ["hosted", "local"];

const SHA256 = /^[a-f0-9]{64}$/;
const TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Files that only carry checksums or signatures; they are used, never listed as downloads.
 * @param {string} name
 */
export function isChecksumFile(name) {
  const lower = name.toLowerCase();
  return lower.endsWith(".sha256") || lower.endsWith(".sha256sum") || lower.endsWith(".sig") || lower.endsWith(".asc")
    || /^(sha256sums|checksums)(\.txt)?$/.test(lower) || lower.endsWith(".sha256sums") || lower.endsWith("-checksums.txt");
}

/**
 * Classifies a release asset by its file name (the OpenRA Mod SDK naming plus an optional AI pack).
 * @param {string} name
 * @returns {{ kind: "installer" | "portable" | "ai-pack" | "other", platform: "windows-x64" | "windows-x86" | "macos" | "linux" | "any" }}
 */
export function classifyAsset(name) {
  const lower = name.toLowerCase();
  const platform = lower.endsWith(".dmg")
    ? "macos"
    : lower.endsWith(".appimage")
      ? "linux"
      : /(?:^|[-_.])(?:x86|win32)(?:[-_.]|$)/.test(lower)
        ? "windows-x86"
        : lower.endsWith(".exe") || /win|windows|x64/.test(lower)
          ? "windows-x64"
          : "any";
  if (/ai[-_.]?pack|voice[-_.]?pack|model[-_.]?pack/.test(lower)) return { kind: "ai-pack", platform };
  if (lower.endsWith(".exe") && !lower.includes("uninstall")) return { kind: "installer", platform };
  if (lower.endsWith(".zip") && /portable|win/.test(lower)) return { kind: "portable", platform };
  if (lower.endsWith(".dmg") || lower.endsWith(".appimage")) return { kind: "installer", platform };
  return { kind: "other", platform };
}

export function emptyModRelease() {
  return {
    schemaVersion: 1,
    repository: MOD_REPOSITORY,
    published: false,
    version: null,
    tag: null,
    publishedAt: null,
    releaseUrl: null,
    signed: false,
    ra2FactionIds: [],
    aiModes: [],
    assets: [],
  };
}

/**
 * Returns every problem with a manifest (empty when it is valid). An
 * unpublished manifest must carry no downloads; a published one needs a
 * version, a Windows installer and, for every asset, a GitHub release URL on
 * the declared tag, a size and a SHA-256 digest.
 */
/**
 * @param {any} manifest
 * @param {readonly string[] | null} [knownFactionIds]
 * @returns {string[]}
 */
export function validateModRelease(manifest, knownFactionIds = null) {
  const problems = [];
  if (!manifest || typeof manifest !== "object") return ["manifest is not an object"];
  if (manifest.schemaVersion !== 1) problems.push("schemaVersion must be 1");
  if (manifest.repository !== MOD_REPOSITORY) problems.push(`repository must be ${MOD_REPOSITORY}`);
  if (typeof manifest.published !== "boolean") problems.push("published must be a boolean");
  if (typeof manifest.signed !== "boolean") problems.push("signed must be a boolean");
  if (!Array.isArray(manifest.assets)) problems.push("assets must be an array");
  if (!Array.isArray(manifest.ra2FactionIds)) problems.push("ra2FactionIds must be an array");
  // Optional for manifests written before it existed; missing means no co-commander is claimed.
  if (manifest.aiModes !== undefined && !Array.isArray(manifest.aiModes)) problems.push("aiModes must be an array");
  if (problems.length) return problems;
  const aiModes = manifest.aiModes ?? [];
  for (const mode of aiModes) if (!MOD_AI_MODES.includes(mode)) problems.push(`unknown AI mode: ${mode}`);
  if (new Set(aiModes).size !== aiModes.length) problems.push("aiModes lists a mode twice");

  if (knownFactionIds) {
    for (const id of manifest.ra2FactionIds) if (!knownFactionIds.includes(id)) problems.push(`unknown faction id: ${id}`);
  }
  if (!manifest.published) {
    if (manifest.assets.length) problems.push("an unpublished manifest must not list downloads");
    if (manifest.ra2FactionIds.length) problems.push("an unpublished manifest must not claim factions");
    if (aiModes.length) problems.push("an unpublished manifest must not claim AI modes");
    if (manifest.signed) problems.push("an unpublished manifest cannot be signed");
    return problems;
  }

  if (typeof manifest.tag !== "string" || !TAG.test(manifest.tag)) problems.push("tag must look like v1.2.3 or v1.2.3-alpha.1");
  if (manifest.version !== manifest.tag?.slice(1)) problems.push("version must equal the tag without its leading v");
  if (typeof manifest.publishedAt !== "string" || Number.isNaN(Date.parse(manifest.publishedAt))) problems.push("publishedAt must be an ISO date");
  if (manifest.releaseUrl !== `https://github.com/${MOD_REPOSITORY}/releases/tag/${manifest.tag}`) problems.push("releaseUrl must be the GitHub release page");
  const prefix = `https://github.com/${MOD_REPOSITORY}/releases/download/${manifest.tag}/`;
  const names = new Set();
  for (const asset of manifest.assets) {
    const label = asset?.name ?? "(unnamed asset)";
    if (typeof asset?.name !== "string" || !asset.name || asset.name.includes("/")) problems.push(`${label}: invalid name`);
    if (names.has(asset?.name)) problems.push(`${label}: listed twice`);
    names.add(asset?.name);
    if (!MOD_ASSET_KINDS.includes(asset?.kind)) problems.push(`${label}: unknown kind`);
    if (!MOD_PLATFORMS.includes(asset?.platform)) problems.push(`${label}: unknown platform`);
    if (![`${prefix}${asset?.name}`, `${prefix}${encodeURIComponent(asset?.name ?? "")}`].includes(asset?.url)) problems.push(`${label}: url must be ${prefix}<name>`);
    if (!Number.isInteger(asset?.sizeBytes) || asset.sizeBytes <= 0) problems.push(`${label}: sizeBytes must be a positive integer`);
    if (typeof asset?.sha256 !== "string" || !SHA256.test(asset.sha256)) problems.push(`${label}: sha256 must be 64 lowercase hex characters`);
  }
  if (!manifest.assets.some((asset) => asset?.kind === "installer" && asset?.platform === "windows-x64")) {
    problems.push("a published release needs a Windows x64 installer");
  }
  return problems;
}
