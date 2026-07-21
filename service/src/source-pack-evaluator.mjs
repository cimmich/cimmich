import { digestValue } from "./source-pack.mjs";
import {
  sourcePackGateSchemaVersion,
  sourcePackMatcherPolicyVersion,
  validateSourcePackGateReceipt,
} from "./source-pack-lifecycle.mjs";

export const sourcePackEvaluatorVersion = "cimmich-source-pack-evaluator-v1";
export const sourcePackReviewGatePolicyVersion =
  "cimmich-owner-open-set-gate-v1";

const reviewGateThresholds = Object.freeze({
  maximumUnknownFalseAcceptRatePercent: 2.5,
  minimumDecisionPrecisionPercent: 98,
  minimumVerifiedUnknowns: 100,
});

const rounded = (value) => Number(Number(value || 0).toFixed(6));

const operatingMetrics = (rows, scoreFloor, marginFloor) => {
  const decisions = rows.filter(
    (row) =>
      Number(row.winner_score) >= scoreFloor &&
      Number(row.margin) >= marginFloor,
  );
  const known = rows.filter((row) => row.known_person === true);
  const unknown = rows.filter((row) => row.known_person !== true);
  const correctKnown = decisions.filter(
    (row) =>
      row.known_person === true && row.winner_person_id === row.truth_person_id,
  ).length;
  const unknownAccepts = decisions.filter(
    (row) => row.known_person !== true,
  ).length;
  return {
    correctKnown,
    decisionPrecisionPercent: rounded(
      decisions.length === 0 ? 100 : (100 * correctKnown) / decisions.length,
    ),
    knownCorrectCoveragePercent: rounded(
      known.length === 0 ? 0 : (100 * correctKnown) / known.length,
    ),
    unknownFalseAcceptRatePercent: rounded(
      unknown.length === 0 ? 0 : (100 * unknownAccepts) / unknown.length,
    ),
    verifiedUnknowns: unknown.length,
  };
};

export const deriveSourcePackReviewGate = (
  rows,
  { cohortDigest, leakage, packId, split },
) => {
  const calibration = rows.filter((row) => row.split === "calibration");
  const holdout = rows.filter((row) => row.split === "holdout");
  if (!leakage?.passed) {
    return { receipt: null, reason: "LEAKAGE_OR_PROVENANCE_CHECK_FAILED" };
  }
  if (!calibration.some((row) => row.known_person === true)) {
    return { receipt: null, reason: "CALIBRATION_KNOWN_COHORT_MISSING" };
  }
  if (!calibration.some((row) => row.known_person !== true)) {
    return { receipt: null, reason: "CALIBRATION_UNKNOWN_COHORT_MISSING" };
  }
  if (!holdout.some((row) => row.known_person === true)) {
    return { receipt: null, reason: "HOLDOUT_KNOWN_COHORT_MISSING" };
  }
  if (
    holdout.filter((row) => row.known_person !== true).length <
    reviewGateThresholds.minimumVerifiedUnknowns
  ) {
    return { receipt: null, reason: "INSUFFICIENT_VERIFIED_UNKNOWNS" };
  }

  const candidates = [];
  for (let scoreStep = 0; scoreStep <= 100; scoreStep += 1) {
    for (let marginStep = 0; marginStep <= 25; marginStep += 1) {
      const scoreFloor = scoreStep / 100;
      const marginFloor = marginStep / 100;
      const metrics = operatingMetrics(calibration, scoreFloor, marginFloor);
      candidates.push({ marginFloor, metrics, scoreFloor });
    }
  }
  const passing = candidates.filter(
    ({ metrics }) =>
      metrics.correctKnown > 0 &&
      metrics.decisionPrecisionPercent >=
        reviewGateThresholds.minimumDecisionPrecisionPercent &&
      metrics.unknownFalseAcceptRatePercent <=
        reviewGateThresholds.maximumUnknownFalseAcceptRatePercent,
  );
  const selected = (passing.length > 0 ? passing : candidates).sort(
    (left, right) =>
      right.metrics.knownCorrectCoveragePercent -
        left.metrics.knownCorrectCoveragePercent ||
      right.metrics.decisionPrecisionPercent -
        left.metrics.decisionPrecisionPercent ||
      left.metrics.unknownFalseAcceptRatePercent -
        right.metrics.unknownFalseAcceptRatePercent ||
      left.scoreFloor - right.scoreFloor ||
      left.marginFloor - right.marginFloor,
  )[0];
  const metrics = operatingMetrics(
    holdout,
    selected.scoreFloor,
    selected.marginFloor,
  );
  if (metrics.correctKnown === 0) {
    return { receipt: null, reason: "NO_USEFUL_REVIEW_COVERAGE" };
  }
  return {
    reason: null,
    receipt: validateSourcePackGateReceipt(
      {
        authorityScope: "human-review",
        cohortDigest,
        leakage,
        matcherPolicy: {
          marginFloor: selected.marginFloor,
          policyVersion: sourcePackMatcherPolicyVersion,
          scoreFloor: selected.scoreFloor,
          scorer: "best_individual_prime",
        },
        metrics: {
          decisionPrecisionPercent: metrics.decisionPrecisionPercent,
          knownCorrectCoveragePercent: metrics.knownCorrectCoveragePercent,
          unknownFalseAcceptRatePercent: metrics.unknownFalseAcceptRatePercent,
          verifiedUnknowns: metrics.verifiedUnknowns,
        },
        packId,
        schemaVersion: sourcePackGateSchemaVersion,
        split: { ...split, operatingPolicy: sourcePackReviewGatePolicyVersion },
        status:
          metrics.decisionPrecisionPercent >=
            reviewGateThresholds.minimumDecisionPrecisionPercent &&
          metrics.unknownFalseAcceptRatePercent <=
            reviewGateThresholds.maximumUnknownFalseAcceptRatePercent
            ? "passed"
            : "failed",
        thresholds: reviewGateThresholds,
      },
      packId,
    ),
  };
};

