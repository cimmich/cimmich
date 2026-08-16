const sha256Pattern = /^[0-9a-f]{64}$/;

const cleanId = (value) => String(value || "").trim();

const proposedResult = (row) => {
  const result = row?.result;
  return (
    result?.state === "proposed" &&
    result.operation === "scene-text" &&
    result.providerId === "apple-vision-native-summary" &&
    result.activationAuthority === "none" &&
    sha256Pattern.test(cleanId(result.configDigest)) &&
    sha256Pattern.test(cleanId(result.proposalDigest)) &&
    cleanId(result.model?.digest) &&
    cleanId(result.model?.name) &&
    result.proposal &&
    typeof result.proposal === "object" &&
    !Array.isArray(result.proposal)
  );
};

const addReason = (counts, reason) =>
  counts.set(reason, (counts.get(reason) || 0) + 1);

export const planAppleSmartProposalImport = ({
  currentAssets,
  manifest,
  resultRows,
}) => {
  if (
    manifest?.schemaVersion !== "cimmich.apple-vision-benji-full-manifest.v1" ||
    !Array.isArray(manifest.assets) ||
    !Array.isArray(resultRows)
  ) {
    throw new Error("APPLE_SMART_IMPORT_ARTIFACT_INVALID");
  }
  const manifestBySourceId = new Map();
  for (const asset of manifest.assets) {
    const sourceAssetId = cleanId(asset?.immichAssetId);
    if (!sourceAssetId || manifestBySourceId.has(sourceAssetId)) {
      throw new Error("APPLE_SMART_IMPORT_MANIFEST_DUPLICATE");
    }
    manifestBySourceId.set(sourceAssetId, asset);
  }
  const resultBySourceId = new Map();
  for (const row of resultRows) {
    const sourceAssetId = cleanId(row?.immichAssetId);
    if (!sourceAssetId || resultBySourceId.has(sourceAssetId)) {
      throw new Error("APPLE_SMART_IMPORT_RESULTS_DUPLICATE");
    }
    resultBySourceId.set(sourceAssetId, row);
  }
  if (
    resultBySourceId.size !== manifestBySourceId.size ||
    [...resultBySourceId.keys()].some(
      (sourceAssetId) => !manifestBySourceId.has(sourceAssetId),
    )
  ) {
    throw new Error("APPLE_SMART_IMPORT_RESULT_SET_MISMATCH");
  }
  const currentBySourceId = new Map();
  for (const asset of currentAssets) {
    const sourceAssetId = cleanId(asset?.sourceAssetId);
    if (!sourceAssetId || currentBySourceId.has(sourceAssetId)) {
      throw new Error("APPLE_SMART_IMPORT_CURRENT_ASSET_DUPLICATE");
    }
    currentBySourceId.set(sourceAssetId, asset);
  }
  const reasonCounts = new Map();
  const eligible = [];
  const alreadyCurrent = [];

  for (const [sourceAssetId, manifestAsset] of manifestBySourceId) {
    const resultRow = resultBySourceId.get(sourceAssetId);
    const current = currentBySourceId.get(sourceAssetId);
    let reason;
    if (manifestAsset.sourceAvailable !== true) reason = "source_unavailable";
    else if (!resultRow) reason = "result_missing";
    else if (
      cleanId(resultRow.cimmichAssetId) !==
        cleanId(manifestAsset.cimmichAssetId) ||
      cleanId(resultRow.immichAssetId) !== sourceAssetId
    )
      reason = "artifact_mapping_mismatch";
    else if (!proposedResult(resultRow)) reason = "proposal_invalid";
    else if (!current) reason = "current_asset_missing";
    else if (
      cleanId(current.cimmichAssetId) !== cleanId(manifestAsset.cimmichAssetId)
    )
      reason = "current_mapping_changed";
    else {
      const contentDigest = cleanId(manifestAsset.contentHash).replace(
        /^sha256:/,
        "",
      );
      const currentDigests = new Set(
        (current.sourceContentDigests || []).map((value) => cleanId(value)),
      );
      if (!sha256Pattern.test(contentDigest)) reason = "content_hash_invalid";
      else if (!currentDigests.has(contentDigest)) reason = "content_changed";
      else if (
        cleanId(current.currentSmartProposalDigest) ===
        cleanId(resultRow.result.proposalDigest)
      ) {
        alreadyCurrent.push(sourceAssetId);
        continue;
      } else if (cleanId(current.currentSmartProposalDigest))
        reason = "current_smart_conflict";
      else {
        eligible.push({
          cimmichAssetId: current.cimmichAssetId,
          commit: {
            configDigest: resultRow.result.configDigest,
            modelDigest: resultRow.result.model.digest,
            modelName: resultRow.result.model.name,
            proposalDigest: resultRow.result.proposalDigest,
            providerId: resultRow.result.providerId,
            sourceAssetId,
            sourceContentDigest: contentDigest,
            tier: "smart",
            visualFacts: resultRow.result.proposal,
          },
          sourceAssetId,
        });
        continue;
      }
    }
    addReason(reasonCounts, reason);
  }

  return {
    alreadyCurrent,
    eligible,
    reasonCounts: Object.fromEntries([...reasonCounts].sort()),
    totalManifestAssets: manifestBySourceId.size,
  };
};
