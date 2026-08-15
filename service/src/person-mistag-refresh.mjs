const crossPersonScoreFloor = 0.35;
const crossPersonMarginFloor = 0.21;

const numberOrNull = (value) =>
  value === null || value === undefined ? null : Number(value);

export const selectPersonMistagRefreshOutcome = (row) => {
  const assignedScore = numberOrNull(row.assigned_score);
  const alternativeScore = numberOrNull(row.alternative_score);
  const ownScore = numberOrNull(row.own_score);
  const priorFloor = numberOrNull(row.comparison_score);
  if (
    assignedScore !== null &&
    alternativeScore !== null &&
    alternativeScore >= crossPersonScoreFloor &&
    alternativeScore - assignedScore >= crossPersonMarginFloor
  ) {
    return {
      comparisonScore: assignedScore,
      evidenceRoute: "cross_person_match",
      margin: alternativeScore - assignedScore,
      referenceAssetId: row.alternative_reference_asset_id,
      score: alternativeScore,
      suggestedPersonId: row.alternative_person_id,
    };
  }
  if (
    row.evidence_route === "own_cluster_outlier" &&
    ownScore !== null &&
    priorFloor !== null &&
    ownScore < priorFloor
  ) {
    return {
      comparisonScore: priorFloor,
      evidenceRoute: "own_cluster_outlier",
      margin: priorFloor - ownScore,
      referenceAssetId: row.own_reference_asset_id,
      score: ownScore,
      suggestedPersonId: row.assigned_person_id,
    };
  }
  return null;
};

