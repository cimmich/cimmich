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

const faceBodyAssociation = (face, body) => {
  const faceCenter = {
    x: face.box.x + face.box.w / 2,
    y: face.box.y + face.box.h / 2,
  };
  const padding = 0.025;
  const inside =
    faceCenter.x >= body.box.x - padding &&
    faceCenter.x <= body.box.x + body.box.w + padding &&
    faceCenter.y >= body.box.y - padding &&
    faceCenter.y <= body.box.y + body.box.h * 0.55 + padding;
  if (!inside) return null;
  const bodyCenterX = body.box.x + body.box.w / 2;
  const horizontalDistance =
    Math.abs(faceCenter.x - bodyCenterX) / Math.max(body.box.w, 0.001);
  const expectedHeadY = body.box.y + Math.min(body.box.h * 0.14, 0.12);
  const verticalDistance =
    Math.abs(faceCenter.y - expectedHeadY) / Math.max(body.box.h, 0.001);
  return 3 - horizontalDistance - verticalDistance;
};

// Accepted face/identity rows belong to the protected champion. They are used
// only to associate that accepted anchor with a challenger body box in the same
// image. No challenger face result is allowed to create an identity anchor.
const anchorAssignments = (asset) => {
  const bodies = asset.operations?.bodies?.bodies ?? [];
  const assignments = [];
  const usedBodies = new Set();
  const usedSubjects = new Set();
  for (const subject of asset.acceptedSubjects) {
    const explicitIndex = asset.bodyAssignments?.[subject];
    if (
      explicitIndex !== undefined &&
      bodies[explicitIndex]?.appearanceFeature &&
      !usedBodies.has(bodies[explicitIndex].bodyId)
    ) {
      assignments.push({
        association: "explicit_accepted_assignment",
        body: bodies[explicitIndex],
        subject,
      });
      usedBodies.add(bodies[explicitIndex].bodyId);
      usedSubjects.add(subject);
    }
  }

  const championFaces = (asset.baselineObservations?.faces ?? []).filter(
    ({ subject }) => subject && asset.acceptedSubjects.includes(subject),
  );
  const possible = championFaces.flatMap((face) =>
    bodies
      .filter(
        (body) => body.appearanceFeature && !usedBodies.has(body.bodyId),
      )
      .map((body) => ({
        body,
        face,
        score: faceBodyAssociation(face, body),
        subject: face.subject,
      }))
      .filter(
        ({ score, subject }) => score !== null && !usedSubjects.has(subject),
      ),
  );
  possible.sort(
    (left, right) =>
      right.score - left.score || left.subject.localeCompare(right.subject),
  );
  for (const candidate of possible) {
    if (
      usedSubjects.has(candidate.subject) ||
      usedBodies.has(candidate.body.bodyId)
    )
      continue;
    assignments.push({
      association: "champion_face_geometry",
      body: candidate.body,
      subject: candidate.subject,
    });
    usedBodies.add(candidate.body.bodyId);
    usedSubjects.add(candidate.subject);
  }

  if (
    asset.acceptedSubjects.length === 1 &&
    bodies.length === 1 &&
    bodies[0].appearanceFeature &&
    !usedSubjects.size
  ) {
    assignments.push({
      association: "single_accepted_subject_single_body",
      body: bodies[0],
      subject: asset.acceptedSubjects[0],
    });
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

const timestamp = (asset) => {
  const value = Date.parse(asset.captureTime ?? "");
  return Number.isFinite(value) ? value : null;
};

const temporalEvidence = (asset, left, right, maximumSeconds) => {
  const target = timestamp(asset);
  const leftTime = timestamp(left ?? {});
  const rightTime = timestamp(right ?? {});
  const leftGapSeconds =
    target === null || leftTime === null
      ? null
      : Math.abs(target - leftTime) / 1000;
  const rightGapSeconds =
    target === null || rightTime === null
      ? null
      : Math.abs(rightTime - target) / 1000;
  return {
    eligible:
      leftGapSeconds !== null &&
      rightGapSeconds !== null &&
      leftGapSeconds <= maximumSeconds &&
      rightGapSeconds <= maximumSeconds,
    leftGapSeconds,
    rightGapSeconds,
  };
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
      captureTime: asset.captureTime,
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
        const temporal = temporalEvidence(
          asset,
          left,
          right,
          policy.maximumTemporalGapSeconds,
        );
        candidates.push({
          assetId: asset.assetId,
          candidateId: `context_${digest({ assetId: asset.assetId, kind: "presence", subject }).slice(0, 32)}`,
          evidence: {
            leftAssetId: left?.assetId ?? null,
            leftGapSeconds: temporal.leftGapSeconds,
            reasonCodes: independent
              ? [
                  "ORDERED_ACCEPTED_SUPPORT",
                  ...(temporal.eligible ? ["TEMPORAL_PROXIMITY_SUPPORTED"] : []),
                  "NO_USABLE_TARGET_BODY",
                ]
              : ["DUPLICATE_SOURCE_EVIDENCE"],
            rightAssetId: right?.assetId ?? null,
            rightGapSeconds: temporal.rightGapSeconds,
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
      const competingBodies = bodies
        .map((candidateBody) => ({
          bodyId: candidateBody.bodyId,
          score: bodyScore(candidateBody, best.left, best.right),
        }))
        .sort(
          (left, right) =>
            right.score - left.score || left.bodyId.localeCompare(right.bodyId),
        );
      const bodyWinner = competingBodies[0]?.bodyId === body.bodyId;
      const bodyAlternative = competingBodies[1]?.score ?? 0;
      const bodyMargin = bodyWinner ? best.score - bodyAlternative : 0;
      const independent =
        new Set(
          [
            asset.sourceContentDigest,
            best.left?.sourceContentDigest,
            best.right?.sourceContentDigest,
          ].filter(Boolean),
        ).size === 3;
      const appearanceSupported =
        best.score >= policy.minimumSimilarity &&
        margin >= policy.minimumMargin &&
        bodyWinner &&
        bodyMargin >= policy.minimumMargin;
      const supported = independent && appearanceSupported;
      const temporal = temporalEvidence(
        asset,
        best.left,
        best.right,
        policy.maximumTemporalGapSeconds,
      );
      const temporalPossible =
        independent &&
        !supported &&
        temporal.eligible &&
        bodies.length === 1 &&
        subjects.length === 1;
      candidates.push({
        assetId: asset.assetId,
        bodyId: body.bodyId,
        candidateId: `context_${digest({ assetId: asset.assetId, bodyId: body.bodyId, subject: best.subject }).slice(0, 32)}`,
        evidence: {
          alternativeScore: round6(alternative),
          bodyAlternativeScore: round6(bodyAlternative),
          bodyMargin: round6(bodyMargin),
          leftAnchorAssociation: best.left?.association ?? null,
          leftAssetId: best.left?.assetId ?? null,
          leftGapSeconds: temporal.leftGapSeconds,
          margin: round6(margin),
          reasonCodes: !independent
            ? ["DUPLICATE_SOURCE_EVIDENCE"]
            : supported
              ? [
                  "BIDIRECTIONAL_ACCEPTED_SUPPORT",
                  "BODY_APPEARANCE_SUPPORTED",
                  "BODY_COMPETITOR_SEPARATED",
                  "COMPETITOR_SEPARATED",
                ]
              : temporalPossible
                ? [
                    "BIDIRECTIONAL_ACCEPTED_SUPPORT",
                    "TEMPORAL_PROXIMITY_SUPPORTED",
                    "SINGLE_UNASSIGNED_BODY",
                    "BODY_APPEARANCE_INSUFFICIENT",
                  ]
                : ["CONTEXT_EVIDENCE_INSUFFICIENT"],
          rightAnchorAssociation: best.right?.association ?? null,
          rightAssetId: best.right?.assetId ?? null,
          rightGapSeconds: temporal.rightGapSeconds,
          similarity: round6(best.score),
        },
        kind: "body_candidate",
        state: supported
          ? "supported"
          : temporalPossible
            ? "possible"
            : "abstained",
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

export { anchorAssignments, cosine };
