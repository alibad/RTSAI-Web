import assert from "node:assert/strict";
import test from "node:test";
import { macReleaseFrom, macSigningSentence } from "../lib/mac-release";

const release = {
  schemaVersion: 1, repository: "alibad/RTSAI-Mod", published: true, prerelease: true,
  tag: "v0.4.0-macos-alpha.20261011", internalVersion: "s07-native", publishedAt: "2026-10-11T00:00:00Z",
  releaseUrl: "https://github.com/alibad/RTSAI-Mod/releases/tag/v0.4.0-macos-alpha.20261011",
  minimumMacOS: "15.0", signing: "ad-hoc", notarized: false, gameArchitectures: ["arm64", "x64"],
  companionArchitecture: "arm64", modelsIncluded: false, hostedEnabled: false,
  asset: { name: "RTSAI-s07-native-macos.dmg", url: "https://github.com/alibad/RTSAI-Mod/releases/download/v0.4.0-macos-alpha.20261011/RTSAI-s07-native-macos.dmg", sizeBytes: 258421906, sha256: "8abe4af498ce6fbfc95b27cb7d4065f877ab57626cb3a79d8fdfa61e902f2199" },
};

// The 16 Nov 2026 build: a point release (".2" after the date) signed with a Developer ID, still not notarized.
const developerId = {
  ...release, tag: "v0.4.0-macos-alpha.20261116.2", internalVersion: "0.4.0-macos-alpha.20261116.2",
  publishedAt: "2026-11-16T15:49:52Z", signing: "developer-id",
  releaseUrl: "https://github.com/alibad/RTSAI-Mod/releases/tag/v0.4.0-macos-alpha.20261116.2",
  asset: { name: "RTSAI-0.4.0-macos-alpha.20261116.2-macos.dmg", url: "https://github.com/alibad/RTSAI-Mod/releases/download/v0.4.0-macos-alpha.20261116.2/RTSAI-0.4.0-macos-alpha.20261116.2-macos.dmg", sizeBytes: 379639437, sha256: "dd2f791c0318bc026af5260c181f65bbae40e425b9d63ac89cb5b041cd75ea1b" },
};

test("Mac alpha can be published independently of the preserved Windows release", () => {
  assert.equal(macReleaseFrom(release)?.asset.sha256, release.asset.sha256);
  assert.equal(macReleaseFrom(developerId)?.asset.sha256, developerId.asset.sha256);
});

test("the page says how the Mac app is signed, and never that it is notarized", () => {
  assert.match(macSigningSentence(macReleaseFrom(developerId)), /Developer ID but not notarized/);
  assert.match(macSigningSentence(macReleaseFrom(release)), /ad-hoc signature and is not notarized/);
  assert.equal(macReleaseFrom({ ...developerId, signing: "notarized" }), null);
  assert.equal(macReleaseFrom({ ...developerId, tag: "v0.4.0-macos-alpha.20261116.2.1" }), null);
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
