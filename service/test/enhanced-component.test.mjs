import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  enhancedCoreInterfaceVersion,
  loadEnhancedArtifactCatalogue,
  validateEnhancedArtifact,
} from "../src/enhanced-component.mjs";

const path = new URL(
  "../enhanced/cimmich-enhanced-1.0.0.json",
  import.meta.url,
);
const fixture = async () => {
  const bytes = await readFile(path);
  return { bytes, raw: JSON.parse(bytes.toString("utf8")) };
};

test("Enhanced artifact is independently digest-versioned and authority-free", async () => {
  const { bytes, raw } = await fixture();
  const artifact = validateEnhancedArtifact(raw, bytes);
  assert.equal(artifact.componentVersion, "1.0.0");
  assert.equal(artifact.interfaceVersion, enhancedCoreInterfaceVersion);
  assert.match(artifact.artifactDigest, /^[0-9a-f]{64}$/);
  const catalogue = await loadEnhancedArtifactCatalogue(
    fileURLToPath(new URL("../enhanced", import.meta.url)),
  );
  assert.deepEqual(catalogue, [artifact]);
});

test("Enhanced artifacts fail closed on interface, authority and shape drift", async () => {
  const { bytes, raw } = await fixture();
  for (const changed of [
    { ...raw, interfaceVersion: "cimmich.core-enhanced.v2" },
    {
      ...raw,
      authority: { ...raw.authority, automaticIdentity: "automatic" },
    },
    { ...raw, providerCredential: "forbidden" },
  ]) {
    assert.throws(
      () => validateEnhancedArtifact(changed, bytes),
      (error) =>
        [
          "ENHANCED_ARTIFACT_INVALID",
          "ENHANCED_ARTIFACT_INCOMPATIBLE",
        ].includes(error.code),
    );
  }
  assert.throws(
    () => validateEnhancedArtifact(raw, Buffer.alloc(65_537)),
    (error) => error.code === "ENHANCED_ARTIFACT_INVALID",
  );
});
