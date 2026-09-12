// Release promotion consumes exact-artifact verification, never a signing flag.
export function verifyEvidence(evidence, index, version, assets) {
  if (evidence.schemaVersion !== 1 || evidence.version !== version || evidence.engineCommit !== index.engine_commit || evidence.productCommit !== index.product_commit) throw new Error("Verification evidence does not match the release index");
  for (const check of ["cleanInstall", "upgrade", "uninstall", "localAI", "externalProvider", "missingRA2", "secondarySteamLibrary"]) {
    if (evidence.checks?.[check] !== true) throw new Error("Release acceptance is incomplete: " + check);
  }
  for (const asset of assets) {
    const proof = evidence.artifacts?.[asset.name];
    if (!proof || !/^[a-f0-9]{64}$/.test(proof.sha256) || proof.sizeBytes !== asset.size) throw new Error("Missing exact-artifact proof: " + asset.name);
    if (asset.digest && asset.digest !== "sha256:" + proof.sha256) throw new Error("Published digest differs from verification: " + asset.name);
    if (asset.name.endsWith("-setup.exe") && !["verified", "unsigned"].includes(proof.authenticode)) throw new Error("Missing Authenticode result");
    if (asset.name.endsWith(".dmg") && [proof.developerIdSigned, proof.notarized, proof.stapled].some(value => value !== true)) throw new Error("Mac signing, notarization and stapling must all be verified");
  }
}
