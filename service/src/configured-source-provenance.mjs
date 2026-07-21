import { createHash } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import path from "node:path";

export const configuredSourceProvenanceSchemaVersion =
  "cimmich.configured-source-provenance.v1";

const digestPattern = /^[0-9a-f]{64}$/;
const privateIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const maxManifestBytes = 1024 * 1024;
const maxSourceBytes = 256 * 1024 * 1024;

const typedError = (code, message) =>
  Object.assign(new Error(message), { code });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const exactKeys = (value, fields) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join("\0") === [...fields].sort().join("\0");

const requiredId = (value, label) => {
  if (typeof value !== "string" || !privateIdPattern.test(value)) {
    throw typedError(
      "CONFIGURED_SOURCE_PROVENANCE_INVALID",
      `${label} is invalid`,
    );
  }
  return value;
};

const requiredDigest = (value, label) => {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw typedError(
      "CONFIGURED_SOURCE_PROVENANCE_INVALID",
      `${label} must be a lowercase SHA-256 digest`,
    );
  }
  return value;
};

const normalizeFaceIds = (value) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    throw typedError(
      "CONFIGURED_SOURCE_PROVENANCE_INVALID",
      "configured source Face set is invalid",
    );
  }
  const ids = value.map((faceId) => requiredId(faceId, "faceId")).sort();
  if (new Set(ids).size !== ids.length) {
    throw typedError(
      "CONFIGURED_SOURCE_PROVENANCE_INVALID",
      "configured source Face set is duplicated",
    );
  }
  return ids;
};

const normalizeRelativePath = (value) => {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 1024 ||
    path.isAbsolute(value) ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw typedError(
      "CONFIGURED_SOURCE_PROVENANCE_INVALID",
      "configured source relative path is invalid",
    );
  }
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  if (normalized === ".." || normalized.startsWith("../")) {
    throw typedError(
      "CONFIGURED_SOURCE_PROVENANCE_INVALID",
      "configured source path escapes its root",
    );
  }
  return normalized;
};

const sameIds = (left, right) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const pathFreeFsError = (code, message) => typedError(code, message);

const boundedRead = async (filePath, maximumBytes, label) => {
  let handle;
  try {
    handle = await open(filePath, "r");
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.size < 1 ||
      metadata.size > maximumBytes
    ) {
      throw pathFreeFsError(
        "CONFIGURED_SOURCE_PROVENANCE_INVALID",
        `${label} size is invalid`,
      );
    }
    return await handle.readFile();
  } catch (cause) {
    if (cause?.code?.startsWith("CONFIGURED_SOURCE_PROVENANCE_")) throw cause;
    throw pathFreeFsError(
      "CONFIGURED_SOURCE_PROVENANCE_UNAVAILABLE",
      `${label} is unavailable`,
    );
  } finally {
    await handle?.close().catch(() => {});
  }
};

const boundedRealpath = async (value, label) => {
  try {
    return await realpath(value);
  } catch {
    throw pathFreeFsError(
      "CONFIGURED_SOURCE_PROVENANCE_UNAVAILABLE",
      `${label} is unavailable`,
    );
  }
};

