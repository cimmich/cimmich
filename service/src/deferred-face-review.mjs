export const faceReviewReasonCode = ({ disposition, reviewReason }) =>
  disposition === "later"
    ? reviewReason === "geometry"
      ? "face_review_geometry"
      : "face_review_later"
    : disposition === "unknown"
      ? "face_review_unknown"
      : "face_review_resumed";

export const faceReviewReasonError = ({ disposition, reviewReason }) => {
  if (!["general", "geometry"].includes(reviewReason)) {
    return [
      "Face review reason must be general or geometry",
      "FACE_REVIEW_REASON_INVALID",
    ];
  }
  if (reviewReason === "geometry" && disposition !== "later") {
    return [
      "Geometry review can only be saved for later",
      "FACE_REVIEW_REASON_DISPOSITION_INVALID",
    ];
  }
  return null;
};

export const readDeferredFaceReviews = async ({
  bridge,
  bridgeFields,
  cleanLimit,
  limit,
  presentationRank,
  sql,
}) => {
  const boundedLimit = cleanLimit(limit, 100, 200);
  const visibleRank = presentationRank();
  const rows = await sql`
    WITH latest_review AS MATERIALIZED (
      SELECT DISTINCT ON (subject_id)
        subject_id AS face_id, decision_id, reason_code, action, created_at
      FROM decision
      WHERE subject_type = 'face_review'
      ORDER BY subject_id, created_at DESC, decision_id DESC
    )
    SELECT review.decision_id, review.reason_code, review.created_at,
      face.face_id, face.asset_id,
      face.box_x::float8, face.box_y::float8,
      face.box_w::float8, face.box_h::float8,
      face.detection_confidence::float8,
      asset.capture_time, asset.media_kind, asset.width, asset.height,
      candidate.person_id AS candidate_person_id,
      candidate.display_name AS candidate_display_name,
      candidate.match_score::float8 AS candidate_score,
      count(*) OVER()::int AS total
    FROM latest_review review
    JOIN face_observation face
      ON face.face_id = review.face_id AND face.state = 'valid'
    JOIN asset
      ON asset.asset_id = face.asset_id AND asset.state = 'active'
    LEFT JOIN LATERAL (
      SELECT claim.person_id, person.display_name,
        coalesce(
          nullif(claim.evidence_refs->>'best_score', '')::numeric,
          claim.calibrated_confidence
        ) AS match_score
      FROM identity_claim claim
      JOIN person
        ON person.person_id = claim.person_id AND person.status = 'active'
      WHERE claim.face_id = face.face_id
        AND claim.state IN ('accepted', 'candidate')
        AND cimmich_visibility_subject_rank(
          person.subject_kind, person.person_id
        ) <= ${visibleRank}
      ORDER BY CASE WHEN claim.state = 'accepted' THEN 0 ELSE 1 END,
        coalesce(
          nullif(claim.evidence_refs->>'best_score', '')::numeric,
          claim.calibrated_confidence
        ) DESC NULLS LAST,
        claim.created_at DESC, claim.identity_claim_id DESC
      LIMIT 1
    ) candidate ON true
    WHERE review.action = 'ignore'
      AND review.reason_code IN ('face_review_later', 'face_review_geometry')
      AND cimmich_visibility_asset_rank(asset.asset_id) <= ${visibleRank}
    ORDER BY
      CASE WHEN review.reason_code = 'face_review_geometry' THEN 0 ELSE 1 END,
      review.created_at DESC, face.face_id
    LIMIT ${boundedLimit}
  `;
  return {
    items: rows.map((row) => ({
      assetId: row.asset_id,
      box: {
        h: Number(row.box_h),
        w: Number(row.box_w),
        x: Number(row.box_x),
        y: Number(row.box_y),
      },
      candidate:
        row.candidate_person_id && row.candidate_display_name
          ? {
              displayName: row.candidate_display_name,
              personId: row.candidate_person_id,
              score:
                row.candidate_score == null
                  ? null
                  : Number(row.candidate_score),
            }
          : null,
      captureTime: row.capture_time,
      createdAt: row.created_at,
      decisionId: row.decision_id,
      detectionConfidence: Number(row.detection_confidence),
      faceId: row.face_id,
      height: Number(row.height),
      mediaKind: row.media_kind,
      reason:
        row.reason_code === "face_review_geometry" ? "geometry" : "general",
      width: Number(row.width),
      ...bridgeFields(bridge, row.asset_id),
    })),
    limit: boundedLimit,
    schemaVersion: "cimmich.deferred-face-review.v1",
    total: Number(rows[0]?.total || 0),
  };
};