const metricSummary = (rows) => {
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.lane}\u001f${row.split}`;
    const group = grouped.get(key) || [];
    group.push(row);
    grouped.set(key, group);
  }
  return [...grouped.entries()].map(([key, group]) => {
    const [lane, split] = key.split("\u001f");
    const byPerson = new Map();
    for (const row of group) {
      const personRows = byPerson.get(row.truth_person_id) || [];
      personRows.push(row);
      byPerson.set(row.truth_person_id, personRows);
    }
    const correct = group.filter(
      (row) => row.winner_person_id === row.truth_person_id,
    ).length;
    const macroAccuracy =
      [...byPerson.values()].reduce(
        (total, personRows) =>
          total +
          personRows.filter(
            (row) => row.winner_person_id === row.truth_person_id,
          ).length /
            personRows.length,
        0,
      ) / Math.max(1, byPerson.size);
    return {
      accuracy: correct / Math.max(1, group.length),
      correct,
      lane,
      macroAccuracy,
      people: byPerson.size,
      queries: group.length,
      routedQueries: group.filter((row) => row.routed).length,
      split,
    };
  });
};

export const evaluateSourcePack = async (
  sql,
  {
    calibrationEnd,
    includeUnmeasuredSecondary = false,
    maxQueriesPerPerson = 5,
    packId,
  },
) => {
  const [pack] = await sql`
    SELECT pack_id, pack_digest, evidence_cutoff, model_family, model_version,
      config_digest, dimension, manifest, state
    FROM source_pack
    WHERE pack_id = ${packId}
  `;
  if (!pack) {
    throw new Error(`SourcePack not found: ${packId}`);
  }
  const calibrationEndDate = new Date(calibrationEnd || "");
  if (
    !Number.isFinite(calibrationEndDate.getTime()) ||
    calibrationEndDate <= new Date(pack.evidence_cutoff)
  ) {
    throw new Error(
      "SourcePack evaluation requires calibration-end after the evidence cutoff",
    );
  }

  const [leakage] = await sql`
    WITH face_reference_leaks AS (
      SELECT count(*)::int AS count
      FROM source_pack_reference r
      JOIN face_observation fo ON fo.face_id = r.face_id
      JOIN asset a ON a.asset_id = fo.asset_id
      WHERE r.pack_id = ${packId} AND r.reference_kind = 'face'
        AND (a.capture_time IS NULL OR a.capture_time > ${pack.evidence_cutoff})
    ), prototype_member_leaks AS (
      SELECT count(*)::int AS count
      FROM source_pack_reference r
      CROSS JOIN LATERAL unnest(r.member_face_ids) member_face_id
      JOIN face_observation fo ON fo.face_id = member_face_id
      JOIN asset a ON a.asset_id = fo.asset_id
      WHERE r.pack_id = ${packId} AND r.reference_kind = 'prototype'
        AND (a.capture_time IS NULL OR a.capture_time > ${pack.evidence_cutoff})
    ), untrusted_references AS (
      SELECT count(*)::int AS count
      FROM source_pack_reference r
      LEFT JOIN current_face_identity cfi ON cfi.face_id = r.face_id AND cfi.person_id = r.person_id
      LEFT JOIN identity_claim ic ON ic.identity_claim_id = cfi.identity_claim_id
      LEFT JOIN decision d ON d.decision_id = ic.decision_id
      LEFT JOIN face_observation trusted_face ON trusted_face.face_id = r.face_id
      WHERE r.pack_id = ${packId} AND r.reference_kind = 'face'
        AND NOT coalesce(cfi.state = 'accepted'
          AND (cfi.origin IN ('trusted_import','user') OR d.actor_kind = 'user')
          AND (trusted_face.observation_origin <> 'manual_user' OR EXISTS (
            SELECT 1 FROM current_manual_face_matching_evidence lifecycle
            WHERE lifecycle.face_id = r.face_id
              AND lifecycle.model_family = r.model_family
              AND lifecycle.model_version = r.model_version
              AND lifecycle.config_digest = r.config_digest
              AND lifecycle.vector_digest = r.vector_digest
          )), false)
    ), manifest_reference_mismatches AS (
      SELECT count(*)::int AS count
      FROM (
        SELECT r.reference_id AS stored_reference_id, m.reference_id AS manifest_reference_id
        FROM (SELECT * FROM source_pack_reference WHERE pack_id = ${packId}) r
        FULL OUTER JOIN (
          SELECT item->>'referenceId' AS reference_id, item->>'vectorDigest' AS vector_digest
          FROM jsonb_array_elements(${sql.json(pack.manifest)}->'referenceDigests') item
        ) m ON m.reference_id = r.reference_id AND m.vector_digest = r.vector_digest
        WHERE r.reference_id IS NULL OR m.reference_id IS NULL
      ) mismatches
    )
    SELECT face_reference_leaks.count AS face_reference_leaks,
      prototype_member_leaks.count AS prototype_member_leaks,
      untrusted_references.count AS untrusted_references,
      manifest_reference_mismatches.count AS manifest_reference_mismatches
    FROM face_reference_leaks, prototype_member_leaks, untrusted_references, manifest_reference_mismatches
  `;
  const leakagePassed =
    leakage.face_reference_leaks === 0 &&
    leakage.prototype_member_leaks === 0 &&
    leakage.untrusted_references === 0 &&
    leakage.manifest_reference_mismatches === 0;
  if (!leakagePassed) {
    return {
      cohortDigest: digestValue({
        packId,
        calibrationEnd: calibrationEndDate.toISOString(),
        leakage,
      }),
      leakage: { ...leakage, passed: false },
      metrics: [],
      policy: null,
      reviewGate: {
        receipt: null,
        reason: "LEAKAGE_OR_PROVENANCE_CHECK_FAILED",
      },
      status: "failed",
      verifiedUnknowns: 0,
    };
  }

  const [cohortCounts] = await sql`
    SELECT
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM source_pack_reference r
        WHERE r.pack_id = ${packId} AND r.person_id = cfi.person_id AND r.bucket_kind = 'prime'
      ))::int AS known_person_queries,
      count(*) FILTER (WHERE NOT EXISTS (
        SELECT 1 FROM source_pack_reference r
        WHERE r.pack_id = ${packId} AND r.person_id = cfi.person_id AND r.bucket_kind = 'prime'
      ))::int AS cold_start_queries
    FROM current_face_identity cfi
    JOIN identity_claim ic ON ic.identity_claim_id = cfi.identity_claim_id
    LEFT JOIN decision d ON d.decision_id = ic.decision_id
    JOIN face_observation fo ON fo.face_id = cfi.face_id AND fo.state = 'valid'
    JOIN asset a ON a.asset_id = fo.asset_id
    JOIN face_embedding fe ON fe.face_id = fo.face_id AND fe.state = 'active'
    WHERE cfi.state = 'accepted'
      AND (cfi.origin IN ('trusted_import','user') OR d.actor_kind = 'user')
      AND a.capture_time > ${pack.evidence_cutoff}
      AND fe.model_family = ${pack.model_family}
      AND fe.model_version = ${pack.model_version}
      AND fe.config_digest = ${pack.config_digest}
      AND (fo.observation_origin <> 'manual_user' OR EXISTS (
        SELECT 1 FROM current_manual_face_matching_evidence lifecycle
        WHERE lifecycle.face_id = fo.face_id
          AND lifecycle.embedding_id = fe.embedding_id
          AND lifecycle.vector_digest = fe.vector_digest
      ))
  `;

  const rows = await sql`
    WITH query_source AS (
      SELECT cfi.person_id AS truth_person_id, fo.face_id AS query_face_id,
        fo.asset_id AS query_asset_id, a.capture_time, fe.embedding AS query_embedding,
        CASE WHEN a.capture_time <= ${calibrationEndDate} THEN 'calibration' ELSE 'holdout' END AS split
      FROM current_face_identity cfi
      JOIN identity_claim ic ON ic.identity_claim_id = cfi.identity_claim_id
      LEFT JOIN decision d ON d.decision_id = ic.decision_id
      JOIN face_observation fo ON fo.face_id = cfi.face_id AND fo.state = 'valid'
      JOIN asset a ON a.asset_id = fo.asset_id
      JOIN face_embedding fe ON fe.face_id = fo.face_id AND fe.state = 'active'
      WHERE cfi.state = 'accepted'
        AND (cfi.origin IN ('trusted_import','user') OR d.actor_kind = 'user')
        AND a.capture_time > ${pack.evidence_cutoff}
        AND fe.model_family = ${pack.model_family}
        AND fe.model_version = ${pack.model_version}
        AND fe.config_digest = ${pack.config_digest}
        AND (fo.observation_origin <> 'manual_user' OR EXISTS (
          SELECT 1 FROM current_manual_face_matching_evidence lifecycle
          WHERE lifecycle.face_id = fo.face_id
            AND lifecycle.embedding_id = fe.embedding_id
            AND lifecycle.vector_digest = fe.vector_digest
        ))
        AND EXISTS (
          SELECT 1 FROM source_pack_reference r
          WHERE r.pack_id = ${packId} AND r.person_id = cfi.person_id AND r.bucket_kind = 'prime'
        )
    ), ranked_queries AS (
      SELECT *, row_number() OVER (
        PARTITION BY truth_person_id, split ORDER BY capture_time, query_face_id
      ) AS person_query_rank
      FROM query_source
    ), queries AS (
      SELECT * FROM ranked_queries WHERE person_query_rank <= ${Math.max(1, Math.min(60, Number(maxQueriesPerPerson) || 5))}
    ), prime_evidence AS (
      SELECT q.query_face_id, q.query_asset_id, q.truth_person_id, q.split,
        r.person_id, r.reference_kind,
        (1 - (r.embedding <=> q.query_embedding))::float8 AS score
      FROM queries q
      JOIN source_pack_reference r ON r.pack_id = ${packId} AND r.bucket_kind = 'prime'
      LEFT JOIN face_observation rf ON rf.face_id = r.face_id
      WHERE r.reference_kind = 'prototype' OR rf.asset_id <> q.query_asset_id
    ), individual_ranked AS (
      SELECT *, row_number() OVER (
        PARTITION BY query_face_id, person_id ORDER BY score DESC
      ) AS evidence_rank
      FROM prime_evidence
      WHERE reference_kind = 'face'
    ), individual_scores AS (
      SELECT query_face_id, query_asset_id, truth_person_id, split, person_id,
        max(score)::float8 AS individual_max,
        avg(score) FILTER (WHERE evidence_rank <= 3)::float8 AS individual_top3
      FROM individual_ranked
      GROUP BY query_face_id, query_asset_id, truth_person_id, split, person_id
    ), prototype_scores AS (
      SELECT query_face_id, query_asset_id, truth_person_id, split, person_id,
        max(score)::float8 AS prototype_score
      FROM prime_evidence
      WHERE reference_kind = 'prototype'
      GROUP BY query_face_id, query_asset_id, truth_person_id, split, person_id
    ), prime_scores AS (
      SELECT coalesce(i.query_face_id, p.query_face_id) AS query_face_id,
        coalesce(i.query_asset_id, p.query_asset_id) AS query_asset_id,
        coalesce(i.truth_person_id, p.truth_person_id) AS truth_person_id,
        coalesce(i.split, p.split) AS split,
        coalesce(i.person_id, p.person_id) AS person_id,
        greatest(coalesce(i.individual_max, -1), coalesce(p.prototype_score, -1)) AS raw_score,
        CASE
          WHEN i.individual_top3 IS NOT NULL AND p.prototype_score IS NOT NULL
            THEN 0.45 * i.individual_top3 + 0.55 * p.prototype_score
          ELSE coalesce(p.prototype_score, i.individual_top3)
        END::float8 AS robust_score
      FROM individual_scores i
      FULL OUTER JOIN prototype_scores p USING (query_face_id, query_asset_id, truth_person_id, split, person_id)
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
      SELECT pr.query_face_id, r.person_id,
        max(1 - (r.embedding <=> q.query_embedding))::float8 AS secondary_score
      FROM prime_ranked pr
      JOIN queries q USING (query_face_id)
      JOIN source_pack_reference r ON r.pack_id = ${packId}
        AND r.bucket_kind = 'secondary' AND r.reference_kind = 'face'
        AND r.person_id = pr.person_id
        AND (r.routing_state = 'eligible' OR ${Boolean(includeUnmeasuredSecondary)})
      JOIN face_observation rf ON rf.face_id = r.face_id AND rf.asset_id <> q.query_asset_id
      WHERE pr.robust_rank <= 2
      GROUP BY pr.query_face_id, r.person_id
    ), grid AS (
      SELECT threshold, weight
      FROM unnest(ARRAY[0.01,0.02,0.04,0.06,0.08]::float8[]) threshold
      CROSS JOIN unnest(ARRAY[0.05,0.10,0.15,0.20,0.25]::float8[]) weight
    ), blended AS (
      SELECT g.threshold, g.weight, pr.*,
        CASE WHEN m.prime_margin < g.threshold AND ss.secondary_score IS NOT NULL
          THEN (1 - g.weight) * pr.robust_score + g.weight * ss.secondary_score
          ELSE pr.robust_score END::float8 AS final_score,
        (m.prime_margin < g.threshold AND ss.secondary_score IS NOT NULL) AS routed
      FROM grid g
      CROSS JOIN prime_ranked pr
      JOIN margins m USING (query_face_id)
      LEFT JOIN secondary_scores ss USING (query_face_id, person_id)
    ), blended_ranked AS (
      SELECT *, row_number() OVER (
        PARTITION BY threshold, weight, query_face_id ORDER BY final_score DESC, person_id
      ) AS final_rank
      FROM blended
    ), calibration_grid AS (
      SELECT threshold, weight,
        count(*) FILTER (WHERE person_id = truth_person_id)::int AS correct,
        count(*) FILTER (WHERE routed)::int AS routed
      FROM blended_ranked
      WHERE split = 'calibration' AND final_rank = 1
      GROUP BY threshold, weight
    ), chosen AS (
      SELECT threshold, weight
      FROM calibration_grid
      ORDER BY correct DESC, routed ASC, weight ASC, threshold ASC
      LIMIT 1
    ), secondary_winners AS (
      SELECT br.*
      FROM blended_ranked br
      JOIN chosen USING (threshold, weight)
      WHERE final_rank = 1
    )
    SELECT 'raw_max_prime'::text AS lane, split, query_face_id, truth_person_id,
      person_id AS winner_person_id, false AS routed, null::float8 AS threshold, null::float8 AS weight
    FROM prime_ranked WHERE raw_rank = 1
    UNION ALL
    SELECT 'robust_prime'::text, split, query_face_id, truth_person_id,
      person_id, false, null::float8, null::float8
    FROM prime_ranked WHERE robust_rank = 1
    UNION ALL
    SELECT 'guarded_secondary'::text, split, query_face_id, truth_person_id,
      person_id, routed, threshold, weight
    FROM secondary_winners
    ORDER BY lane, split, query_face_id
  `;
  const queryCohort = rows
    .filter((row) => row.lane === "robust_prime")
    .map((row) => ({
      faceId: row.query_face_id,
      personId: row.truth_person_id,
      split: row.split,
    }));
  const policyRow = rows.find((row) => row.lane === "guarded_secondary");
  const metrics = metricSummary(rows);
  const calibrationQueries = queryCohort.filter(
    (row) => row.split === "calibration",
  ).length;
  const holdoutQueries = queryCohort.filter(
    (row) => row.split === "holdout",
  ).length;
  const status =
    calibrationQueries > 0 && holdoutQueries > 0 ? "incomplete" : "failed";
  const openSetRows = await sql`
    WITH query_source AS (
      SELECT cfi.person_id AS truth_person_id, fo.face_id AS query_face_id,
        fo.asset_id AS query_asset_id, a.capture_time,
        fe.embedding AS query_embedding,
        CASE WHEN a.capture_time <= ${calibrationEndDate}
          THEN 'calibration' ELSE 'holdout' END AS split,
        EXISTS (
          SELECT 1 FROM source_pack_reference known
          WHERE known.pack_id = ${packId}
            AND known.person_id = cfi.person_id
            AND known.bucket_kind = 'prime'
            AND known.reference_kind = 'face'
        ) AS known_person,
        row_number() OVER (
          PARTITION BY cfi.person_id,
            CASE WHEN a.capture_time <= ${calibrationEndDate}
              THEN 'calibration' ELSE 'holdout' END
          ORDER BY a.capture_time, fo.face_id
        ) AS person_query_rank
      FROM current_face_identity cfi
      JOIN identity_claim ic ON ic.identity_claim_id = cfi.identity_claim_id
      LEFT JOIN decision d ON d.decision_id = ic.decision_id
      JOIN face_observation fo ON fo.face_id = cfi.face_id AND fo.state = 'valid'
      JOIN asset a ON a.asset_id = fo.asset_id
      JOIN face_embedding fe ON fe.face_id = fo.face_id AND fe.state = 'active'
      WHERE cfi.state = 'accepted'
        AND (cfi.origin IN ('trusted_import','user') OR d.actor_kind = 'user')
        AND a.capture_time > ${pack.evidence_cutoff}
        AND fe.model_family = ${pack.model_family}
        AND fe.model_version = ${pack.model_version}
        AND fe.config_digest = ${pack.config_digest}
        AND (fo.observation_origin <> 'manual_user' OR EXISTS (
          SELECT 1 FROM current_manual_face_matching_evidence lifecycle
          WHERE lifecycle.face_id = fo.face_id
            AND lifecycle.embedding_id = fe.embedding_id
            AND lifecycle.vector_digest = fe.vector_digest
        ))
    ), queries AS (
      SELECT * FROM query_source
      WHERE person_query_rank <= ${Math.max(1, Math.min(60, Number(maxQueriesPerPerson) || 5))}
    ), person_scores AS (
      SELECT query.query_face_id, query.truth_person_id, query.split,
        query.known_person, reference.person_id,
        max(1 - (reference.embedding <=> query.query_embedding))::float8
          AS score
      FROM queries query
      JOIN source_pack_reference reference
        ON reference.pack_id = ${packId}
        AND reference.bucket_kind = 'prime'
        AND reference.reference_kind = 'face'
      JOIN face_observation reference_face
        ON reference_face.face_id = reference.face_id
        AND reference_face.asset_id <> query.query_asset_id
      GROUP BY query.query_face_id, query.truth_person_id, query.split,
        query.known_person, reference.person_id
    ), ranked AS (
      SELECT *, row_number() OVER (
        PARTITION BY query_face_id ORDER BY score DESC, person_id
      ) AS candidate_rank,
      lead(score) OVER (
        PARTITION BY query_face_id ORDER BY score DESC, person_id
      ) AS runner_up_score
      FROM person_scores
    )
    SELECT query_face_id, truth_person_id, split, known_person,
      person_id AS winner_person_id, score AS winner_score,
      greatest(0, score - coalesce(runner_up_score, -1))::float8 AS margin
    FROM ranked
    WHERE candidate_rank = 1
    ORDER BY split, query_face_id
  `;
  const split = {
    calibrationEnd: calibrationEndDate.toISOString(),
    calibrationQueries,
    coldStartQueries: cohortCounts.cold_start_queries,
    evidenceCutoff: new Date(pack.evidence_cutoff).toISOString(),
    holdoutQueries,
    knownPersonQueriesAvailable: cohortCounts.known_person_queries,
    maxQueriesPerPerson,
  };
  const reviewGate = deriveSourcePackReviewGate(openSetRows, {
    cohortDigest: digestValue(
      openSetRows.map((row) => ({
        faceId: row.query_face_id,
        knownPerson: row.known_person,
        split: row.split,
        truthPersonId: row.truth_person_id,
      })),
    ),
    leakage: { ...leakage, passed: true, queryReferenceOverlap: 0 },
    packId,
    split,
  });
  return {
    cohortDigest: digestValue(queryCohort),
    leakage: { ...leakage, passed: true, queryReferenceOverlap: 0 },
    metrics,
    policy: policyRow
      ? {
          secondaryThreshold: policyRow.threshold,
          secondaryWeight: policyRow.weight,
          state: "calibration-diagnostic-only",
        }
      : null,
    reviewGate,
    split,
    status,
    verifiedUnknowns: 0,
  };
};

export const persistSourcePackEvaluation = async (
  sql,
  packId,
  evaluation,
  { execute = false } = {},
) => {
  const evaluationId = `evaluation_${digestValue({ packId, ...evaluation }).slice(0, 32)}`;
  if (!execute) {
    return { created: false, evaluationId, execute };
  }
  const receiptId = "receipt_cimmich_source_pack_evaluator_v1";
  return sql.begin(async (tx) => {
    const now = new Date();
    await tx`
      INSERT INTO producer_receipt (
        producer_receipt_id, producer_kind, producer_name, producer_version,
        started_at, completed_at, privacy_class
      ) VALUES (
        ${receiptId}, 'system', 'cimmich-source-pack-evaluator', 'v1', ${now}, ${now}, 'private'
      ) ON CONFLICT (producer_receipt_id) DO UPDATE SET completed_at = excluded.completed_at
    `;
    const inserted = await tx`
      INSERT INTO source_pack_evaluation (
        evaluation_id, pack_id, evaluator_version, split_definition, cohort_digest,
        leakage_assertions, metrics, status, producer_receipt_id, privacy_class
      ) VALUES (
        ${evaluationId}, ${packId}, ${sourcePackEvaluatorVersion}, ${tx.json(evaluation.split || {})},
        ${evaluation.cohortDigest}, ${tx.json(evaluation.leakage)},
        ${tx.json({ lanes: evaluation.metrics, policy: evaluation.policy, reviewGate: evaluation.reviewGate || null, verifiedUnknowns: evaluation.verifiedUnknowns })},
        ${evaluation.status}, ${receiptId}, 'private'
      ) ON CONFLICT (evaluation_id) DO NOTHING
      RETURNING evaluation_id
    `;
    await tx`
      UPDATE source_pack
      SET evaluation_status = ${evaluation.status},
          evaluation_summary = ${tx.json({
            evaluationId,
            metrics: evaluation.metrics,
            policy: evaluation.policy,
            reviewGate: evaluation.reviewGate || null,
            verifiedUnknowns: evaluation.verifiedUnknowns,
          })}
      WHERE pack_id = ${packId}
    `;
    return { created: inserted.length === 1, evaluationId, execute };
  });
};