export const loadConfiguredSourceProvenance = async ({
  expectedManifestDigest,
  manifestPath,
  sourceRoot,
} = {}) => {
  const expectedDigest = requiredDigest(
    expectedManifestDigest,
    "configured manifest digest",
  );
  if (typeof manifestPath !== "string" || !manifestPath) {
    throw typedError(
      "CONFIGURED_SOURCE_PROVENANCE_INVALID",
      "configured source manifest path is required",
    );
  }
  if (typeof sourceRoot !== "string" || !path.isAbsolute(sourceRoot)) {
    throw typedError(
      "CONFIGURED_SOURCE_PROVENANCE_INVALID",
      "configured source root must be absolute",
    );
  }
  const bytes = await boundedRead(
    manifestPath,
    maxManifestBytes,
    "configured source manifest",
  );
  if (sha256(bytes) !== expectedDigest) {
    throw typedError(
      "CONFIGURED_SOURCE_PROVENANCE_CHANGED",
      "configured source manifest digest changed",
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw typedError(
      "CONFIGURED_SOURCE_PROVENANCE_INVALID",
      "configured source manifest is invalid JSON",
    );
  }
  if (
    !exactKeys(manifest, ["entries", "schemaVersion"]) ||
    manifest.schemaVersion !== configuredSourceProvenanceSchemaVersion ||
    !Array.isArray(manifest.entries) ||
    manifest.entries.length < 1 ||
    manifest.entries.length > 10_000
  ) {
    throw typedError(
      "CONFIGURED_SOURCE_PROVENANCE_INVALID",
      "configured source manifest shape is invalid",
    );
  }
  const root = await boundedRealpath(sourceRoot, "configured source root");
  const entries = [];
  const entryKeys = new Set();
  for (const value of manifest.entries) {
    if (
      !exactKeys(value, [
        "assetId",
        "faceIds",
        "sourceContentDigest",
        "sourceRelativePath",
        "sourceRevisionToken",
      ])
    ) {
      throw typedError(
        "CONFIGURED_SOURCE_PROVENANCE_INVALID",
        "configured source entry shape is invalid",
      );
    }
    const entry = Object.freeze({
      assetId: requiredId(value.assetId, "assetId"),
      faceIds: Object.freeze(normalizeFaceIds(value.faceIds)),
      sourceContentDigest: requiredDigest(
        value.sourceContentDigest,
        "sourceContentDigest",
      ),
      sourceRelativePath: normalizeRelativePath(value.sourceRelativePath),
      sourceRevisionToken: requiredId(
        value.sourceRevisionToken,
        "sourceRevisionToken",
      ),
    });
    const entryKey = `${entry.assetId}\0${entry.faceIds.join("\0")}`;
    if (entryKeys.has(entryKey)) {
      throw typedError(
        "CONFIGURED_SOURCE_PROVENANCE_INVALID",
        "configured source entry is duplicated",
      );
    }
    entryKeys.add(entryKey);
    entries.push(entry);
  }

  return Object.freeze({
    async readExact({ assetId: assetIdInput, faceIds: faceIdsInput }) {
      const assetId = requiredId(assetIdInput, "assetId");
      const faceIds = normalizeFaceIds(faceIdsInput);
      const matches = entries.filter(
        (entry) => entry.assetId === assetId && sameIds(entry.faceIds, faceIds),
      );
      if (matches.length !== 1) {
        throw typedError(
          "CONFIGURED_SOURCE_PROVENANCE_UNAVAILABLE",
          "exact configured source provenance is unavailable",
        );
      }
      const entry = matches[0];
      const candidate = await boundedRealpath(
        path.join(root, entry.sourceRelativePath),
        "configured source file",
      );
      if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
        throw typedError(
          "CONFIGURED_SOURCE_PROVENANCE_INVALID",
          "configured source path escapes its root",
        );
      }
      const sourceBytes = await boundedRead(
        candidate,
        maxSourceBytes,
        "configured source file",
      );
      if (
        sourceBytes.length < 1 ||
        sha256(sourceBytes) !== entry.sourceContentDigest
      ) {
        throw typedError(
          "CONFIGURED_SOURCE_PROVENANCE_CHANGED",
          "configured source content changed",
        );
      }
      return Object.freeze({
        assetId,
        bytes: sourceBytes,
        manifestDigest: expectedDigest,
        sourceBindingDigest: sha256(
          JSON.stringify({
            assetId,
            manifestDigest: expectedDigest,
            schemaVersion: configuredSourceProvenanceSchemaVersion,
            sourceRevisionToken: entry.sourceRevisionToken,
          }),
        ),
        sourceContentDigest: entry.sourceContentDigest,
        sourceRevisionToken: entry.sourceRevisionToken,
        currentStateMeaning: "configured_snapshot_only",
        matchingAuthority: "isolated_lab_only",
      });
    },
    manifestDigest: expectedDigest,
    matchingAuthority: "isolated_lab_only",
    schemaVersion: configuredSourceProvenanceSchemaVersion,
  });
};
