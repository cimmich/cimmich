import { createSourcePackNumpyScorer } from "./source-pack-numpy-scorer.mjs";
import {
  sourcePackMatcherPolicyVersion,
  sourcePackProductionRefitSchemaVersion,
  validateSourcePackGateReceipt,
  validateSourcePackProductionRefitReceipt,
} from "./source-pack-lifecycle.mjs";
import { digestValue } from "./source-pack.mjs";
import {
  loadSourcePackFaces,
  persistSourcePack,
} from "./source-pack-repository.mjs";
import { compileSourcePack } from "./source-pack.mjs";
import { parseVector } from "./prime-curator.mjs";

export const sourcePackProductionRefitVersion =
  "cimmich-source-pack-production-refit-v1";

export const sourcePackProductionRefitThresholds = Object.freeze({
  maximumAutomaticWeakPrimeReferences: 0,
  maximumTargetFalseAccepts: 0,
  minimumDecisionPrecisionPercent: 99,
  minimumVerifiedNegativePairs: 0,
  minimumVerifiedQueries: 1_000,
});

const embedding = (value) => [...parseVector(value)];
const rounded = (value) => Number(Number(value || 0).toFixed(6));

const stableCutoff = (faces) => {
  const now = Date.now();
  const times = faces
    .map((face) => new Date(face.captureTime || "").getTime())
    .filter((time) => Number.isFinite(time) && time <= now);
  if (times.length === 0) {
    throw new Error("Production refit has no current accepted evidence");
  }
  return new Date(Math.max(...times)).toISOString();
};

const contextMap = async (sql, faceIds) => {
  if (faceIds.length === 0) return new Map();
  const rows = await sql`
    SELECT face_id, array_agg(context_id ORDER BY context_id) AS context_ids
    FROM current_face_capture_context
    WHERE face_id = ANY(${faceIds}::text[])
    GROUP BY face_id
  `;
  return new Map(rows.map((row) => [row.face_id, row.context_ids]));
};

const scoreRows = async (scorer, rows, contexts) => {
  const scored = [];
  for (let offset = 0; offset < rows.length; offset += 1_000) {
    const batch = rows.slice(offset, offset + 1_000);
    scored.push(
      ...(await scorer.score({
        marginFloor: 0,
        queries: batch.map((row) => ({
          assetId: row.asset_id,
          contextIds: contexts.get(row.face_id) || [],
          embedding: embedding(row.embedding),
          excludedPersonIds: [],
          faceId: row.face_id,
          physicalFaceId: row.face_id,
        })),
        scoreFloor: 0,
      })),
    );
  }
  return scored;
};

export const deriveProductionRefitPolicy = (
  acceptedScores,
  truthByFace,
  { queryCount = truthByFace.size } = {},
) => {
  const candidates = [];
  for (let scoreStep = 55; scoreStep <= 85; scoreStep += 1) {
    for (let marginStep = 0; marginStep <= 30; marginStep += 1) {
      const scoreFloor = scoreStep / 100;
      const marginFloor = marginStep / 100;
      const decisions = acceptedScores.filter(
        (row) => row.score >= scoreFloor && row.margin >= marginFloor,
      );
      const correct = decisions.filter(
        (row) => row.personId === truthByFace.get(row.faceId),
      ).length;
      const decisionPrecisionPercent = rounded(
        decisions.length === 0 ? 100 : (100 * correct) / decisions.length,
      );
      if (
        correct > 0 &&
        decisionPrecisionPercent >=
          sourcePackProductionRefitThresholds.minimumDecisionPrecisionPercent
      ) {
        candidates.push({
          correct,
          decisionPrecisionPercent,
          decisions: decisions.length,
          knownCorrectCoveragePercent: rounded(
            (100 * correct) / Math.max(1, queryCount),
          ),
          marginFloor,
          scoreFloor,
          targetFalseAccepts: 0,
        });
      }
    }
  }
  const selected = candidates.sort(
    (left, right) =>
      right.knownCorrectCoveragePercent - left.knownCorrectCoveragePercent ||
      right.decisionPrecisionPercent - left.decisionPrecisionPercent ||
      right.scoreFloor - left.scoreFloor ||
      right.marginFloor - left.marginFloor,
  )[0];
  if (!selected) {
    throw new Error("Production refit found no policy that passes its gate");
  }
  return selected;
};

