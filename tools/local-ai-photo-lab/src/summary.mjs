const joinNatural = (values) => {
  if (values.length < 2) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
};

const compact = (value, maximum = 90) => {
  const normalized = String(value ?? "")
    .replaceAll(/\s+/g, " ")
    .trim()
    .replace(/[.,;:]+$/, "");
  if (normalized.length <= maximum) return normalized;
  const initial = normalized.slice(0, maximum - 1).trimEnd();
  const boundary = initial.lastIndexOf(" ");
  const truncated =
    boundary > maximum * 0.6 ? initial.slice(0, boundary) : initial;
  return `${truncated}…`;
};

export const buildSetSummary = ({ assets, context, contextKind }) => {
  const sceneEvidence = assets
    .filter(
      (asset) =>
        asset.operations?.sceneText?.state === "proposed" &&
        asset.operations.sceneText.proposal?.summary,
    )
    .map((asset) => ({
      assetId: asset.assetId,
      scene: asset.operations.sceneText.proposal.scene,
      summary: asset.operations.sceneText.proposal.summary,
    }));
  const contextEvidence = (context?.candidates ?? []).filter(
    (candidate) =>
      candidate.state === "supported" || candidate.state === "possible",
  );
  const reviewAssetIds = assets
    .filter((asset) => asset.crossModelChecks?.state === "review")
    .map(({ assetId }) => assetId);
  if (!sceneEvidence.length && !contextEvidence.length) {
    return {
      evidence: { candidateIds: [], reviewAssetIds, sceneAssetIds: [] },
      state: "unavailable",
      text: `No scene or context proposal was available for this scope.${reviewAssetIds.length ? ` Cross-model review is needed for ${joinNatural(reviewAssetIds)}.` : ""}`,
    };
  }
  const opening = `${assets.length}-photo ${contextKind === "none" ? "scope" : contextKind.replaceAll("_", " ")}.`;
  const visibleExamples = sceneEvidence.slice(0, 4);
  const sceneText = !sceneEvidence.length
    ? ""
    : assets.length === 1
      ? ` Visible evidence: ${compact(sceneEvidence[0].summary, 220)}.`
      : ` Visible evidence spans ${joinNatural(
          visibleExamples.map(
            ({ assetId, scene }) => `${assetId} (${compact(scene, 72)})`,
          ),
        )}${sceneEvidence.length > visibleExamples.length ? `, plus ${sceneEvidence.length - visibleExamples.length} additional photo${sceneEvidence.length - visibleExamples.length === 1 ? "" : "s"}` : ""}.`;
  const contextText = contextEvidence.length
    ? ` Context candidates: ${joinNatural(
        contextEvidence.map((candidate) => {
          if (candidate.kind === "body_candidate") {
            return `a body in ${candidate.assetId} is a ${candidate.state} candidate for ${candidate.subject}`;
          }
          return `${candidate.subject} is possibly present in ${candidate.assetId}`;
        }),
      )}.`
    : "";
  const reviewText = reviewAssetIds.length
    ? ` Candidate review is needed for ${joinNatural(reviewAssetIds)}.`
    : "";
  return {
    evidence: {
      candidateIds: contextEvidence.map(({ candidateId }) => candidateId),
      reviewAssetIds,
      sceneAssetIds: sceneEvidence.map(({ assetId }) => assetId),
    },
    state: "proposed",
    text: `${opening}${sceneText}${contextText}${reviewText}`.trim(),
  };
};
