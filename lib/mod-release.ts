import manifest from "../data/rtsai-mod-release.json";
import { validateModRelease } from "./mod-release-manifest.mjs";

/**
 * The RTS AI mod's public release, read only from the committed
 * `data/rtsai-mod-release.json` (filled by `npm run sync:mod-release`), so
 * rendering never waits on GitHub. Until a release is published the site shows
 * "coming soon" and renders no mod download links.
 */

/** The ownership requirement, word for word wherever the site offers the mod. */
export const RA2_REQUIREMENT = "You need your own Red Alert 2 (Steam, EA app or disc). The mod imports it on first launch; we never ship EA's files.";

export type ModAssetKind = "installer" | "portable" | "ai-pack" | "other";
export type ModPlatform = "windows-x64" | "windows-x86" | "macos" | "linux" | "any";
export type ModAIMode = "hosted" | "local";

export type ModReleaseAsset = {
  name: string;
  kind: ModAssetKind;
  platform: ModPlatform;
  url: string;
  sizeBytes: number;
  sha256: string;
};

export type ModRelease = {
  schemaVersion: 1;
  repository: string;
  published: boolean;
  version: string | null;
  tag: string | null;
  publishedAt: string | null;
  releaseUrl: string | null;
  signed: boolean;
  /** RA2 factions this release was verified to include. Empty means none is claimed. */
  ra2FactionIds: string[];
  /** Co-commander modes the installer offers besides "No AI". Empty means the download has no co-commander. */
  aiModes: ModAIMode[];
  assets: ModReleaseAsset[];
};

export type PublishedModRelease = ModRelease & { published: true; version: string; tag: string; publishedAt: string; releaseUrl: string };

/** Returns the committed release, treating an invalid manifest as unpublished (fail closed). */
export function modReleaseFrom(value: unknown): ModRelease {
  const candidate = value as ModRelease;
  const problems = validateModRelease(candidate);
  if (problems.length || !candidate.published) {
    return {
      schemaVersion: 1,
      repository: "alibad/RTSAI-Mod",
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
  // Manifests written before aiModes existed claim no co-commander.
  return { ...candidate, aiModes: candidate.aiModes ?? [] };
}

export function getModRelease(): ModRelease {
  return modReleaseFrom(manifest);
}

export function isPublished(release: ModRelease): release is PublishedModRelease {
  return release.published;
}

export function windowsInstaller(release: ModRelease) {
  return release.assets.find((asset) => asset.kind === "installer" && asset.platform === "windows-x64") ?? null;
}

export function macInstaller(release: ModRelease) {
  return release.assets.find((asset) => asset.kind === "installer" && asset.platform === "macos") ?? null;
}