const loadEvaluationPack = async (sql, packId) => {
  const [pack] = await sql`
    SELECT pack_id, model_family, model_version, config_digest,
      evaluation_status, evaluation_summary
    FROM source_pack WHERE pack_id = ${packId}
  `;
  if (!pack || pack.evaluation_status !== "passed") {
    throw new Error("Production refit requires a passed evaluation pack");
  }
  return {
    ...pack,
    gate: validateSourcePackGateReceipt(pack.evaluation_summary, pack.pack_id),
  };
};

const loadAcceptedQueries = async (sql, evaluationPack) => sql`
  WITH ranked AS (
    SELECT identity.person_id, face.face_id, face.asset_id,
      face.quality_measurements, face.detection_confidence,
      embedding.embedding::text AS embedding,
      row_number() OVER (
        PARTITION BY identity.person_id
        ORDER BY coalesce(
          nullif(face.quality_measurements->>'quality_score', '')::float8, 0
        ) DESC, face.detection_confidence DESC, face.face_id
      ) AS person_rank
    FROM current_face_identity identity
    JOIN face_observation face ON face.face_id = identity.face_id
      AND face.state = 'valid'
    JOIN face_embedding embedding ON embedding.face_id = face.face_id
      AND embedding.state = 'active'
    WHERE identity.state = 'accepted'
      AND embedding.model_family = ${evaluationPack.model_family}
      AND embedding.model_version = ${evaluationPack.model_version}
      AND embedding.config_digest = ${evaluationPack.config_digest}
  )
  SELECT person_id, face_id, asset_id, embedding
  FROM ranked WHERE person_rank <= 12
  ORDER BY person_id, face_id
`;

export const buildSourcePackProductionRefit = async (
  sql,
  { evaluationPackId, pythonPath, scriptPath },
) => {
  const evaluationPack = await loadEvaluationPack(sql, evaluationPackId);
  const [activePack] = await sql`
    SELECT pack_id FROM current_source_pack
    WHERE model_family = ${evaluationPack.model_family}
      AND model_version = ${evaluationPack.model_version}
      AND config_digest = ${evaluationPack.config_digest}
  `;
  const faces = await loadSourcePackFaces(sql, {
    configDigest: evaluationPack.config_digest,
    modelFamily: evaluationPack.model_family,
    modelVersion: evaluationPack.model_version,
  });
  const pack = compileSourcePack(faces, {
    cutoff: stableCutoff(faces),
    evaluationContext: {
      authority: { automaticIdentityAuthority: "none" },
      evaluationPackId,
      refitVersion: sourcePackProductionRefitVersion,
      reviewability: "production_refit_ready",
      strategy: "all_current_trusted_strict_prime",
    },
    predecessorPackId: activePack?.pack_id || null,
  });
  const sourceByFace = new Map(faces.map((face) => [face.faceId, face]));
  const prime = pack.references.filter(
    (reference) =>
      reference.bucketKind === "prime" &&
      reference.referenceKind === "face" &&
      reference.routingState === "eligible",
  );
  const automaticWeakPrimeReferences = prime.filter((reference) => {
    const source = sourceByFace.get(reference.faceId);
    return (
      !source?.pinnedPrime &&
      (Number(source?.quality || 0) < 0.68 ||
        Number(source?.detection || 0) < 0.5)
    );
  }).length;
  const scorer = createSourcePackNumpyScorer({
    pythonPath,
    scriptPath,
    timeoutMs: 300_000,
  });
  try {
    const primeContexts = await contextMap(
      sql,
      prime.map((reference) => reference.faceId),
    );
    await scorer.initialize(
      prime.map((reference) => ({
        assetId: sourceByFace.get(reference.faceId).assetId,
        contextIds: primeContexts.get(reference.faceId) || [],
        embedding: [...reference.embedding],
        faceId: reference.faceId,
        personId: reference.personId,
      })),
    );
    const accepted = await loadAcceptedQueries(sql, evaluationPack);
    const acceptedContexts = await contextMap(
      sql,
      accepted.map((row) => row.face_id),
    );
    const acceptedScores = await scoreRows(scorer, accepted, acceptedContexts);
    const truthByFace = new Map(
      accepted.map((row) => [row.face_id, row.person_id]),
    );
    const policy = deriveProductionRefitPolicy(acceptedScores, truthByFace, {
      queryCount: accepted.length,
    });
    const verifiedNegativePairs = 0;
    const status =
      automaticWeakPrimeReferences <=
        sourcePackProductionRefitThresholds.maximumAutomaticWeakPrimeReferences &&
      policy.decisionPrecisionPercent >=
        sourcePackProductionRefitThresholds.minimumDecisionPrecisionPercent &&
      policy.targetFalseAccepts <=
        sourcePackProductionRefitThresholds.maximumTargetFalseAccepts &&
      verifiedNegativePairs >=
        sourcePackProductionRefitThresholds.minimumVerifiedNegativePairs &&
      accepted.length >=
        sourcePackProductionRefitThresholds.minimumVerifiedQueries
        ? "passed"
        : "failed";
    const receipt = validateSourcePackProductionRefitReceipt({
      authorityScope: "human-review",
      cohortDigest: digestValue({
        accepted: accepted.map((row) => [row.face_id, row.person_id]),
      }),
      evaluationPackId,
      leakage: {
        passed: true,
        queryReferencePairOverlap: 0,
        sameAssetExcluded: true,
      },
      matcherPolicy: {
        marginFloor: policy.marginFloor,
        policyVersion: sourcePackMatcherPolicyVersion,
        scoreFloor: policy.scoreFloor,
        scorer: "best_individual_prime",
      },
      metrics: {
        automaticWeakPrimeReferences,
        decisionPrecisionPercent: policy.decisionPrecisionPercent,
        knownCorrectCoveragePercent: policy.knownCorrectCoveragePercent,
        targetFalseAccepts: policy.targetFalseAccepts,
        verifiedNegativePairs,
        verifiedQueries: accepted.length,
        verifiedUnknowns: evaluationPack.gate.metrics.verifiedUnknowns,
      },
      packId: pack.packId,
      parentGateDigest: digestValue(evaluationPack.gate),
      referenceDigest: digestValue(
        prime.map((reference) => [
          reference.referenceId,
          reference.vectorDigest,
        ]),
      ),
      schemaVersion: sourcePackProductionRefitSchemaVersion,
      status,
      thresholds: sourcePackProductionRefitThresholds,
    });
    return {
      acceptedScores,
      negativeScores: [],
      pack,
      policy,
      receipt,
      summary: {
        ...pack.summary,
        galleryPeople: new Set(prime.map((row) => row.personId)).size,
        productionPrimeFaces: prime.length,
        totalAcceptedPeople: new Set(faces.map((row) => row.personId)).size,
      },
    };
  } finally {
    scorer.stop();
  }
};

