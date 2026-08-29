import assert from "node:assert/strict";
import test from "node:test";
import releaseManifest from "../data/openra-ai-release.json";
import { getGameRelease } from "../lib/release";

test("serves downloads exclusively from the committed release manifest", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    throw new Error("release lookup must not use the network");
  }) as typeof fetch;

  try {
    const release = await getGameRelease();
    assert.equal(fetchCalls, 0);
    assert.equal(release.productCommit, "778258dbd67f9dd1e3500de323da97ecd7bf5249");
    assert.equal(release.engineCommit, "9bf10fc7e8b8db02b8e27e2ddc3391874c3d8149");
    assert.equal(release.windows.authenticode, "unsigned");
    assert.equal(release.windows.url, releaseManifest.windows.url);
    assert.equal(release.macos?.assets[0]?.url, releaseManifest.macos.assets[0].url);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pins every release asset to the declared version and GitHub tag", () => {
  const version = releaseManifest.windows.version;
  const expectedSegment = `/releases/download/v${version}/`;
  const urls = [
    releaseManifest.windows.url,
    releaseManifest.windows.checksumUrl,
    releaseManifest.windows.installerUrl,
    releaseManifest.windows.installerChecksumUrl,
    releaseManifest.windows.aiPackUrl,
    releaseManifest.windows.aiPackChecksumUrl,
    ...releaseManifest.macos.assets.flatMap((asset) => [asset.url, asset.checksumUrl]),
  ];

  assert.equal(releaseManifest.macos.version, version);
  for (const url of urls) {
    assert.ok(url.startsWith("https://github.com/alibad/OpenRA-AI/"));
    assert.ok(url.includes(expectedSegment));
  }
});
