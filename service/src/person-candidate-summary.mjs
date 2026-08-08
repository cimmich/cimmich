export const createPersonCandidateSummary = (sql, { presentationRank }) =>
  async function personCandidateSummary() {
    const rows = await sql`
      WITH latest_possible_run AS MATERIALIZED (
        SELECT run_id FROM possible_person_run
        WHERE state = 'completed' AND classification_state = 'completed'
        ORDER BY completed_at DESC, run_id DESC LIMIT 1
      ), face_suggestions AS MATERIALIZED (
        SELECT claim.person_id, person.display_name,
          count(*)::int AS suggestion_count,
          count(DISTINCT face.asset_id)::int AS asset_count,
          max(nullif(claim.evidence_refs->>'best_score', '')::float8)::float8 AS best_score,
          max(nullif(claim.evidence_refs->>'margin', '')::float8)::float8 AS best_margin
        FROM identity_claim claim
        -- Review claims against the exact evaluated pack that produced them.
        -- Pack retirement removes generation authority, not review history.
        LEFT JOIN source_pack pack
          ON pack.pack_id = claim.evidence_refs->>'source_pack_id'
          AND pack.state IN ('active', 'retired')
          AND pack.evaluation_status = 'passed'
          AND pack.evaluation_summary->'matcherPolicy'->>'policyVersion' =
            claim.evidence_refs->>'policy_version'
        JOIN person
          ON person.person_id = claim.person_id
          AND person.status = 'active'
          AND person.subject_kind = 'person'
          AND cimmich_visibility_person_rank(person.person_id) <= ${presentationRank()}
        JOIN face_observation face
          ON face.face_id = claim.face_id
          AND face.state = 'valid'
        JOIN asset
          ON asset.asset_id = face.asset_id
          AND asset.state = 'active'
        WHERE claim.state = 'candidate'
          AND cimmich_face_match_eligible(
            face.detection_confidence, face.box_w, face.box_h
          )
          AND coalesce((SELECT review.reason_code FROM decision review WHERE review.subject_type = 'face_review' AND review.subject_id = face.face_id ORDER BY review.created_at DESC, review.decision_id DESC LIMIT 1), '') NOT IN ('face_review_unknown', 'face_review_later', 'face_review_geometry')
          AND cimmich_person_candidate_reviewable(
            claim.origin, claim.evidence_refs, pack.pack_id
          )
        GROUP BY claim.person_id, person.display_name
      ), grouped_suggestions AS MATERIALIZED (
        SELECT cluster.suggested_person_id AS person_id, person.display_name,
          count(DISTINCT face.face_id)::int AS suggestion_count,
          count(DISTINCT face.asset_id)::int AS asset_count,
          max((cluster.suggestion_evidence->>'leadScore')::float8)::float8 AS best_score,
          max((cluster.suggestion_evidence->>'margin')::float8)::float8 AS best_margin
        FROM latest_possible_run run
        JOIN face_cluster cluster ON cluster.possible_person_run_id = run.run_id
          AND cluster.status = 'open' AND cluster.suggested_person_id IS NOT NULL
        JOIN person ON person.person_id = cluster.suggested_person_id
          AND person.status = 'active' AND person.subject_kind = 'person'
          AND cimmich_visibility_person_rank(person.person_id) <= ${presentationRank()}
        JOIN face_cluster_member member ON member.cluster_id = cluster.cluster_id
        JOIN face_observation face ON face.face_id = member.face_id AND face.state = 'valid'
        JOIN asset ON asset.asset_id = face.asset_id AND asset.state = 'active'
        WHERE NOT EXISTS (
          SELECT 1 FROM identity_claim decided
          WHERE decided.face_id = member.face_id
            AND decided.state IN ('accepted','candidate')
        )
        GROUP BY cluster.suggested_person_id, person.display_name
      ), combined AS (
        SELECT * FROM face_suggestions
        UNION ALL
        SELECT * FROM grouped_suggestions
      )
      SELECT person_id, display_name,
        sum(suggestion_count)::int AS suggestion_count,
        sum(asset_count)::int AS asset_count,
        max(best_score)::float8 AS best_score,
        max(best_margin)::float8 AS best_margin
      FROM combined
      GROUP BY person_id, display_name
      ORDER BY suggestion_count DESC, display_name, person_id
    `;

    return {
      items: rows.map((row) => ({
        assetCount: Number(row.asset_count),
        bestMargin: row.best_margin,
        bestScore: row.best_score,
        displayName: row.display_name,
        personId: row.person_id,
        suggestionCount: Number(row.suggestion_count),
      })),
      schemaVersion: "cimmich.person-candidate-summary.v2",
      totalCandidates: rows.reduce(
        (total, row) => total + Number(row.suggestion_count),
        0,
      ),
      totalPeople: rows.length,
    };
  };
