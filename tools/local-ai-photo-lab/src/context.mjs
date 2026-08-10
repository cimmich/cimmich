import { digest } from "./contract.mjs";

const cosine = (left, right) => {
  if (
    !Array.isArray(left) ||
    !Array.isArray(right) ||
    left.length !== right.length ||
    left.length === 0
  )
    return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return leftNorm > 0 && rightNorm > 0
    ? dot / Math.sqrt(leftNorm * rightNorm)
    : 0;
};

const round6 = (value) => Number(value.toFixed(6));

const anchorAssignments = (asset) => {
  const bodies = asset.operations?.bodies?.bodies ?? [];
  const assignments = [];
  for (const subject of asset.acceptedSubjects) {
    const explicitIndex = asset.bodyAssignments?.[subject];
    if (
      explicitIndex !== undefined &&
      bodies[explicitIndex]?.appearanceFeature
    ) {
      assignments.push({ body: bodies[explicitIndex], subject });
    } else if (
      asset.acceptedSubjects.length === 1 &&
      bodies.length === 1 &&
      bodies[0].appearanceFeature
    ) {
      assignments.push({ body: bodies[0], subject });
    }
  }
  return assignments;
};

const nearestAnchor = (anchors, index, subject, direction) => {
  const eligible = anchors.filter(
    (anchor) =>
      anchor.subject === subject &&
      (direction < 0 ? anchor.index < index : anchor.index > index),
  );
  eligible.sort(
    (left, right) =>
      Math.abs(left.index - index) - Math.abs(right.index - index),
  );
  return eligible[0] ?? null;
};

const candidateSubjects = (anchors, index, requireBidirectional) => {
  const subjects = [...new Set(anchors.map((anchor) => anchor.subject))];
  return subjects.filter((subject) => {
    const left = nearestAnchor(anchors, index, subject, -1);
    const right = nearestAnchor(anchors, index, subject, 1);
    return requireBidirectional
      ? Boolean(left && right)
      : Boolean(left || right);
  });
};

const bodyScore = (body, left, right) => {
  const scores = [left, right]
    .filter(Boolean)
    .map((anchor) =>
      cosine(body.appearanceFeature, anchor.body.appearanceFeature),
    );
  return scores.length ? Math.min(...scores) : 0;
};

export const inferContext = ({ assets, contextKind, policy }) => {
  if (contextKind === "none" || assets.length < 2) {
    return {
      candidates: [],
      contextKind,
      reasons: ["CONTEXT_SCOPE_UNAVAILABLE"],
      state: "abstained",
    };
  }
  const anchors = assets.flatMap((asset, index) =>
    anchorAssignments(asset).map((assignment) => ({
      ...assignment,
      assetId: asset.assetId,
      index,
      sourceContentDigest: asset.sourceContentDigest,
    })),
  );
  const candidates = [];
  for (const [index, asset] of assets.entries()) {
    const subjects = candidateSubjects(
      anchors,
      index,
      policy.requireBidirectionalAnchors,
    );
    if (!subjects.length) continue;
    const anchoredBodyIds = new Set(
      anchorAssignments(asset).map(({ body }) => body.bodyId),
    );
    const bodies = (asset.operations?.bodies?.bodies ?? []).filter(
      (body) => body.appearanceFeature && !anchoredBodyIds.has(body.bodyId),
    );
    if (!bodies.length && anchoredBodyIds.size) continue;
    if (!bodies.length) {
      for (const subject of subjects) {
        const left = nearestAnchor(anchors, index, subject, -1);
        const right = nearestAnchor(anchors, index, subject, 1);
        const independent =
          new Set(
            [
              asset.sourceContentDigest,
              left?.sourceContentDigest,
              right?.sourceContentDigest,
            ].filter(Boolean),
          ).size === 3;
        candidates.push({
          assetId: asset.assetId,
          candidateId: `context_${digest({ assetId: asset.assetId, kind: "presence", subject }).slice(0, 32)}`,
          evidence: {
            leftAssetId: left?.assetId ?? null,
            reasonCodes: independent
              ? ["ORDERED_ACCEPTED_SUPPORT", "NO_USABLE_TARGET_BODY"]
              : ["DUPLICATE_SOURCE_EVIDENCE"],
            rightAssetId: right?.assetId ?? null,
          },
          kind: "presence_candidate",
          state: independent ? "possible" : "abstained",
          subject,
        });
      }
      continue;
    }
    for (const body of bodies) {
      const ranked = subjects
        .map((subject) => {
          const left = nearestAnchor(anchors, index, subject, -1);
          const right = nearestAnchor(anchors, index, subject, 1);
          return { left, right, score: bodyScore(body, left, right), subject };
        })
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.subject.localeCompare(right.subject),
        );
      const best = ranked[0];
      const alternative = ranked[1]?.score ?? 0;
      const margin = best.score - alternative;
      const independent =
        new Set(
          [
            asset.sourceContentDigest,
            best.left?.sourceContentDigest,
            best.right?.sourceContentDigest,
          ].filter(Boolean),
        ).size === 3;
      const supported =
        independent &&
        best.score >= policy.minimumSimilarity &&
        margin >= policy.minimumMargin;
      candidates.push({
        assetId: asset.assetId,
        bodyId: body.bodyId,
        candidateId: `context_${digest({ assetId: asset.assetId, bodyId: body.bodyId, subject: best.subject }).slice(0, 32)}`,
        evidence: {
          alternativeScore: round6(alternative),
          leftAssetId: best.left?.assetId ?? null,
          margin: round6(margin),
          reasonCodes: !independent
            ? ["DUPLICATE_SOURCE_EVIDENCE"]
            : supported
              ? [
                  "BIDIRECTIONAL_ACCEPTED_SUPPORT",
                  "BODY_APPEARANCE_SUPPORTED",
                  "COMPETITOR_SEPARATED",
                ]
              : ["CONTEXT_EVIDENCE_INSUFFICIENT"],
          rightAssetId: best.right?.assetId ?? null,
          similarity: round6(best.score),
        },
        kind: "body_candidate",
        state: supported ? "supported" : "abstained",
        subject: best.subject,
      });
    }
  }
  return {
    anchorCount: anchors.length,
    candidates,
    contextKind,
    policy,
    state: candidates.some(
      (candidate) =>
        candidate.state === "supported" || candidate.state === "possible",
    )
      ? "candidates"
      : "abstained",
  };
};

export { cosine };