export const createPersonMistagRefresher = ({
  requireVisibleSubject,
  sql,
}) => ({
  async refresh({ personId }) {
    const id = String(personId || "").trim();
    await requireVisibleSubject(id);
    return sql.begin(async (tx) => {
      await tx`
        SELECT set_config('statement_timeout', '20000', true),
          set_config('transaction_timeout', '25000', true),
          set_config('ivfflat.probes', '8', true),
          pg_advisory_xact_lock(
            hashtextextended(${"person-mistag-refresh:" + id}, 0)
          )
      `;
      const rows = await tx`
        WITH latest_run AS MATERIALIZED (
          SELECT run.audit_run_id, run.pack_id
          FROM identity_audit_run run
          WHERE run.state = 'completed'
          ORDER BY run.started_at DESC, run.audit_run_id DESC
          LIMIT 1
        ), lane AS MATERIALIZED (
          SELECT item.audit_run_id, item.face_id AS item_face_id,
            item.physical_face_id, item.asset_id,
            item.assigned_person_id, item.suggested_person_id,
            item.comparison_score, item.evidence_route,
            query_embedding.embedding::vector(512) AS embedding,
            coalesce(context.context_ids, ARRAY[]::text[]) AS context_ids
          FROM current_physical_identity_audit_item item
          JOIN latest_run run ON run.audit_run_id = item.audit_run_id
          JOIN source_pack pack ON pack.pack_id = run.pack_id
          JOIN face_observation face ON face.face_id = item.face_id
            AND face.state = 'valid'
          JOIN asset ON asset.asset_id = item.asset_id
            AND asset.state = 'active'
          JOIN face_embedding query_embedding
            ON query_embedding.face_id = item.face_id
            AND query_embedding.state = 'active'
            AND query_embedding.model_family = pack.model_family
            AND query_embedding.model_version = pack.model_version
            AND query_embedding.config_digest = pack.config_digest
          LEFT JOIN LATERAL (
            SELECT array_agg(capture.context_id ORDER BY capture.context_id)
              AS context_ids
            FROM current_face_capture_context capture
            WHERE capture.face_id = item.face_id
          ) context ON true
          WHERE item.audit_kind = 'accepted_contradiction'
            AND item.review_state = 'open'
            AND (
              item.assigned_person_id = ${id}
              OR item.suggested_person_id = ${id}
            )
            AND EXISTS (
              SELECT 1
              FROM current_physical_face_identity accepted
              WHERE accepted.physical_face_id = item.physical_face_id
                AND accepted.person_id = item.assigned_person_id
                AND accepted.state = 'accepted'
            )
        ), accepted_people_by_asset AS MATERIALIZED (
          SELECT DISTINCT face.asset_id, identity.person_id
          FROM current_physical_face_identity identity
          JOIN current_matchable_physical_face face
            ON face.physical_face_id = identity.physical_face_id
          WHERE identity.state = 'accepted'
        ), gallery AS MATERIALIZED (
          SELECT reference.person_id, reference.face_id,
            physical.physical_face_id, face.asset_id,
            embedding.embedding::vector(512) AS embedding,
            coalesce(context.context_ids, ARRAY[]::text[]) AS context_ids
          FROM current_reference_gallery reference
          JOIN current_person person ON person.person_id = reference.person_id
            AND person.status = 'active' AND person.subject_kind = 'person'
          JOIN face_observation face ON face.face_id = reference.face_id
            AND face.state = 'valid'
          JOIN current_face_physical_member physical
            ON physical.face_id = reference.face_id
          JOIN latest_run run ON true
          JOIN source_pack pack ON pack.pack_id = run.pack_id
          JOIN face_embedding embedding
            ON embedding.face_id = reference.face_id
            AND embedding.state = 'active'
            AND embedding.model_family = pack.model_family
            AND embedding.model_version = pack.model_version
            AND embedding.config_digest = pack.config_digest
          LEFT JOIN LATERAL (
            SELECT array_agg(capture.context_id ORDER BY capture.context_id)
              AS context_ids
            FROM current_face_capture_context capture
            WHERE capture.face_id = reference.face_id
          ) context ON true
          WHERE reference.membership_state = 'active'
            AND reference.bucket_kind = 'prime'
            AND NOT EXISTS (
              SELECT 1 FROM current_person_category category
              WHERE category.person_id = reference.person_id
                AND category.slug IN ('sort', 'holding')
            )
        ), person_scores AS MATERIALIZED (
          SELECT lane.item_face_id, gallery.person_id,
            max(1 - (gallery.embedding <=> lane.embedding))::float8 AS score,
            (array_agg(
              gallery.asset_id
              ORDER BY gallery.embedding <=> lane.embedding, gallery.face_id
            ))[1] AS reference_asset_id
          FROM lane
          JOIN gallery ON gallery.face_id <> lane.item_face_id
            AND gallery.physical_face_id <> lane.physical_face_id
            AND gallery.asset_id <> lane.asset_id
            AND NOT (gallery.context_ids && lane.context_ids)
            AND NOT cimmich_probable_same_photo_derivative(
              (SELECT pack_id FROM latest_run),
              lane.asset_id, gallery.asset_id
            )
          LEFT JOIN accepted_people_by_asset same_photo_person
            ON same_photo_person.asset_id = lane.asset_id
            AND same_photo_person.person_id = gallery.person_id
          WHERE same_photo_person.person_id IS NULL
            OR gallery.person_id = lane.assigned_person_id
          GROUP BY lane.item_face_id, gallery.person_id
        ), assigned AS MATERIALIZED (
          SELECT score.item_face_id, score.score, score.reference_asset_id
          FROM person_scores score
          JOIN lane ON lane.item_face_id = score.item_face_id
            AND lane.assigned_person_id = score.person_id
        ), alternative AS MATERIALIZED (
          SELECT ranked.item_face_id, ranked.person_id,
            ranked.score, ranked.reference_asset_id
          FROM (
            SELECT score.*,
              row_number() OVER (
                PARTITION BY score.item_face_id
                ORDER BY score.score DESC, score.person_id
              ) AS rank
            FROM person_scores score
            JOIN lane ON lane.item_face_id = score.item_face_id
            WHERE score.person_id <> lane.assigned_person_id
          ) ranked
          WHERE ranked.rank = 1
        )
        SELECT lane.*,
          assigned.score AS assigned_score,
          alternative.person_id AS alternative_person_id,
          alternative.score AS alternative_score,
          alternative.reference_asset_id AS alternative_reference_asset_id,
          own.score AS own_score,
          own.reference_asset_id AS own_reference_asset_id
        FROM lane
        LEFT JOIN assigned ON assigned.item_face_id = lane.item_face_id
        LEFT JOIN alternative
          ON alternative.item_face_id = lane.item_face_id
        LEFT JOIN LATERAL (
          SELECT
            (1 - (support_embedding.embedding::vector(512) <=>
              lane.embedding))::float8 AS score,
            support_face.asset_id AS reference_asset_id
          FROM current_physical_face_identity support_identity
          JOIN face_observation support_face
            ON support_face.face_id = support_identity.canonical_face_id
            AND support_face.state = 'valid'
          JOIN latest_run run ON true
          JOIN source_pack pack ON pack.pack_id = run.pack_id
          JOIN face_embedding support_embedding
            ON support_embedding.face_id = support_face.face_id
            AND support_embedding.state = 'active'
            AND support_embedding.model_family = pack.model_family
            AND support_embedding.model_version = pack.model_version
            AND support_embedding.config_digest = pack.config_digest
          LEFT JOIN LATERAL (
            SELECT array_agg(capture.context_id ORDER BY capture.context_id)
              AS context_ids
            FROM current_face_capture_context capture
            WHERE capture.face_id = support_face.face_id
          ) support_context ON true
          WHERE lane.evidence_route = 'own_cluster_outlier'
            AND support_identity.person_id = lane.assigned_person_id
            AND support_identity.state = 'accepted'
            AND support_identity.physical_face_id <> lane.physical_face_id
            AND support_face.asset_id <> lane.asset_id
            AND NOT (
              coalesce(support_context.context_ids, ARRAY[]::text[])
              && lane.context_ids
            )
          ORDER BY support_embedding.embedding::vector(512) <=> lane.embedding,
            support_face.face_id
          LIMIT 1
        ) own ON true
        ORDER BY lane.item_face_id
      `;
      let retainedCount = 0;
      let resolvedCount = 0;
      let routeChangedCount = 0;
      for (const row of rows) {
        const outcome = selectPersonMistagRefreshOutcome(row);
        if (!outcome) {
          await tx`
            DELETE FROM identity_audit_item
            WHERE audit_run_id = ${row.audit_run_id}
              AND audit_kind = 'accepted_contradiction'
              AND face_id = ${row.item_face_id}
              AND review_state = 'open'
          `;
          resolvedCount += 1;
          continue;
        }
        await tx`
          UPDATE identity_audit_item
          SET suggested_person_id = ${outcome.suggestedPersonId},
            suggested_score = ${outcome.score},
            comparison_score = ${outcome.comparisonScore},
            margin = ${outcome.margin},
            evidence_route = ${outcome.evidenceRoute},
            suggested_reference_asset_id = ${outcome.referenceAssetId}
          WHERE audit_run_id = ${row.audit_run_id}
            AND audit_kind = 'accepted_contradiction'
            AND face_id = ${row.item_face_id}
            AND review_state = 'open'
        `;
        retainedCount += 1;
        if (outcome.evidenceRoute !== row.evidence_route) {
          routeChangedCount += 1;
        }
      }
      const runId = rows[0]?.audit_run_id || null;
      if (runId) {
        await tx`
          UPDATE identity_audit_run
          SET contradiction_candidates = (
            SELECT count(*)::int
            FROM identity_audit_item
            WHERE audit_run_id = ${runId}
              AND audit_kind = 'accepted_contradiction'
              AND review_state = 'open'
          )
          WHERE audit_run_id = ${runId} AND state = 'completed'
        `;
      }
      return {
        personId: id,
        reevaluatedCount: rows.length,
        remainingCount: retainedCount,
        resolvedCount,
        routeChangedCount,
        schemaVersion: "cimmich.person-mistag-refresh.v1",
      };
    });
  },
});
