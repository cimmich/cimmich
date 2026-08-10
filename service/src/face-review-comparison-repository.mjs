export const loadFaceReviewComparisonBatch = async (
  sql,
  { faceIds, limitPerFace, visibleRank },
) => {
  const rows = await sql`
    WITH hidden_assets AS MATERIALIZED (
      SELECT object_id
      FROM cimmich_visibility_object
      WHERE object_scope = 'asset'
        AND CASE visibility_tier
          WHEN 'personal' THEN 1
          WHEN 'private' THEN 2
          ELSE 0
        END > ${visibleRank}
    ), hidden_people AS MATERIALIZED (
      SELECT object_id
      FROM cimmich_visibility_object
      WHERE object_scope = 'person'
        AND CASE visibility_tier
          WHEN 'personal' THEN 1
          WHEN 'private' THEN 2
          ELSE 0
        END > ${visibleRank}
    ), query_faces AS MATERIALIZED (
      SELECT face.face_id, face.asset_id,
        accepted.person_id AS current_person_id
      FROM face_observation face
      JOIN asset query_asset ON query_asset.asset_id = face.asset_id
        AND query_asset.state = 'active'
      LEFT JOIN LATERAL (
        SELECT identity.person_id
        FROM identity_claim identity
        JOIN current_person person ON person.person_id = identity.person_id
          AND person.status = 'active' AND person.subject_kind = 'person'
          AND NOT EXISTS (
            SELECT 1 FROM hidden_people hidden
            WHERE hidden.object_id = person.person_id
          )
        WHERE identity.face_id = face.face_id
          AND identity.state = 'accepted'
        ORDER BY identity.identity_claim_id
        LIMIT 1
      ) accepted ON true
      WHERE face.face_id = ANY(${faceIds}) AND face.state = 'valid'
        AND cimmich_face_match_eligible(
          face.detection_confidence, face.box_w, face.box_h
        )
        AND NOT EXISTS (
          SELECT 1 FROM hidden_assets hidden
          WHERE hidden.object_id = query_asset.asset_id
        )
    ), candidate_spaces AS MATERIALIZED (
      SELECT query.face_id AS query_face_id, query.asset_id,
        query.current_person_id, candidate.embedding_id,
        candidate.model_family, candidate.model_version,
        candidate.config_digest, candidate.dimension, candidate.embedding,
        candidate.created_at
      FROM query_faces query
      JOIN face_embedding candidate ON candidate.face_id = query.face_id
        AND candidate.state = 'active'
    ), query_contexts AS MATERIALIZED (
      SELECT query.face_id AS query_face_id, member.context_id
      FROM query_faces query
      JOIN current_capture_context_member member
        ON member.asset_id = query.asset_id
    ), reference_pool AS MATERIALIZED (
      SELECT reference.face_id, reference.model_family,
        reference.model_version, reference.config_digest,
        reference.dimension, reference.embedding,
        reference_face.asset_id, identity.person_id, person.display_name
      FROM face_embedding reference
      JOIN face_observation reference_face
        ON reference_face.face_id = reference.face_id
        AND reference_face.state = 'valid'
      JOIN asset reference_asset
        ON reference_asset.asset_id = reference_face.asset_id
        AND reference_asset.state = 'active'
      JOIN identity_claim identity ON identity.face_id = reference.face_id
        AND identity.state = 'accepted'
      JOIN current_person person ON person.person_id = identity.person_id
        AND person.status = 'active' AND person.subject_kind = 'person'
      WHERE reference.state = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM hidden_assets hidden
          WHERE hidden.object_id = reference_asset.asset_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM hidden_people hidden
          WHERE hidden.object_id = person.person_id
        )
    ), space_reference_counts AS MATERIALIZED (
      SELECT candidate.query_face_id, candidate.embedding_id,
        count(DISTINCT reference.person_id)::int AS accepted_person_count
      FROM candidate_spaces candidate
      JOIN reference_pool reference
        ON reference.model_family = candidate.model_family
        AND reference.model_version = candidate.model_version
        AND reference.config_digest = candidate.config_digest
        AND reference.dimension = candidate.dimension
        AND reference.face_id <> candidate.query_face_id
        AND reference.asset_id <> candidate.asset_id
      WHERE NOT EXISTS (
        SELECT 1
        FROM current_capture_context_member reference_context
        JOIN query_contexts query_context
          ON query_context.query_face_id = candidate.query_face_id
          AND query_context.context_id = reference_context.context_id
        WHERE reference_context.asset_id = reference.asset_id
      )
      GROUP BY candidate.query_face_id, candidate.embedding_id
    ), query_ranked AS MATERIALIZED (
      SELECT candidate.*,
        row_number() OVER (
          PARTITION BY candidate.query_face_id
          ORDER BY coalesce(reference_count.accepted_person_count, 0) DESC,
            candidate.created_at DESC, candidate.embedding_id
        ) AS space_rank
      FROM candidate_spaces candidate
      LEFT JOIN space_reference_counts reference_count
        ON reference_count.query_face_id = candidate.query_face_id
        AND reference_count.embedding_id = candidate.embedding_id
    ), query AS MATERIALIZED (
      SELECT * FROM query_ranked WHERE space_rank = 1
    ), reference_scores AS MATERIALIZED (
      SELECT query.query_face_id, reference.person_id,
        reference.display_name, reference.face_id AS reference_face_id,
        (1 - (reference.embedding <=> query.embedding))::float8 AS similarity
      FROM query
      JOIN reference_pool reference
        ON reference.model_family = query.model_family
        AND reference.model_version = query.model_version
        AND reference.config_digest = query.config_digest
        AND reference.dimension = query.dimension
        AND reference.face_id <> query.query_face_id
        AND reference.asset_id <> query.asset_id
      WHERE NOT EXISTS (
        SELECT 1
        FROM current_capture_context_member reference_context
        JOIN query_contexts query_context
          ON query_context.query_face_id = query.query_face_id
          AND query_context.context_id = reference_context.context_id
        WHERE reference_context.asset_id = reference.asset_id
      )
    ), best_per_person AS MATERIALIZED (
      SELECT DISTINCT ON (query_face_id, person_id)
        query_face_id, person_id, display_name, reference_face_id, similarity,
        count(*) OVER (
          PARTITION BY query_face_id, person_id
        )::int AS accepted_example_count
      FROM reference_scores
      ORDER BY query_face_id, person_id, similarity DESC, reference_face_id
    ), visible_people AS MATERIALIZED (
      SELECT person.person_id, person.display_name
      FROM current_person person
      WHERE person.status = 'active' AND person.subject_kind = 'person'
        AND NOT EXISTS (
          SELECT 1 FROM hidden_people hidden
          WHERE hidden.object_id = person.person_id
        )
    ), selected AS MATERIALIZED (
      SELECT query.query_face_id, person.person_id, person.display_name,
        best.reference_face_id, best.similarity,
        coalesce(best.accepted_example_count, 0)::int AS accepted_example_count,
        coalesce(person.person_id = query.current_person_id, false)
          AS current_identity,
        CASE WHEN best.person_id IS NULL
          THEN 'no_independent_compatible_reference_face'
          ELSE NULL
        END AS unavailable_reason
      FROM query
      CROSS JOIN visible_people person
      LEFT JOIN best_per_person best
        ON best.query_face_id = query.query_face_id
        AND best.person_id = person.person_id
    ), ranked AS MATERIALIZED (
      SELECT selected.*,
        row_number() OVER (
          PARTITION BY query_face_id
          ORDER BY similarity DESC NULLS LAST,
            lower(display_name), person_id, reference_face_id
        )::int AS rank
      FROM selected
    )
    SELECT query_face_id, rank, person_id, display_name, similarity,
      similarity AS prime_score,
      CASE WHEN similarity IS NULL
        THEN NULL
        ELSE 'cosine_similarity'::text
      END AS score_kind,
      current_identity, accepted_example_count, unavailable_reason
    FROM ranked
    WHERE rank <= ${limitPerFace}
    ORDER BY query_face_id, rank
  `;

  const matchesByFace = new Map(faceIds.map((faceId) => [faceId, []]));
  for (const { query_face_id: faceId, ...match } of rows) {
    matchesByFace.get(faceId)?.push(match);
  }
  return faceIds.map((faceId) => ({
    faceId,
    matches: matchesByFace.get(faceId),
  }));
};
