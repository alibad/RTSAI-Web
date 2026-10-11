import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boundedPath, sha256, verifyFrozenInput } from "../scripts/frozen-inputs.mjs";

test("frozen check refuses changed bytes, extra files, symlinks and stale identities without Git", () => {
  const root = mkdtempSync(join(tmpdir(), "s09-frozen-"));
  try {
    writeFileSync(join(root, "rules.yaml"), "world:\n"); chmodSync(join(root, "rules.yaml"), 0o644);
    const files = [{ path: "rules.yaml", size: 7, sha256: sha256("world:\n"), executable: false }];
    const identity = sha256(JSON.stringify(files.map(({ executable, path, sha256, size }) => ({ executable, path, sha256, size }))));
    writeFileSync(join(root, "INPUTS.json"), JSON.stringify({ files, sourceSha256: identity }));
    assert.equal(verifyFrozenInput(root, identity).files.length, 1);
    assert.throws(() => verifyFrozenInput(root, "a".repeat(64)), /identity/);
    writeFileSync(join(root, "rules.yaml"), "changed"); assert.throws(() => verifyFrozenInput(root, identity), /changed/);
    writeFileSync(join(root, "rules.yaml"), "world:\n"); writeFileSync(join(root, "extra"), "private"); assert.throws(() => verifyFrozenInput(root, identity), /Unexpected/);
    rmSync(join(root, "extra")); symlinkSync(join(root, "rules.yaml"), join(root, "alias")); assert.throws(() => verifyFrozenInput(root, identity), /symlink/);
    for (const relative of ["../private", "/private", "rules\\private", "./rules.yaml"]) assert.throws(() => boundedPath(root, relative));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
