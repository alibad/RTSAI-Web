import manifest from "../data/rtsai-mac-release.json";

export type MacAlphaRelease = {
  schemaVersion: 1;
  repository: "alibad/RTSAI-Mod";
  published: true;
  prerelease: true;
  tag: string;
  internalVersion: string;
  publishedAt: string;
  releaseUrl: string;
  minimumMacOS: "15.0";
  // "developer-id": signed by Human Quest LLC's Developer ID since the 16 Nov 2026 build; still not notarized.
  signing: "ad-hoc" | "developer-id";
  notarized: false;
  gameArchitectures: ["arm64", "x64"];
  companionArchitecture: "arm64";
  modelsIncluded: false;
  hostedEnabled: false;
  asset: { name: string; url: string; sizeBytes: number; sha256: string };
};

export function macReleaseFrom(value: unknown): MacAlphaRelease | null {
  if (!value || typeof value !== "object") return null;
  const release = value as MacAlphaRelease;
  const asset = release.asset;
  if (release.schemaVersion !== 1 || release.repository !== "alibad/RTSAI-Mod"
    || release.published !== true || release.prerelease !== true
    || !/^v\d+\.\d+\.\d+-macos-alpha\.[0-9]+(\.[0-9]+)?$/.test(release.tag ?? "")
    || !/^[a-zA-Z0-9.-]+$/.test(release.internalVersion ?? "")
    || !Number.isFinite(Date.parse(release.publishedAt ?? ""))
    || release.releaseUrl !== `https://github.com/alibad/RTSAI-Mod/releases/tag/${release.tag}`
    || release.minimumMacOS !== "15.0" || !["ad-hoc", "developer-id"].includes(release.signing) || release.notarized !== false
    || JSON.stringify(release.gameArchitectures) !== '["arm64","x64"]'
    || release.companionArchitecture !== "arm64" || release.modelsIncluded !== false || release.hostedEnabled !== false
    || !asset || !/^RTSAI-[a-zA-Z0-9.-]+-macos\.dmg$/.test(asset.name ?? "")
    || asset.url !== `https://github.com/alibad/RTSAI-Mod/releases/download/${release.tag}/${asset.name}`
    || !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes <= 0
    || !/^[a-f0-9]{64}$/.test(asset.sha256 ?? "")) return null;
  return release;
}

/** How the Mac app is signed, in one sentence for the download and companion pages. */
export function macSigningSentence(release: MacAlphaRelease | null): string {
  return release?.signing === "developer-id"
    ? "It is signed with Human Quest LLC's Developer ID but not notarized yet."
    : "It uses an ad-hoc signature and is not notarized.";
}

export function getMacAlphaRelease(): MacAlphaRelease | null {
  return macReleaseFrom(manifest);
}