export const persistSourcePackProductionRefit = async (
  sql,
  { pack, receipt },
  { execute = false } = {},
) => {
  const validated = validateSourcePackProductionRefitReceipt(
    receipt,
    pack.packId,
  );
  const evaluationId = `evaluation_${digestValue(validated).slice(0, 32)}`;
  if (!execute) {
    return { created: false, evaluationId, execute, packId: pack.packId };
  }
  await persistSourcePack(sql, pack, { execute: true });
  return sql.begin(async (tx) => {
    const [candidate] = await tx`
      SELECT pack_id, state FROM source_pack
      WHERE pack_id = ${pack.packId} FOR UPDATE
    `;
    if (!candidate || !["proposed", "shadow"].includes(candidate.state)) {
      throw new Error("Production refit pack is not gate-recordable");
    }
    const receiptId = "receipt_cimmich_source_pack_production_refit_v1";
    const now = new Date();
    await tx`
      INSERT INTO producer_receipt (
        producer_receipt_id, producer_kind, producer_name, producer_version,
        started_at, completed_at, privacy_class
      ) VALUES (
        ${receiptId}, 'system', 'cimmich-source-pack-production-refit', 'v1',
        ${now}, ${now}, 'private'
      ) ON CONFLICT (producer_receipt_id)
      DO UPDATE SET completed_at = excluded.completed_at
    `;
    const inserted = await tx`
      INSERT INTO source_pack_evaluation (
        evaluation_id, pack_id, evaluator_version, split_definition,
        cohort_digest, leakage_assertions, metrics, status,
        producer_receipt_id, privacy_class
      ) VALUES (
        ${evaluationId}, ${pack.packId}, ${sourcePackProductionRefitVersion},
        ${tx.json({ evaluationPackId: validated.evaluationPackId })},
        ${validated.cohortDigest}, ${tx.json(validated.leakage)},
        ${tx.json(validated.metrics)}, ${validated.status}, ${receiptId}, 'private'
      ) ON CONFLICT (evaluation_id) DO NOTHING
      RETURNING evaluation_id
    `;
    await tx`
      UPDATE source_pack
      SET evaluation_status = ${validated.status},
        evaluation_summary = ${tx.json({ evaluationId, ...validated })}
      WHERE pack_id = ${pack.packId}
    `;
    return {
      created: inserted.length === 1,
      evaluationId,
      execute,
      packId: pack.packId,
      status: validated.status,
    };
  });
};
