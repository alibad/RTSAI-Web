import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { classifyAsset, isChecksumFile, MOD_REPOSITORY, validateModRelease } from "../lib/mod-release-manifest.mjs";

/**
 * Fills data/rtsai-mod-release.json from a published GitHub release of
 * alibad/RTSAI-Mod:
 *
 *   npm run sync:mod-release -- v0.2.0-alpha.1
 *   npm run sync:mod-release -- v0.2.0-alpha.1 --factions=china,iran,turkey,saudi-arabia,yemen
 *   npm run sync:mod-release -- v0.2.0-alpha.1 --signed      (Windows: verifies Authenticode first)
 *   npm run sync:mod-release -- v0.2.0-alpha.1 --dry-run
 *
 * Every downloadable asset needs a published SHA-256: GitHub's asset digest, a
 * `<name>.sha256` file, or a SHA256SUMS/checksums file in the same release.
 * When more than one is present they must agree. `signed` stays false unless
 * --signed is passed and the downloaded installer's digest matches and its
 * Authenticode signature is Valid. `ra2FactionIds` stays empty unless
 * --factions names the RA2 factions verified in this build.
 */

const API = `https://api.github.com/repos/${MOD_REPOSITORY}`;

function parseDigest(value) {
  const match = /^sha256:([a-f0-9]{64})$/i.exec(value ?? "");
  return match ? match[1].toLowerCase() : null;
}

/**
 * Parses `<hex>  <name>` or `<hex> *<name>` lines; a bare digest applies to `fallbackName`.
 * @param {string} text
 * @param {string | null} [fallbackName]
 * @returns {Map<string, string>}
 */
export function parseChecksums(text, fallbackName = null) {
  const digests = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{64})(?:\s+\*?(.+))?$/.exec(line.trim());
    if (!match) continue;
    const name = match[2]?.trim().replace(/^.*[\\/]/, "") || fallbackName;
    if (name) digests.set(name, match[1].toLowerCase());
  }
  return digests;
}

/**
 * Builds the manifest from GitHub. `fetchJson` and `fetchText` are injected so
 * tests can run without the network.
 *
 * @param {{
 *   tag: string,
 *   fetchJson: (url: string) => Promise<any>,
 *   fetchText: (url: string) => Promise<string>,
 *   ra2FactionIds?: string[],
 *   knownFactionIds?: string[] | null,
 *   signed?: boolean,
 * }} options
 */
export async function buildModRelease({ tag, fetchJson, fetchText, ra2FactionIds = [], knownFactionIds = null, signed = false }) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag ?? "")) throw new Error(`Not a release tag: ${tag}`);
  const repository = await fetchJson(API);
  if (repository.private) throw new Error(`${MOD_REPOSITORY} is private, so players could not download its assets. Make it public first.`);
  const release = await fetchJson(`${API}/releases/tags/${encodeURIComponent(tag)}`);
  if (release.draft) throw new Error(`${tag} is still a draft release`);
  if (release.tag_name !== tag) throw new Error(`GitHub returned ${release.tag_name} for ${tag}`);

  const uploaded = (release.assets ?? []).filter((asset) => asset.state === "uploaded");
  const sidecars = new Map();
  const sums = new Map();
  for (const asset of uploaded.filter((item) => isChecksumFile(item.name))) {
    const lower = asset.name.toLowerCase();
    if (lower.endsWith(".sig") || lower.endsWith(".asc")) continue;
    const target = lower.endsWith(".sha256") ? asset.name.slice(0, -".sha256".length) : null;
    const parsed = parseChecksums(await fetchText(asset.browser_download_url), target);
    for (const [name, digest] of parsed) (target ? sidecars : sums).set(name, digest);
  }

  const assets = [];
  for (const asset of uploaded.filter((item) => !isChecksumFile(item.name))) {
    const candidates = [parseDigest(asset.digest), sidecars.get(asset.name), sums.get(asset.name)].filter(Boolean);
    if (!candidates.length) throw new Error(`No published SHA-256 for ${asset.name}: add ${asset.name}.sha256 or a SHA256SUMS file to the release`);
    if (new Set(candidates).size > 1) throw new Error(`Published SHA-256 values disagree for ${asset.name}`);
    assets.push({
      name: asset.name,
      ...classifyAsset(asset.name),
      url: asset.browser_download_url,
      sizeBytes: asset.size,
      sha256: candidates[0],
    });
  }
  const order = { installer: 0, portable: 1, "ai-pack": 2, other: 3 };
  assets.sort((a, b) => order[a.kind] - order[b.kind] || a.platform.localeCompare(b.platform) || a.name.localeCompare(b.name));

  const manifest = {
    schemaVersion: 1,
    repository: MOD_REPOSITORY,
    published: true,
    version: tag.slice(1),
    tag,
    publishedAt: release.published_at,
    releaseUrl: `https://github.com/${MOD_REPOSITORY}/releases/tag/${tag}`,
    signed,
    ra2FactionIds,
    assets,
  };
  const problems = validateModRelease(manifest, knownFactionIds);
  if (problems.length) throw new Error(`The release cannot be published on rtsai.net:\n- ${problems.join("\n- ")}`);
  return manifest;
}

