import {
  loadSourcePackFaces,
  persistSourcePack,
} from "./source-pack-repository.mjs";
import {
  buildPhotoIsolatedPacks,
  chooseGuardedSecondaryPolicy,
  photoIsolatedOutcomes,
  photoHoldoutEvaluatorVersion,
  summarizeSecondaryTransitions,
  summarizeModifierTransitions,
  summarizePhotoIsolatedScores,
} from "./source-pack-photo-holdout.mjs";
import { digestValue } from "./source-pack.mjs";

const photoEvaluationReceiptId =
  "receipt_cimmich_context_isolated_evaluator_v2";

export const summarizePhotoIsolatedSplit = (rows, policy) => {
  const outcomes = photoIsolatedOutcomes(rows, policy);
  return {
    ...summarizePhotoIsolatedScores(rows, policy),
    modifierTransitions: summarizeModifierTransitions(rows, policy),
    secondaryTransitions: summarizeSecondaryTransitions(outcomes),
  };
};

const persistPhotoIsolatedEvaluation = async (sql, evaluation) => {
  const evaluationId = `evaluation_${digestValue(evaluation).slice(0, 32)}`;
  return sql.begin(async (tx) => {
    const now = new Date();
    await tx`
      INSERT INTO producer_receipt (
        producer_receipt_id, producer_kind, producer_name, producer_version,
        started_at, completed_at, privacy_class
      ) VALUES (
        ${photoEvaluationReceiptId}, 'system', 'cimmich-context-isolated-evaluator', 'v2',
        ${now}, ${now}, 'private'
      ) ON CONFLICT (producer_receipt_id) DO UPDATE SET completed_at = excluded.completed_at
    `;
    const inserted = await tx`
      INSERT INTO source_pack_evaluation (
        evaluation_id, pack_id, evaluator_version, split_definition, cohort_digest,
        leakage_assertions, metrics, status, producer_receipt_id, privacy_class
      ) VALUES (
        ${evaluationId}, ${evaluation.holdoutPackId}, ${photoHoldoutEvaluatorVersion},
        ${tx.json(evaluation.split)}, ${evaluation.cohortDigest},
        ${tx.json(evaluation.leakage)}, ${tx.json(evaluation.metrics)},
        'incomplete', ${photoEvaluationReceiptId}, 'private'
      ) ON CONFLICT (evaluation_id) DO NOTHING
      RETURNING evaluation_id
    `;
    await tx`
      UPDATE source_pack
      SET evaluation_status = 'incomplete',
          evaluation_summary = ${tx.json({ evaluationId, ...evaluation.metrics })}
      WHERE pack_id = ${evaluation.holdoutPackId}
    `;
    return { created: inserted.length === 1, evaluationId };
  });
};

