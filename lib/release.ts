import releaseManifest from "../data/openra-ai-release.json";

export type WindowsRelease = {
  version: string;
  url: string;
  checksumUrl: string;
  sizeBytes: number | null;
  publishedAt: string | null;
  installerUrl: string | null;
  installerChecksumUrl: string | null;
  installerSizeBytes: number | null;
  aiPackUrl: string | null;
  aiPackChecksumUrl: string | null;
  aiPackSizeBytes: number | null;
  authenticode: "verified" | "unsigned";
};

export type MacOSReleaseAsset = {
  architecture: "arm64" | "x64";
  url: string;
  checksumUrl: string | null;
  sizeBytes: number | null;
};

export type MacOSRelease = {
  version: string;
  publishedAt: string | null;
  developerIdSigned: boolean;
  notarized: boolean;
  stapled: boolean;
  assets: MacOSReleaseAsset[];
};

export type GameRelease = {
  productCommit: string;
  engineCommit: string;
  windows: WindowsRelease;
  macos: MacOSRelease | null;
};

type ReleaseManifest = GameRelease & { schemaVersion: 1 };

function committedRelease(): GameRelease {
  const manifest = releaseManifest as ReleaseManifest;
  if (manifest.schemaVersion !== 1) throw new Error("Unsupported OpenRA AI release manifest");
  if (manifest.windows.authenticode !== "verified" && manifest.windows.authenticode !== "unsigned") {
    throw new Error("Invalid Windows Authenticode status in release manifest");
  }

  return {
    productCommit: manifest.productCommit,
    engineCommit: manifest.engineCommit,
    windows: manifest.windows,
    macos: manifest.macos,
  };
}

export async function getGameRelease(): Promise<GameRelease> {
  return committedRelease();
}

export async function getWindowsRelease(): Promise<WindowsRelease> {
  return committedRelease().windows;
}
