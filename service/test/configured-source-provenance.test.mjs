import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  configuredSourceProvenanceSchemaVersion,
  loadConfiguredSourceProvenance,
} from "../src/configured-source-provenance.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const fixture = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cimmich-provenance-"));
  const source = Buffer.from("exact local source bytes");
  await writeFile(path.join(root, "source.bin"), source);
  const manifest = {
    entries: [
      {
        assetId: "asset-one",
        faceIds: ["face-one"],
        sourceContentDigest: sha256(source),
        sourceRelativePath: "source.bin",
        sourceRevisionToken: "frozen-cohort-v1",
      },
    ],
    schemaVersion: configuredSourceProvenanceSchemaVersion,
  };
  const manifestPath = path.join(root, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  const manifestBytes = await readFile(manifestPath);
  return {
    expectedManifestDigest: sha256(manifestBytes),
    manifest,
    manifestPath,
    root,
  };
};

test("configured source provenance binds one exact asset, Face set, and source", async () => {
  const state = await fixture();
  const provenance = await loadConfiguredSourceProvenance({
    expectedManifestDigest: state.expectedManifestDigest,
    manifestPath: state.manifestPath,
    sourceRoot: state.root,
  });
  const first = await provenance.readExact({
    assetId: "asset-one",
    faceIds: ["face-one"],
  });
  const replay = await provenance.readExact({
    assetId: "asset-one",
    faceIds: ["face-one"],
  });
  assert.equal(first.sourceContentDigest, replay.sourceContentDigest);
  assert.equal(first.sourceBindingDigest, replay.sourceBindingDigest);
  assert.equal(first.bytes.toString("utf8"), "exact local source bytes");
  assert.equal(first.currentStateMeaning, "configured_snapshot_only");
  assert.equal(first.matchingAuthority, "isolated_lab_only");
  assert.equal(provenance.matchingAuthority, "isolated_lab_only");
  await assert.rejects(
    provenance.readExact({ assetId: "asset-two", faceIds: ["face-one"] }),
    (error) => error.code === "CONFIGURED_SOURCE_PROVENANCE_UNAVAILABLE",
  );
  await assert.rejects(
    provenance.readExact({ assetId: "asset-one", faceIds: ["face-two"] }),
    (error) => error.code === "CONFIGURED_SOURCE_PROVENANCE_UNAVAILABLE",
  );
});

test("manifest, path, and source substitution fail closed", async () => {
  const state = await fixture();
  await assert.rejects(
    loadConfiguredSourceProvenance({
      expectedManifestDigest: "0".repeat(64),
      manifestPath: state.manifestPath,
      sourceRoot: state.root,
    }),
    (error) => error.code === "CONFIGURED_SOURCE_PROVENANCE_CHANGED",
  );
  state.manifest.entries[0].sourceRelativePath = "../source.bin";
  await writeFile(state.manifestPath, JSON.stringify(state.manifest));
  const escaped = await readFile(state.manifestPath);
  await assert.rejects(
    loadConfiguredSourceProvenance({
      expectedManifestDigest: sha256(escaped),
      manifestPath: state.manifestPath,
      sourceRoot: state.root,
    }),
    (error) => error.code === "CONFIGURED_SOURCE_PROVENANCE_INVALID",
  );
});

test("source drift after manifest validation fails before reread output", async () => {
  const state = await fixture();
  const provenance = await loadConfiguredSourceProvenance({
    expectedManifestDigest: state.expectedManifestDigest,
    manifestPath: state.manifestPath,
    sourceRoot: state.root,
  });
  await writeFile(path.join(state.root, "source.bin"), "substituted bytes");
  await assert.rejects(
    provenance.readExact({ assetId: "asset-one", faceIds: ["face-one"] }),
    (error) => error.code === "CONFIGURED_SOURCE_PROVENANCE_CHANGED",
  );
});

test("filesystem failures and bounded-size rejection never echo local paths", async () => {
  const state = await fixture();
  const missingPath = path.join(state.root, "private-person-name.jpg");
  await assert.rejects(
    loadConfiguredSourceProvenance({
      expectedManifestDigest: state.expectedManifestDigest,
      manifestPath: missingPath,
      sourceRoot: state.root,
    }),
    (error) =>
      error.code === "CONFIGURED_SOURCE_PROVENANCE_UNAVAILABLE" &&
      !error.message.includes(missingPath) &&
      !error.message.includes("private-person-name"),
  );
  await writeFile(state.manifestPath, Buffer.alloc(1024 * 1024 + 1));
  await assert.rejects(
    loadConfiguredSourceProvenance({
      expectedManifestDigest: state.expectedManifestDigest,
      manifestPath: state.manifestPath,
      sourceRoot: state.root,
    }),
    (error) =>
      error.code === "CONFIGURED_SOURCE_PROVENANCE_INVALID" &&
      !error.message.includes(state.manifestPath),
  );
});