export const scorePhotoIsolatedPack = async (
  sql,
  packId,
  queries,
  { queryConditions = {} } = {},
) => {
  const requested = queries.map((query) => ({
    conditions: queryConditions[query.faceId] || [],
    contextIds: query.captureContextIds || [],
    faceId: query.faceId,
  }));
  const rows = await sql`
    WITH requested AS (
      SELECT item->>'faceId' AS query_face_id,
        ARRAY(
          SELECT jsonb_array_elements_text(coalesce(item->'conditions', '[]'::jsonb))
        ) AS query_conditions,
        ARRAY(
          SELECT jsonb_array_elements_text(coalesce(item->'contextIds', '[]'::jsonb))
        ) AS query_context_ids
      FROM jsonb_array_elements(${sql.json(requested)}::jsonb) item
    ), queries AS (
      SELECT cfi.person_id AS truth_person_id, fo.face_id AS query_face_id,
        fo.asset_id AS query_asset_id, fe.embedding AS query_embedding,
        requested.query_conditions, requested.query_context_ids,
        (
          EXISTS (
            SELECT 1 FROM current_reference_gallery lq
            WHERE lq.person_id = cfi.person_id AND lq.face_id = fo.face_id
              AND lq.bucket_kind = 'lq' AND lq.membership_state = 'active'
          )
          OR least(round(a.width * fo.box_w), round(a.height * fo.box_h)) < 80
          OR (
            fo.quality_measurements ? 'quality_score'
            AND (fo.quality_measurements->>'quality_score')::float8 > 0
            AND coalesce((fo.quality_measurements->>'quality_score')::float8, 0) < 0.68
            AND fo.detection_confidence > 0 AND fo.detection_confidence < 0.75
          )
        ) AS query_low_quality,
        CASE WHEN EXISTS (
          SELECT 1 FROM current_reference_gallery lq
          WHERE lq.person_id = cfi.person_id AND lq.face_id = fo.face_id
            AND lq.bucket_kind = 'lq' AND lq.membership_state = 'active'
        ) THEN 'lq' ELSE CASE coalesce(fo.quality_measurements->>'source_instance_suffix', '')
          WHEN '' THEN 'prime'
          WHEN 'blank' THEN 'prime'
          WHEN '1' THEN 'secondary'
          WHEN '2' THEN 'body_presence'
          ELSE 'unknown'
        END END AS source_tier_hint
      FROM requested
      JOIN current_face_identity cfi
        ON cfi.face_id = requested.query_face_id AND cfi.state = 'accepted'
      JOIN face_observation fo ON fo.face_id = cfi.face_id AND fo.state = 'valid'
      JOIN asset a ON a.asset_id = fo.asset_id
      JOIN face_embedding fe ON fe.face_id = fo.face_id AND fe.state = 'active'
      JOIN source_pack p ON p.pack_id = ${packId}
        AND p.model_family = fe.model_family
        AND p.model_version = fe.model_version
        AND p.config_digest = fe.config_digest
      WHERE fo.observation_origin <> 'manual_user' OR EXISTS (
        SELECT 1 FROM current_manual_face_matching_evidence lifecycle
        WHERE lifecycle.face_id = fo.face_id
          AND lifecycle.embedding_id = fe.embedding_id
          AND lifecycle.vector_digest = fe.vector_digest
      )
    ), prime_evidence AS (
      SELECT q.query_face_id, q.query_asset_id, q.truth_person_id, q.source_tier_hint,
        r.person_id, r.reference_kind,
        CASE WHEN r.reference_kind = 'face' THEN coalesce(
          (
            SELECT 'context:' || min(context->>'contextId')
            FROM jsonb_array_elements(
              coalesce(r.condition_features->'captureContexts', '[]'::jsonb)
            ) context
            WHERE context ? 'contextId'
          ),
          'asset:' || rf.asset_id
        ) ELSE 'prototype:' || r.reference_id END AS evidence_unit,
        (1 - (r.embedding <=> q.query_embedding))::float8 AS score
      FROM queries q
      JOIN source_pack_reference r ON r.pack_id = ${packId}
        AND r.bucket_kind = 'prime' AND r.routing_state = 'eligible'
      LEFT JOIN face_observation rf ON rf.face_id = r.face_id
      WHERE r.reference_kind = 'prototype' OR (
        rf.asset_id <> q.query_asset_id
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            coalesce(r.condition_features->'captureContexts', '[]'::jsonb)
          ) context
          WHERE context->>'contextId' = ANY(q.query_context_ids)
        )
      )
    ), individual_context_scores AS (
      SELECT query_face_id, query_asset_id, truth_person_id, source_tier_hint,
        person_id, evidence_unit, max(score)::float8 AS score
      FROM prime_evidence
      WHERE reference_kind = 'face'
      GROUP BY query_face_id, query_asset_id, truth_person_id, source_tier_hint,
        person_id, evidence_unit
    ), individual_ranked AS (
      SELECT *, row_number() OVER (
        PARTITION BY query_face_id, person_id ORDER BY score DESC
      ) AS evidence_rank
      FROM individual_context_scores
    ), individual_scores AS (
      SELECT query_face_id, query_asset_id, truth_person_id, source_tier_hint, person_id,
        max(score)::float8 AS individual_max,
        avg(score) FILTER (WHERE evidence_rank <= 3)::float8 AS individual_top3
      FROM individual_ranked
      GROUP BY query_face_id, query_asset_id, truth_person_id, source_tier_hint, person_id
    ), prototype_scores AS (
      SELECT query_face_id, query_asset_id, truth_person_id, source_tier_hint, person_id,
        max(score)::float8 AS prototype_score
      FROM prime_evidence
      WHERE reference_kind = 'prototype'
      GROUP BY query_face_id, query_asset_id, truth_person_id, source_tier_hint, person_id
    ), prime_scores AS (
      SELECT coalesce(i.query_face_id, p.query_face_id) AS query_face_id,
        coalesce(i.query_asset_id, p.query_asset_id) AS query_asset_id,
        coalesce(i.truth_person_id, p.truth_person_id) AS truth_person_id,
        coalesce(i.source_tier_hint, p.source_tier_hint) AS source_tier_hint,
        coalesce(i.person_id, p.person_id) AS person_id,
        greatest(coalesce(i.individual_max, -1), coalesce(p.prototype_score, -1))::float8 AS raw_score,
        CASE
          WHEN i.individual_top3 IS NOT NULL AND p.prototype_score IS NOT NULL
            THEN 0.45 * i.individual_top3 + 0.55 * p.prototype_score
          ELSE coalesce(p.prototype_score, i.individual_top3)
        END::float8 AS robust_score
      FROM individual_scores i
      FULL OUTER JOIN prototype_scores p
        USING (query_face_id, query_asset_id, truth_person_id, source_tier_hint, person_id)
    ), prime_ranked AS (
      SELECT *,
        row_number() OVER (PARTITION BY query_face_id ORDER BY raw_score DESC, person_id) AS raw_rank,
        row_number() OVER (PARTITION BY query_face_id ORDER BY robust_score DESC, person_id) AS robust_rank
      FROM prime_scores
    ), margins AS (
      SELECT query_face_id,
        max(robust_score) FILTER (WHERE robust_rank = 1) -
          max(robust_score) FILTER (WHERE robust_rank = 2) AS prime_margin
      FROM prime_ranked
      GROUP BY query_face_id
    ), secondary_scores AS (
      SELECT pr.query_face_id, pr.person_id,
        max(1 - (r.embedding <=> q.query_embedding))::float8 AS secondary_score
      FROM prime_ranked pr
      JOIN queries q USING (query_face_id)
      JOIN source_pack_reference r ON r.pack_id = ${packId}
        AND r.bucket_kind = 'secondary' AND r.reference_kind = 'face'
        AND r.routing_state <> 'disabled' AND r.person_id = pr.person_id
      JOIN face_observation rf ON rf.face_id = r.face_id AND rf.asset_id <> q.query_asset_id
      WHERE pr.robust_rank <= 2
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            coalesce(r.condition_features->'captureContexts', '[]'::jsonb)
          ) context
          WHERE context->>'contextId' = ANY(q.query_context_ids)
        )
      GROUP BY pr.query_face_id, pr.person_id
    ), modifier_scores AS (
      SELECT q.query_face_id, r.person_id,
        max(1 - (r.embedding <=> q.query_embedding))::float8 AS modifier_score
      FROM queries q
      JOIN source_pack_reference r ON r.pack_id = ${packId}
        AND r.bucket_kind IN ('prime','secondary','lq') AND r.reference_kind = 'face'
        AND r.routing_state <> 'disabled'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(coalesce(r.condition_features->'modifiers', '[]'::jsonb)) modifier
          WHERE modifier->>'label' = ANY(q.query_conditions)
             OR modifier->>'key' = ANY(q.query_conditions)
        )
      JOIN face_observation rf ON rf.face_id = r.face_id AND rf.asset_id <> q.query_asset_id
      WHERE NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          coalesce(r.condition_features->'captureContexts', '[]'::jsonb)
        ) context
        WHERE context->>'contextId' = ANY(q.query_context_ids)
      )
      GROUP BY q.query_face_id, r.person_id
    ), low_quality_scores AS (
      SELECT pr.query_face_id, pr.person_id,
        max(1 - (r.embedding <=> q.query_embedding))::float8 AS low_quality_score
      FROM prime_ranked pr
      JOIN queries q USING (query_face_id)
      JOIN source_pack_reference r ON r.pack_id = ${packId}
        AND r.bucket_kind = 'lq' AND r.reference_kind = 'face'
        AND r.routing_state = 'condition_only' AND r.person_id = pr.person_id
      JOIN face_observation rf ON rf.face_id = r.face_id AND rf.asset_id <> q.query_asset_id
      WHERE q.query_low_quality AND pr.robust_rank <= 2
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            coalesce(r.condition_features->'captureContexts', '[]'::jsonb)
          ) context
          WHERE context->>'contextId' = ANY(q.query_context_ids)
        )
      GROUP BY pr.query_face_id, pr.person_id
    ), candidate_people AS (
      SELECT query_face_id, person_id FROM prime_ranked WHERE robust_rank <= 2 OR raw_rank = 1
      UNION
      SELECT query_face_id, person_id FROM modifier_scores
      UNION
      SELECT query_face_id, truth_person_id AS person_id FROM queries
    )
    SELECT pr.query_face_id, pr.query_asset_id, pr.truth_person_id, pr.source_tier_hint, pr.person_id,
      pr.raw_score, pr.robust_score, pr.raw_rank::int, pr.robust_rank::int,
      m.prime_margin::float8, q.query_low_quality, ss.secondary_score,
      sp.modifier_score, lq.low_quality_score
    FROM candidate_people candidate
    JOIN prime_ranked pr USING (query_face_id, person_id)
    JOIN margins m USING (query_face_id)
    JOIN queries q USING (query_face_id)
    LEFT JOIN secondary_scores ss USING (query_face_id, person_id)
    LEFT JOIN modifier_scores sp USING (query_face_id, person_id)
    LEFT JOIN low_quality_scores lq USING (query_face_id, person_id)
    ORDER BY pr.query_face_id, pr.robust_rank, pr.person_id
  `;
  return rows.map((row) => ({
    personId: row.person_id,
    primeMargin: row.prime_margin,
    queryAssetId: row.query_asset_id,
    queryFaceId: row.query_face_id,
    rawPrimeScore: row.raw_score,
    rawRank: row.raw_rank,
    robustPrimeScore: row.robust_score,
    robustRank: row.robust_rank,
    lowQualityScore: row.low_quality_score,
    queryLowQuality: row.query_low_quality,
    secondaryScore: row.secondary_score,
    sourceTierHint: row.source_tier_hint,
    modifierScore: row.modifier_score,
    truthPersonId: row.truth_person_id,
  }));
};