async function verifyAuthenticode(asset) {
  if (process.platform !== "win32") throw new Error("--signed needs Windows to check the Authenticode signature");
  const directory = await mkdtemp(join(tmpdir(), "rtsai-mod-"));
  const path = join(directory, asset.name);
  try {
    const response = await fetch(asset.url);
    if (!response.ok || !response.body) throw new Error(`Cannot download ${asset.name} (${response.status})`);
    const hash = createHash("sha256");
    const file = createWriteStream(path);
    for await (const chunk of response.body) {
      hash.update(chunk);
      if (!file.write(chunk)) await new Promise((done) => file.once("drain", done));
    }
    await new Promise((done, fail) => file.end((error) => (error ? fail(error) : done())));
    const digest = hash.digest("hex");
    if (digest !== asset.sha256) throw new Error(`${asset.name} digest ${digest} differs from the published ${asset.sha256}`);
    const check = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-AuthenticodeSignature -LiteralPath '${path.replace(/'/g, "''")}').Status`], { encoding: "utf8" });
    const status = check.stdout.trim();
    if (status !== "Valid") throw new Error(`${asset.name} Authenticode status is "${status || check.stderr.trim()}", not Valid`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function main(argv) {
  const [tag, ...flags] = argv;
  const flag = (name) => flags.find((item) => item === `--${name}` || item.startsWith(`--${name}=`));
  const unknown = flags.filter((item) => !/^--(signed|dry-run|factions=.*)$/.test(item));
  if (!tag || unknown.length) {
    throw new Error("Usage: npm run sync:mod-release -- v0.2.0-alpha.1 [--factions=china,iran,...] [--signed] [--dry-run]");
  }
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "rtsai-mod-release-sync",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
  };
  const fetchJson = async (url) => {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`GitHub request failed (${response.status}): ${url}`);
    return response.json();
  };
  // Public assets are fetched without credentials, exactly as a player would.
  const fetchText = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Cannot read ${url} (${response.status})`);
    return response.text();
  };
  const catalog = JSON.parse(await readFile(resolve("data/factions.generated.json"), "utf8")).catalog;
  const knownFactionIds = catalog.factions.filter((faction) => faction.variants?.ra2?.status === "implemented").map((faction) => faction.id);
  const factionList = flag("factions")?.slice("--factions=".length) ?? "";
  const ra2FactionIds = factionList && factionList !== "none" ? factionList.split(",").map((id) => id.trim()).filter(Boolean) : [];

  const manifest = await buildModRelease({ tag, fetchJson, fetchText, ra2FactionIds, knownFactionIds, signed: false });
  if (flag("signed")) {
    const installer = manifest.assets.find((asset) => asset.kind === "installer" && asset.platform === "windows-x64");
    await verifyAuthenticode(installer);
    manifest.signed = true;
  }
  const output = `${JSON.stringify(manifest, null, 2)}\n`;
  if (flag("dry-run")) {
    process.stdout.write(output);
    return;
  }
  const path = resolve("data/rtsai-mod-release.json");
  await writeFile(path, output, "utf8");
  console.log(`Updated ${path} from ${tag}: ${manifest.assets.length} assets, ${manifest.signed ? "signed" : "unsigned"}, ${manifest.ra2FactionIds.length} RA2 factions claimed.`);
  console.log("Run npm test, review the diff, then commit.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
