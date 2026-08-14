export const identityAuditSuggestedReferenceSql = (presentationRankInput) => {
  const presentationRank = Number(presentationRankInput);
  if (
    !Number.isInteger(presentationRank) ||
    presentationRank < 0 ||
    presentationRank > 2
  ) {
    throw new Error("Identity audit reference presentation rank is invalid");
  }
  return `
  SELECT candidate.*
  FROM (
    SELECT reference.face_id, reference_face.asset_id,
      reference_face.box_x, reference_face.box_y,
      reference_face.box_w, reference_face.box_h,
      reference_asset.width, reference_asset.height,
      (1 - (reference.embedding <=> query_embedding.embedding))::float8
        AS score
    FROM source_pack_reference reference
    JOIN face_observation reference_face
      ON reference_face.face_id = reference.face_id
      AND reference_face.state = 'valid'
      AND reference_face.asset_id <> item.asset_id
    JOIN asset reference_asset
      ON reference_asset.asset_id = reference_face.asset_id
      AND reference_asset.state = 'active'
      AND cimmich_visibility_asset_rank(reference_asset.asset_id)
        <= ${presentationRank}
    WHERE item.evidence_route = 'cross_person_match'
      AND reference.pack_id = item_run.pack_id
      AND reference.routing_state = 'eligible'
      AND reference.person_id = item.suggested_person_id
      AND reference.bucket_kind = 'prime'
      AND reference.reference_kind = 'face'
      AND reference.face_id <> item.face_id
      AND (
        item.suggested_reference_asset_id IS NULL
        OR reference_face.asset_id = item.suggested_reference_asset_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM current_face_capture_context query_context
        JOIN current_face_capture_context reference_context
          ON reference_context.context_id = query_context.context_id
        WHERE query_context.face_id = item.face_id
          AND reference_context.face_id = reference.face_id
      )
    UNION ALL
    SELECT support_face.face_id, support_face.asset_id,
      support_face.box_x, support_face.box_y,
      support_face.box_w, support_face.box_h,
      support_asset.width, support_asset.height,
      (1 - (
        support_embedding.embedding <=> query_embedding.embedding
      ))::float8 AS score
    FROM identity_claim support_claim
    JOIN current_face_physical_member support_member
      ON support_member.face_id = support_claim.face_id
      AND support_member.reconciliation_state <> 'conflict'
    JOIN face_observation support_face
      ON support_face.face_id = support_member.canonical_face_id
      AND support_face.state = 'valid'
    JOIN face_embedding support_embedding
      ON support_embedding.face_id = support_face.face_id
      AND support_embedding.state = 'active'
      AND support_embedding.model_family = item_pack.model_family
      AND support_embedding.model_version = item_pack.model_version
      AND support_embedding.config_digest = item_pack.config_digest
    JOIN asset support_asset
      ON support_asset.asset_id = support_face.asset_id
      AND support_asset.state = 'active'
      AND cimmich_visibility_asset_rank(support_asset.asset_id)
        <= ${presentationRank}
    WHERE item.evidence_route = 'own_cluster_outlier'
      AND support_claim.state = 'accepted'
      AND support_claim.person_id = item.assigned_person_id
      AND support_face.face_id <> item.face_id
      AND support_face.asset_id = item.suggested_reference_asset_id
  ) candidate
  ORDER BY candidate.score DESC, candidate.face_id
  LIMIT 1
`;
};