export const runPhotoIsolatedEvaluation = async (
  sql,
  options,
  { execute = false, queryConditions = {} } = {},
) => {
  const faces = await loadSourcePackFaces(sql, options);
  const cohort = buildPhotoIsolatedPacks(faces, options);
  const calibrationPersistence = await persistSourcePack(
    sql,
    cohort.calibration.pack,
    { execute },
  );
  const holdoutPersistence = await persistSourcePack(sql, cohort.holdout.pack, {
    execute,
  });
  if (!execute) {
    return {
      cohort: { cohortDigest: cohort.cohortDigest, stats: cohort.stats },
      packs: {
        calibration: calibrationPersistence,
        holdout: holdoutPersistence,
      },
      status: "compiled-not-scored",
    };
  }

  const calibrationRows = await scorePhotoIsolatedPack(
    sql,
    cohort.calibration.pack.packId,
    cohort.calibration.queries,
    {
      queryConditions,
    },
  );
  const policy = chooseGuardedSecondaryPolicy(calibrationRows);
  const holdoutRows = await scorePhotoIsolatedPack(
    sql,
    cohort.holdout.pack.packId,
    cohort.holdout.queries,
    {
      queryConditions,
    },
  );
  const metrics = {
    calibration: summarizePhotoIsolatedSplit(calibrationRows, policy),
    holdout: summarizePhotoIsolatedSplit(holdoutRows, policy),
  };
  const resolverPolicy = {
    secondaryThreshold: policy.threshold,
    secondaryWeight: policy.weight,
    lowQualityWeight: 0.35,
    modifierWeight: 0.65,
    state: "diagnostic-only",
  };
  const evaluationPersistence = await persistPhotoIsolatedEvaluation(sql, {
    cohortDigest: cohort.cohortDigest,
    holdoutPackId: cohort.holdout.pack.packId,
    leakage: {
      queryContextRemovedBeforeCompilation: true,
      ungroupedQueryAssetRemovedBeforeCompilation: true,
      passed: true,
      queryReferenceOverlap: 0,
    },
    metrics: { ...metrics, policy: resolverPolicy },
    split: {
      calibrationPackId: cohort.calibration.pack.packId,
      calibrationQueries: cohort.calibration.queries.length,
      holdoutQueries: cohort.holdout.queries.length,
      seed: options.seed,
    },
  });
  return {
    cohort: {
      cohortDigest: cohort.cohortDigest,
      stats: cohort.stats,
    },
    evaluatorVersion: photoHoldoutEvaluatorVersion,
    evaluationPersistence,
    metrics,
    packs: {
      calibration: calibrationPersistence,
      holdout: holdoutPersistence,
    },
    policy: resolverPolicy,
    status: "incomplete",
  };
};
