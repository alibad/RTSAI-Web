import assert from "node:assert/strict";
import test from "node:test";
import committed from "../data/rtsai-mod-release.json";
import snapshot from "../data/factions.generated.json";
import { classifyAsset, validateModRelease } from "../lib/mod-release-manifest.mjs";
import { getModRelease, modReleaseFrom, windowsInstaller } from "../lib/mod-release";
import { buildModRelease, parseChecksums } from "../scripts/sync-mod-release.mjs";

const TAG = "v0.2.0-alpha.1";
const BASE = `https://github.com/alibad/RTSAI-Mod/releases/download/${TAG}/`;
const ra2Ids = snapshot.catalog.factions.filter((faction) => faction.variants.ra2.status === "implemented").map((faction) => faction.id);
const hex = (character: string) => character.repeat(64);

function asset(name: string, size: number, digest?: string) {
  return { name, size, state: "uploaded", browser_download_url: `${BASE}${name}`, ...(digest ? { digest } : {}) };
}

function fakeGitHub(overrides: { repo?: Record<string, unknown>; release?: Record<string, unknown>; files?: Record<string, string> } = {}) {
  const release = {
    tag_name: TAG,
    draft: false,
    prerelease: true,
    published_at: "2026-10-20T18:00:00Z",
    assets: [
      asset("RTSAI-AI-Pack-voice-x64.zip", 268_539_880),
      asset("RTSAI-v0.2.0-alpha.1-x64-winportable.zip", 310_000_000),
      asset("RTSAI-v0.2.0-alpha.1-x64-winportable.zip.sha256", 100),
      asset("RTSAI-v0.2.0-alpha.1-x64.exe", 290_000_000, `sha256:${hex("a")}`),
      asset("SHA256SUMS", 200),
      { ...asset("RTSAI-v0.2.0-alpha.1-x86.exe", 280_000_000), state: "new" },
    ],
    ...overrides.release,
  };
  const files: Record<string, string> = {
    [`${BASE}RTSAI-v0.2.0-alpha.1-x64-winportable.zip.sha256`]: `${hex("b")}  RTSAI-v0.2.0-alpha.1-x64-winportable.zip\n`,
    [`${BASE}SHA256SUMS`]: `${hex("a")} *RTSAI-v0.2.0-alpha.1-x64.exe\n${hex("c")}  RTSAI-AI-Pack-voice-x64.zip\n`,
    ...overrides.files,
  };
  return {
    fetchJson: async (url: string) => {
      if (url === "https://api.github.com/repos/alibad/RTSAI-Mod") return { private: false, ...overrides.repo };
      if (url === `https://api.github.com/repos/alibad/RTSAI-Mod/releases/tags/${TAG}`) return release;
      throw new Error(`unexpected ${url}`);
    },
    fetchText: async (url: string) => {
      if (!(url in files)) throw new Error(`unexpected ${url}`);
      return files[url];
    },
  };
}

test("the committed mod manifest is valid and, until a release is published, lists no downloads", () => {
  assert.deepEqual(validateModRelease(committed, ra2Ids), []);
  const release = getModRelease();
  if (!release.published) {
    assert.equal(release.assets.length, 0);
    assert.equal(release.ra2FactionIds.length, 0, "no RA2 faction is claimed before a published release");
    assert.equal(windowsInstaller(release), null);
  } else {
    assert.ok(windowsInstaller(release));
  }
});

test("sync builds a manifest from a GitHub release with verified SHA-256 digests", async () => {
  const manifest = await buildModRelease({ tag: TAG, ...fakeGitHub(), ra2FactionIds: ["china", "yemen"], knownFactionIds: ra2Ids });
  assert.equal(manifest.published, true);
  assert.equal(manifest.version, "0.2.0-alpha.1");
  assert.equal(manifest.signed, false, "unsigned unless --signed verified the installer");
  assert.equal(manifest.releaseUrl, `https://github.com/alibad/RTSAI-Mod/releases/tag/${TAG}`);
  assert.deepEqual(manifest.assets.map((item: { name: string; kind: string; platform: string; sha256: string }) => [item.name, item.kind, item.platform, item.sha256]), [
    ["RTSAI-v0.2.0-alpha.1-x64.exe", "installer", "windows-x64", hex("a")],
    ["RTSAI-v0.2.0-alpha.1-x64-winportable.zip", "portable", "windows-x64", hex("b")],
    ["RTSAI-AI-Pack-voice-x64.zip", "ai-pack", "windows-x64", hex("c")],
  ], "checksum files and unfinished uploads are not downloads; the installer comes first");
  assert.deepEqual(validateModRelease(manifest, ra2Ids), []);
  const rendered = modReleaseFrom(manifest);
  assert.equal(rendered.published, true);
  assert.equal(windowsInstaller(rendered)?.sizeBytes, 290_000_000);
});

