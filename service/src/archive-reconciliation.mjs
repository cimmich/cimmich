import { createHash } from "node:crypto";
import {
  bindVerifiedContent,
  verifiedContentBindingSchemaVersion,
} from "./archive-mobility.mjs";

const VISIBILITIES = ["timeline", "archive", "hidden", "locked"];

const requiredText = (value, name, maxLength = 200) => {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(
      `${name} is required and must be at most ${maxLength} characters`,
    );
  }
  return normalized;
};

const positiveInteger = (value, name, maximum) => {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return normalized;
};

const mapLimit = async (items, limit, operation) => {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await operation(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
};

const candidateForAsset = async ({ asset, legacySourceId, sql }) => {
  const candidates = await sql`
    SELECT DISTINCT
      projection.cimmich_asset_id AS asset_id,
      binding.external_asset_id,
      EXISTS (
        SELECT 1
        FROM asset_content_link link
        WHERE link.asset_id = projection.cimmich_asset_id
          AND link.state = 'active'
      ) AS content_bound
    FROM immich_asset_projection projection
    JOIN asset_source_binding binding
      ON binding.asset_id = projection.cimmich_asset_id
      AND binding.source_kind = 'immich'
      AND binding.source_id = projection.source_id
      AND binding.external_asset_id = projection.immich_asset_id
      AND binding.state = 'active'
    JOIN asset legacy_asset
      ON legacy_asset.asset_id = projection.cimmich_asset_id
      AND legacy_asset.state = 'active'
    WHERE projection.source_id = ${legacySourceId}
      AND projection.cimmich_asset_id IS NOT NULL
      AND projection.original_file_name = ${asset.originalFileName}
      AND projection.capture_time = ${asset.captureTime}
      AND projection.asset_type = ${asset.assetType}
      AND projection.original_mime_type IS NOT DISTINCT FROM ${asset.originalMimeType}
      AND projection.width IS NOT DISTINCT FROM ${asset.width}
      AND projection.height IS NOT DISTINCT FROM ${asset.height}
    ORDER BY projection.cimmich_asset_id, binding.external_asset_id
  `;
  const assetIds = new Set(candidates.map((candidate) => candidate.asset_id));
  if (assetIds.size !== 1) return null;
  return {
    assetId: String(candidates[0].asset_id),
    contentBound: Boolean(candidates[0].content_bound),
    externalAssetId: String(candidates[0].external_asset_id),
  };
};

const commandIdFor = ({ assetId, contentDigest, legacySourceId }) =>
  `archive-reconcile-${createHash("sha256")
    .update(`${legacySourceId}\0${assetId}\0${contentDigest}`)
    .digest("hex")}`;

export const reconcileImmichArchiveToLegacyAssets = async ({
  actorId,
  apply = false,
  companion,
  fingerprintConcurrency = 2,
  legacySourceId,
  maxPages = 25,
  pageSize = 250,
  sql,
  bindContent = bindVerifiedContent,
}) => {
  if (!companion?.listAssets || !companion?.readAssetFingerprint) {
    throw new Error("archive reconciliation requires an Immich companion");
  }
  if (!sql || typeof sql.begin !== "function") {
    throw new Error("archive reconciliation requires a Cimmich database");
  }
  const normalizedActorId = requiredText(actorId, "actorId");
  const normalizedLegacySourceId = requiredText(
    legacySourceId,
    "legacySourceId",
    120,
  );
  const normalizedPageSize = positiveInteger(pageSize, "pageSize", 1000);
  const normalizedMaxPages = positiveInteger(maxPages, "maxPages", 1000);
  const normalizedConcurrency = positiveInteger(
    fingerprintConcurrency,
    "fingerprintConcurrency",
    8,
  );

  const summary = {
    apply: Boolean(apply),
    scannedAssets: 0,
    eligibleAssets: 0,
    metadataMatchedAssets: 0,
    metadataUnmatchedAssets: 0,
    alreadyBoundLegacyAssets: 0,
    candidateGroups: 0,
    multiCurrentGroups: 0,
    byteConflictGroups: 0,
    existingContentGroups: 0,
    boundGroups: 0,
    boundCurrentAssets: 0,
    pages: 0,
    schemaVersion: "cimmich.archive-reconciliation.v1",
  };
  const groups = new Map();

  for (const visibility of VISIBILITIES) {
    let cursor = "";
    do {
      if (summary.pages >= normalizedMaxPages) {
        throw new Error("archive reconciliation exceeded maxPages");
      }
      const page = await companion.listAssets({
        cursor,
        limit: normalizedPageSize,
        visibility,
      });
      summary.pages += 1;
      for (const asset of page.items) {
        summary.scannedAssets += 1;
        if (
          !["image", "video"].includes(asset.assetType) ||
          asset.isOffline ||
          asset.isTrashed ||
          !asset.originalFileName
        ) {
          continue;
        }
        summary.eligibleAssets += 1;
        const candidate = await candidateForAsset({
          asset,
          legacySourceId: normalizedLegacySourceId,
          sql,
        });
        if (!candidate) {
          summary.metadataUnmatchedAssets += 1;
          continue;
        }
        summary.metadataMatchedAssets += 1;
        if (candidate.contentBound) {
          summary.alreadyBoundLegacyAssets += 1;
          continue;
        }
        const group = groups.get(candidate.assetId) || {
          ...candidate,
          currentAssets: [],
        };
        group.currentAssets.push(asset);
        groups.set(candidate.assetId, group);
      }
      cursor = page.nextCursor || "";
    } while (cursor);
  }

  summary.candidateGroups = groups.size;
  summary.multiCurrentGroups = [...groups.values()].filter(
    (group) => group.currentAssets.length > 1,
  ).length;
  if (!apply) return summary;

  const results = await mapLimit(
    [...groups.values()],
    normalizedConcurrency,
    async (group) => {
      const fingerprints = [];
      for (const asset of group.currentAssets) {
        fingerprints.push(
          await companion.readAssetFingerprint({
            assetId: asset.immichAssetId,
          }),
        );
      }
      const digests = new Set(
        fingerprints.map(
          (fingerprint) =>
            `${fingerprint.contentDigest}:${fingerprint.byteLength}`,
        ),
      );
      if (digests.size !== 1) return { byteConflict: true };
      const [fingerprint] = fingerprints;
      try {
        await bindContent({
          actorId: normalizedActorId,
          byteLength: fingerprint.byteLength,
          commandId: commandIdFor({
            assetId: group.assetId,
            contentDigest: fingerprint.contentDigest,
            legacySourceId: normalizedLegacySourceId,
          }),
          contentDigest: fingerprint.contentDigest,
          externalAssetId: group.externalAssetId,
          hashAlgorithm: "sha256",
          schemaVersion: verifiedContentBindingSchemaVersion,
          sourceId: normalizedLegacySourceId,
          sourceKind: "immich",
          sql,
        });
      } catch (error) {
        if (error?.code === "ARCHIVE_CONTENT_IDENTITY_AMBIGUOUS") {
          return { existingContent: true };
        }
        throw error;
      }
      return { boundCurrentAssets: group.currentAssets.length };
    },
  );

  for (const result of results) {
    if (result.byteConflict) {
      summary.byteConflictGroups += 1;
    } else if (result.existingContent) {
      summary.existingContentGroups += 1;
    } else {
      summary.boundGroups += 1;
      summary.boundCurrentAssets += result.boundCurrentAssets;
    }
  }
  return summary;
};
