import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [tag, signatureArgument] = process.argv.slice(2);
const signatureStatus = signatureArgument?.replace("--windows-authenticode=", "");
if (!/^v[0-9]/.test(tag ?? "") || !["verified", "unsigned"].includes(signatureStatus)) {
  throw new Error(
    "Usage: npm run sync:release -- v0.1.0-alpha.14 --windows-authenticode=verified|unsigned",
  );
}

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "rtsai-release-manifest-sync",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

async function json(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GitHub request failed (${response.status}): ${url}`);
  return response.json();
}

const release = await json(`https://api.github.com/repos/alibad/OpenRA-AI/releases/tags/${tag}`);
if (release.draft) throw new Error(`${tag} is still a draft release`);

const version = tag.slice(1);
const assets = new Map(release.assets.map((asset) => [asset.name, asset]));
function requiredAsset(name) {
  const asset = assets.get(name);
  if (!asset) throw new Error(`Release asset is missing: ${name}`);
  return asset;
}

const indexAsset = requiredAsset(`OpenRA-AI-${version}-release-index.json`);
const index = await json(indexAsset.browser_download_url);
if (index.version !== version || !/^[a-f0-9]{40}$/.test(index.product_commit) || !/^[a-f0-9]{40}$/.test(index.engine_commit)) {
  throw new Error("Release index version or commit metadata is invalid");
}

function record(name) {
  const asset = requiredAsset(name);
  return { url: asset.browser_download_url, sizeBytes: asset.size };
}

const archive = record(`OpenRA-AI-${version}-windows-x64.zip`);
const archiveChecksum = record(`OpenRA-AI-${version}-windows-x64.zip.sha256`);
const installer = record(`OpenRA-AI-${version}-windows-x64-setup.exe`);
const installerChecksum = record(`OpenRA-AI-${version}-windows-x64-setup.exe.sha256`);
const aiPack = record(`OpenRA-AI-AI-Pack-${version}-windows-x64.zip`);
const aiPackChecksum = record(`OpenRA-AI-AI-Pack-${version}-windows-x64.zip.sha256`);
const macAssets = release.assets
  .filter((asset) => new RegExp(`OpenRA-AI-${version}-macos-(arm64|x64)\\.dmg$`).test(asset.name))
  .map((asset) => {
    const architecture = asset.name.endsWith("-arm64.dmg") ? "arm64" : "x64";
    const checksum = requiredAsset(`${asset.name}.sha256`);
    return {
      architecture,
      url: asset.browser_download_url,
      checksumUrl: checksum.browser_download_url,
      sizeBytes: asset.size,
    };
  });

const manifest = {
  schemaVersion: 1,
  productCommit: index.product_commit,
  engineCommit: index.engine_commit,
  windows: {
    version,
    url: archive.url,
    checksumUrl: archiveChecksum.url,
    sizeBytes: archive.sizeBytes,
    publishedAt: release.published_at,
    installerUrl: installer.url,
    installerChecksumUrl: installerChecksum.url,
    installerSizeBytes: installer.sizeBytes,
    aiPackUrl: aiPack.url,
    aiPackChecksumUrl: aiPackChecksum.url,
    aiPackSizeBytes: aiPack.sizeBytes,
    authenticode: signatureStatus,
  },
  macos: macAssets.length ? {
    version,
    publishedAt: release.published_at,
    developerIdSigned: true,
    notarized: true,
    stapled: true,
    assets: macAssets,
  } : null,
};

const output = resolve("data/openra-ai-release.json");
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Updated ${output} from ${tag}; run the release-manifest tests before publishing.`);