test("sync refuses releases players could not safely download", async () => {
  const refuse = async (overrides: Parameters<typeof fakeGitHub>[0], pattern: RegExp, extra: Record<string, unknown> = {}) => {
    await assert.rejects(buildModRelease({ tag: TAG, ...fakeGitHub(overrides), knownFactionIds: ra2Ids, ...extra }), pattern);
  };
  await refuse({ repo: { private: true } }, /private/);
  await refuse({ release: { draft: true } }, /draft/);
  await refuse({ files: { [`${BASE}SHA256SUMS`]: `${hex("a")}  RTSAI-v0.2.0-alpha.1-x64.exe\n` } }, /No published SHA-256 for RTSAI-AI-Pack/);
  await refuse({ files: { [`${BASE}SHA256SUMS`]: `${hex("d")}  RTSAI-v0.2.0-alpha.1-x64.exe\n${hex("c")}  RTSAI-AI-Pack-voice-x64.zip\n` } }, /disagree/);
  await refuse({ release: { assets: [asset("RTSAI-v0.2.0-alpha.1-x64-winportable.zip", 5, `sha256:${hex("b")}`)] } }, /Windows x64 installer/);
  await refuse({}, /unknown faction id: atlantis/, { ra2FactionIds: ["atlantis"] });
  await assert.rejects(buildModRelease({ tag: "latest", ...fakeGitHub() }), /Not a release tag/);
});

test("an invalid or half-filled manifest renders as unpublished, never as broken links", () => {
  const base = { schemaVersion: 1, repository: "alibad/RTSAI-Mod", signed: false, ra2FactionIds: [], publishedAt: "2026-10-20T18:00:00Z" };
  const installer = { name: "RTSAI-v0.2.0-alpha.1-x64.exe", kind: "installer", platform: "windows-x64", url: `${BASE}RTSAI-v0.2.0-alpha.1-x64.exe`, sizeBytes: 1, sha256: hex("a") };
  const good = { ...base, published: true, version: "0.2.0-alpha.1", tag: TAG, releaseUrl: `https://github.com/alibad/RTSAI-Mod/releases/tag/${TAG}`, assets: [installer] };
  assert.equal(modReleaseFrom(good).published, true);
  for (const broken of [
    { ...good, assets: [] },
    { ...good, assets: [{ ...installer, url: "https://example.com/RTSAI.exe" }] },
    { ...good, assets: [{ ...installer, sha256: "" }] },
    { ...good, assets: [{ ...installer, sizeBytes: 0 }] },
    { ...good, version: "0.3.0" },
    { ...good, published: "yes" },
    { ...base, published: false, version: null, tag: null, releaseUrl: null, assets: [installer] },
  ]) {
    const rendered = modReleaseFrom(broken);
    assert.equal(rendered.published, false);
    assert.equal(rendered.assets.length, 0);
  }
});

test("a release claims only the co-commander modes its installer offers", async () => {
  const none = await buildModRelease({ tag: TAG, ...fakeGitHub(), knownFactionIds: ra2Ids });
  assert.deepEqual(none.aiModes, [], "no co-commander is claimed unless --ai names it");
  const local = await buildModRelease({ tag: TAG, ...fakeGitHub(), aiModes: ["local"], knownFactionIds: ra2Ids });
  assert.deepEqual(local.aiModes, ["local"]);
  assert.deepEqual(validateModRelease({ ...local, aiModes: ["telepathy"] }), ["unknown AI mode: telepathy"]);
  assert.deepEqual(validateModRelease({ ...local, aiModes: ["local", "local"] }), ["aiModes lists a mode twice"]);
  const legacy: Partial<typeof local> = { ...local };
  delete legacy.aiModes;
  assert.deepEqual(validateModRelease(legacy), [], "manifests written before aiModes existed stay valid");
  assert.deepEqual(modReleaseFrom(legacy).aiModes, [], "and claim no co-commander");
  assert.ok(validateModRelease({ ...committed, published: false, assets: [], ra2FactionIds: [], aiModes: ["hosted"] }).includes("an unpublished manifest must not claim AI modes"));
});

test("asset names map to download kinds and platforms", () => {
  assert.deepEqual(classifyAsset("RTSAI-v0.2.0-x64.exe"), { kind: "installer", platform: "windows-x64" });
  assert.deepEqual(classifyAsset("RTSAI-v0.2.0-x86.exe"), { kind: "installer", platform: "windows-x86" });
  assert.deepEqual(classifyAsset("RTSAI-v0.2.0-x64-winportable.zip"), { kind: "portable", platform: "windows-x64" });
  assert.deepEqual(classifyAsset("RTSAI-v0.2.0.dmg"), { kind: "installer", platform: "macos" });
  // The names build-release.ps1 and packaging/macos/build-release.sh write.
  assert.deepEqual(classifyAsset("RTSAI-0.3.0-alpha.1-win-x64-setup.exe"), { kind: "installer", platform: "windows-x64" });
  assert.deepEqual(classifyAsset("RTSAI-0.3.0-alpha.1-win-x64-portable.zip"), { kind: "portable", platform: "windows-x64" });
  assert.deepEqual(classifyAsset("RTSAI-0.3.0-alpha.1-macos.dmg"), { kind: "installer", platform: "macos" });
  assert.deepEqual(classifyAsset("RTSAI-v0.2.0-x86_64.AppImage"), { kind: "installer", platform: "linux" });
  assert.deepEqual(classifyAsset("RTSAI-Local-AI-Pack-x64.zip"), { kind: "ai-pack", platform: "windows-x64" });
  assert.deepEqual(classifyAsset("release-notes.md"), { kind: "other", platform: "any" });
  assert.deepEqual([...parseChecksums(`${hex("e")}\n`, "a.exe")], [["a.exe", hex("e")]]);
});
