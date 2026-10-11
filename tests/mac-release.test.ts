import assert from "node:assert/strict";
import test from "node:test";
import { macReleaseFrom } from "../lib/mac-release";

const release = {
  schemaVersion: 1, repository: "alibad/RTSAI-Mod", published: true, prerelease: true,
  tag: "v0.4.0-macos-alpha.20261011", internalVersion: "s07-native", publishedAt: "2026-10-11T00:00:00Z",
  releaseUrl: "https://github.com/alibad/RTSAI-Mod/releases/tag/v0.4.0-macos-alpha.20261011",
  minimumMacOS: "15.0", signing: "ad-hoc", notarized: false, gameArchitectures: ["arm64", "x64"],
  companionArchitecture: "arm64", modelsIncluded: false, hostedEnabled: false,
  asset: { name: "RTSAI-s07-native-macos.dmg", url: "https://github.com/alibad/RTSAI-Mod/releases/download/v0.4.0-macos-alpha.20261011/RTSAI-s07-native-macos.dmg", sizeBytes: 258421906, sha256: "8abe4af498ce6fbfc95b27cb7d4065f877ab57626cb3a79d8fdfa61e902f2199" },
};

test("Mac alpha can be published independently of the preserved Windows release", () => {
  assert.equal(macReleaseFrom(release)?.asset.sha256, release.asset.sha256);
});

test("unpublished, incomplete and misleading Mac records cannot expose a download", () => {
  for (const value of [null, {}, { ...release, published: false }, { ...release, notarized: true },
    { ...release, companionArchitecture: "x64" }, { ...release, minimumMacOS: "14.0" },
    { ...release, modelsIncluded: true }, { ...release, hostedEnabled: true },
    { ...release, asset: { ...release.asset, sha256: "" } },
    { ...release, asset: { ...release.asset, url: "https://example.com/unverified.dmg" } }]) {
    assert.equal(macReleaseFrom(value), null);
  }
});
