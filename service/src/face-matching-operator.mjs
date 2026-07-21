import { createHash } from "node:crypto";
import {
  evaluateSourcePack,
  persistSourcePackEvaluation,
  sourcePackEvaluatorVersion,
} from "./source-pack-evaluator.mjs";
import {
  activateSourcePack,
  persistSourcePackGateReceipt,
  rollbackSourcePack,
  sourcePackGateSchemaVersion,
  validateSourcePackGateReceipt,
} from "./source-pack-lifecycle.mjs";
import {
  compileAndPersistSourcePack,
  loadSourcePackFaces,
  persistSourcePack,
} from "./source-pack-repository.mjs";

export const faceMatchingOperatorSchemaVersion =
  "cimmich.face-matching-operator.v1";
export const ownerSourcePackPlanSchemaVersion =
  "cimmich.owner-source-pack-plan.v1";

const publicIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

const typedError = (message, code, statusCode = 409) =>
  Object.assign(new Error(message), { code, statusCode });

const requiredPublicId = (value, label) => {
  const normalized = String(value || "").trim();
  if (!publicIdPattern.test(normalized)) {
    throw typedError(
      `Face matching ${label} is invalid`,
      "FACE_MATCHING_INPUT_INVALID",
      400,
    );
  }
  return normalized;
};

const boundedInteger = (value, fallback, minimum, maximum, label) => {
  const parsed = value == null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw typedError(
      `Face matching ${label} must be from ${minimum} to ${maximum}`,
      "FACE_MATCHING_INPUT_INVALID",
      400,
    );
  }
  return parsed;
};

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
};

const digest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const reviewGateNullReasons = new Set([
  "CALIBRATION_KNOWN_COHORT_MISSING",
  "CALIBRATION_UNKNOWN_COHORT_MISSING",
  "EVALUATION_ARTIFACT_INVALID",
  "EVALUATION_REQUIRED",
  "HOLDOUT_KNOWN_COHORT_MISSING",
  "INSUFFICIENT_VERIFIED_UNKNOWNS",
  "LEAKAGE_OR_PROVENANCE_CHECK_FAILED",
  "NO_USEFUL_REVIEW_COVERAGE",
  "REVIEW_GATE_NOT_DERIVED",
]);

export const projectSourcePackReviewGate = ({
  currentGateReceipt = null,
  evaluation = null,
  packId,
} = {}) => {
  const candidate = currentGateReceipt || evaluation?.reviewGate?.receipt;
  if (candidate) {
    try {
      return deepFreeze({
        reviewGateReceipt: validateSourcePackGateReceipt(candidate, packId),
        reviewGateReceiptNullReason: null,
      });
    } catch {
      return deepFreeze({
        reviewGateReceipt: null,
        reviewGateReceiptNullReason: "EVALUATION_ARTIFACT_INVALID",
      });
    }
  }
  const reason = evaluation?.reviewGate?.reason;
  return deepFreeze({
    reviewGateReceipt: null,
    reviewGateReceiptNullReason: reviewGateNullReasons.has(reason)
      ? reason
      : evaluation
        ? "REVIEW_GATE_NOT_DERIVED"
        : "EVALUATION_REQUIRED",
  });
};

const isoTime = (value) => {
  const date = new Date(value || "");
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

export const deriveOwnerSourcePackPlan = (faces = []) => {
  const evidence = faces
    .map((face) => ({
      captureTime: isoTime(face.captureTime),
      personId: String(face.personId || ""),
    }))
    .filter((row) => row.captureTime && row.personId)
    .sort(
      (left, right) =>
        left.captureTime.localeCompare(right.captureTime) ||
        left.personId.localeCompare(right.personId),
    );
  if (evidence.length === 0) {
    throw typedError(
      "No accepted provider-space Face evidence is available",
      "FACE_MATCHING_EVIDENCE_UNAVAILABLE",
    );
  }
  const times = [...new Set(evidence.map((row) => row.captureTime))];
  const candidates = [];
  for (
    let evidenceIndex = 0;
    evidenceIndex < times.length - 2;
    evidenceIndex += 1
  ) {
    const evidenceCutoff = times[evidenceIndex];
    const referencePeople = new Set(
      evidence
        .filter((row) => row.captureTime <= evidenceCutoff)
        .map((row) => row.personId),
    );
    for (
      let calibrationIndex = evidenceIndex + 1;
      calibrationIndex < times.length - 1;
      calibrationIndex += 1
    ) {
      const calibrationEnd = times[calibrationIndex];
      const calibration = evidence.filter(
        (row) =>
          referencePeople.has(row.personId) &&
          row.captureTime > evidenceCutoff &&
          row.captureTime <= calibrationEnd,
      );
      const holdout = evidence.filter(
        (row) =>
          referencePeople.has(row.personId) && row.captureTime > calibrationEnd,
      );
      const calibrationPeople = new Set(calibration.map((row) => row.personId));
      const holdoutPeople = new Set(holdout.map((row) => row.personId));
      const completePeople = [...calibrationPeople].filter((personId) =>
        holdoutPeople.has(personId),
      ).length;
      if (calibration.length === 0 || holdout.length === 0) continue;
      candidates.push({
        calibrationEnd,
        calibrationQueries: calibration.length,
        completePeople,
        evidenceCutoff,
        holdoutQueries: holdout.length,
        referenceEvidence: evidence.filter(
          (row) => row.captureTime <= evidenceCutoff,
        ).length,
        referencePeople: referencePeople.size,
      });
    }
  }
  const selected = candidates.sort(
    (left, right) =>
      right.completePeople - left.completePeople ||
      Math.min(right.calibrationQueries, right.holdoutQueries) -
        Math.min(left.calibrationQueries, left.holdoutQueries) ||
      right.referencePeople - left.referencePeople ||
      right.referenceEvidence - left.referenceEvidence ||
      left.evidenceCutoff.localeCompare(right.evidenceCutoff) ||
      left.calibrationEnd.localeCompare(right.calibrationEnd),
  )[0];
  if (selected) {
    return {
      ...selected,
      evidenceRows: evidence.length,
      reason: null,
      reviewability: "temporal_holdout_ready",
      schemaVersion: ownerSourcePackPlanSchemaVersion,
      strategy: "deterministic_three_window",
    };
  }
  return {
    calibrationEnd: null,
    calibrationQueries: 0,
    completePeople: 0,
    evidenceCutoff: times.at(-1),
    evidenceRows: evidence.length,
    holdoutQueries: 0,
    reason: "INSUFFICIENT_TEMPORAL_HOLDOUT",
    referenceEvidence: evidence.length,
    referencePeople: new Set(evidence.map((row) => row.personId)).size,
    reviewability: "operator_hold_required",
    schemaVersion: ownerSourcePackPlanSchemaVersion,
    strategy: "all_current_evidence_proposed_only",
  };
};

const projectMetric = (metric) => ({
  accuracy: Number(Number(metric.accuracy || 0).toFixed(6)),
  correct: Number(metric.correct || 0),
  lane: metric.lane,
  macroAccuracy: Number(Number(metric.macroAccuracy || 0).toFixed(6)),
  people: Number(metric.people || 0),
  queries: Number(metric.queries || 0),
  routedQueries: Number(metric.routedQueries || 0),
  split: metric.split,
});

const projectEvaluation = (evaluation, evaluationId = null, packId = "") => ({
  evaluationId,
  gateContract: sourcePackGateSchemaVersion,
  leakage: {
    passed: evaluation?.leakage?.passed === true,
    queryReferenceOverlap: Number(
      evaluation?.leakage?.queryReferenceOverlap || 0,
    ),
  },
  metrics: (evaluation?.metrics || []).map(projectMetric),
  reason:
    evaluation?.status === "failed"
      ? evaluation?.leakage?.passed === false
        ? "LEAKAGE_OR_PROVENANCE_CHECK_FAILED"
        : "INSUFFICIENT_TEMPORAL_HOLDOUT"
      : "OPERATOR_REVIEW_GATE_REQUIRED",
  ...projectSourcePackReviewGate({ evaluation, packId }),
  reviewArtifact: evaluation?.cohortDigest
    ? {
        cohortDigest: evaluation.cohortDigest,
        split: evaluation.split || {},
        verifiedUnknowns: Number(
          evaluation?.reviewGate?.receipt?.metrics?.verifiedUnknowns ||
            evaluation.verifiedUnknowns ||
            0,
        ),
      }
    : null,
  status: evaluation?.status || "untested",
});

const projectPack = (row) => ({
  evaluation: {
    evaluationId: row.evaluation_id || null,
    reason: row.review_reason || null,
    status: row.evaluation_status,
  },
  evidence: {
    people: Number(row.people || 0),
    primeFaces: Number(row.prime_faces || 0),
    prototypes: Number(row.prototypes || 0),
    references: Number(row.references || 0),
    secondaryFaces: Number(row.secondary_faces || 0),
  },
  packId: row.pack_id,
  predecessorPackId: row.predecessor_pack_id || null,
  ...projectSourcePackReviewGate({
    currentGateReceipt:
      row.evaluation_summary?.schemaVersion === sourcePackGateSchemaVersion
        ? row.evaluation_summary
        : null,
    evaluation: row.evaluator_version
      ? {
          reviewGate: row.evaluator_metrics?.reviewGate || null,
        }
      : null,
    packId: row.pack_id,
  }),
  rollbackAvailable: Boolean(row.predecessor_pack_id && row.state === "active"),
  state: row.state,
});

export const createFaceMatchingOperator = ({
  enhancedComponent = null,
  matchingProvider = null,
  mediaOperator,
  providerReceipt = null,
  repository,
  sql,
} = {}) => {
  if (!sql || !repository) {
    throw new Error("Face matching operator requires repository and database");
  }

  const requireProvider = () => {
    if (!matchingProvider || providerReceipt?.state !== "ready") {
      throw typedError(
        "A validated local Face provider is not ready",
        "FACE_MATCHING_PROVIDER_NOT_READY",
        503,
      );
    }
    return matchingProvider;
  };
  const requireEnhanced = async () => {
    if (enhancedComponent && !(await enhancedComponent.isEnabled())) {
      throw typedError(
        "Cimmich Enhanced is disabled by the owner",
        "FACE_MATCHING_ENHANCED_DISABLED",
        409,
      );
    }
  };

  const loadPackRow = async (
    packId,
    { requireCurrentProvider = true } = {},
  ) => {
    const id = requiredPublicId(packId, "packId");
    const provider = requireCurrentProvider
      ? requireProvider()
      : matchingProvider;
    const [row] = await sql`
      SELECT pack.pack_id, pack.predecessor_pack_id, pack.state,
        pack.evaluation_status, pack.evaluation_summary,
        pack.evaluation_summary->>'evaluationId' AS evaluation_id,
        evaluator.evaluator_version, evaluator.metrics AS evaluator_metrics,
        CASE
          WHEN pack.evaluation_status = 'untested' THEN 'SOURCE_PACK_EVALUATION_REQUIRED'
          WHEN pack.evaluation_status = 'incomplete' THEN 'OPERATOR_REVIEW_GATE_REQUIRED'
          WHEN pack.evaluation_status = 'failed' THEN 'SOURCE_PACK_REVIEW_REJECTED'
          WHEN pack.evaluation_status = 'passed'
            AND pack.evaluation_summary->'matcherPolicy' IS NULL
            THEN 'SOURCE_PACK_REVIEW_POLICY_REQUIRED'
          ELSE NULL
        END AS review_reason,
        count(reference.reference_id)::int AS references,
        count(DISTINCT reference.person_id)::int AS people,
        count(*) FILTER (
          WHERE reference.bucket_kind = 'prime'
            AND reference.reference_kind = 'face'
        )::int AS prime_faces,
        count(*) FILTER (
          WHERE reference.reference_kind = 'prototype'
        )::int AS prototypes,
        count(*) FILTER (
          WHERE reference.bucket_kind = 'secondary'
        )::int AS secondary_faces
      FROM source_pack pack
      LEFT JOIN LATERAL (
        SELECT evaluation.evaluator_version, evaluation.metrics
        FROM source_pack_evaluation evaluation
        WHERE evaluation.pack_id = pack.pack_id
          AND evaluation.evaluator_version = ${sourcePackEvaluatorVersion}
        ORDER BY evaluation.created_at, evaluation.evaluation_id
        LIMIT 1
      ) evaluator ON true
      LEFT JOIN source_pack_reference reference ON reference.pack_id = pack.pack_id
      WHERE pack.pack_id = ${id}
        AND (${provider?.modelFamily || ""} = '' OR (
          pack.model_family = ${provider?.modelFamily || ""}
          AND pack.model_version = ${provider?.modelVersion || ""}
          AND pack.config_digest = ${provider?.configDigest || ""}
        ))
      GROUP BY pack.pack_id, evaluator.evaluator_version, evaluator.metrics
    `;
    if (!row) {
      throw typedError(
        "SourcePack is unavailable for the configured provider",
        "FACE_MATCHING_SOURCE_PACK_NOT_FOUND",
        404,
      );
    }
    return row;
  };

  const status = async () => {
    const matching = await repository.faceMatchingStatus();
    if (!matchingProvider) {
      const [evidence] = await sql`
        SELECT count(*)::int AS accepted_faces
        FROM current_face_identity identity
        JOIN face_observation face ON face.face_id = identity.face_id
          AND face.state = 'valid'
        WHERE identity.state = 'accepted'
      `;
      return {
        ...matching,
        evidence: {
          acceptedFaces: Number(evidence?.accepted_faces || 0),
          providerEmbeddings: 0,
        },
        latestPack: null,
        next: {
          action: "configure_provider",
          reason: "PROVIDER_DISABLED",
          settings: "/v1/integrations/provider-settings-pack",
        },
        providerValidation: { state: "disabled" },
      };
    }
    const provider = requireProvider();
    const [evidence] = await sql`
      WITH accepted AS (
        SELECT identity.face_id
        FROM current_face_identity identity
        JOIN face_observation face ON face.face_id = identity.face_id
          AND face.state = 'valid'
        WHERE identity.state = 'accepted'
      )
      SELECT count(*)::int AS accepted_faces,
        count(*) FILTER (WHERE embedding.embedding_id IS NOT NULL)::int
          AS provider_embeddings
      FROM accepted
      LEFT JOIN face_embedding embedding ON embedding.face_id = accepted.face_id
        AND embedding.state = 'active'
        AND embedding.model_family = ${provider.modelFamily}
        AND embedding.model_version = ${provider.modelVersion}
        AND embedding.config_digest = ${provider.configDigest}
    `;
    const [latest] = await sql`
      SELECT pack_id
      FROM source_pack
      WHERE model_family = ${provider.modelFamily}
        AND model_version = ${provider.modelVersion}
        AND config_digest = ${provider.configDigest}
      ORDER BY CASE state
        WHEN 'active' THEN 0 WHEN 'proposed' THEN 1 WHEN 'shadow' THEN 2
        WHEN 'retired' THEN 3 ELSE 4 END, created_at DESC, pack_id
      LIMIT 1
    `;
    const latestPack = latest
      ? projectPack(await loadPackRow(latest.pack_id))
      : null;
    const providerEmbeddings = Number(evidence?.provider_embeddings || 0);
    if (matching.enhanced?.enabled === false) {
      return {
        ...matching,
        evidence: {
          acceptedFaces: Number(evidence?.accepted_faces || 0),
          providerEmbeddings,
        },
        latestPack,
        next: {
          action: "enable_enhanced",
          reason: "ENHANCED_DISABLED",
          settings: "/v1/operator/enhanced",
        },
        providerValidation: {
          modelFamily: provider.modelFamily,
          modelVersion: provider.modelVersion,
          providerId: provider.providerId,
          state: "ready",
          vectorSpaceId: provider.vectorSpaceId,
        },
      };
    }
    let next = { action: "review_suggestions", reason: "MATCHING_READY" };
    if (matching.state === "needs_source_pack") {
      next =
        latestPack?.evaluation.status === "failed"
          ? {
              action: "compile_source_pack",
              reason: "SOURCE_PACK_REVIEW_REJECTED",
            }
          : providerEmbeddings === 0
            ? {
                action: "run_recognition",
                reason: "PROVIDER_EVIDENCE_NOT_READY",
              }
            : { action: "compile_source_pack", reason: "NO_SOURCE_PACK" };
    } else if (matching.state === "needs_operator_review") {
      if (
        latestPack?.state === "proposed" &&
        latestPack.evaluation.status === "passed" &&
        latestPack.evaluation.reason === null
      ) {
        next = {
          action: "activate_source_pack",
          reason: "SOURCE_PACK_READY_FOR_ACTIVATION",
        };
      } else {
        next = {
          action:
            latestPack?.evaluation.status === "untested"
              ? "evaluate_source_pack"
              : "record_operator_review",
          reason:
            latestPack?.evaluation.reason || "OPERATOR_REVIEW_GATE_REQUIRED",
        };
      }
    } else if (matching.state === "needs_review_policy") {
      next = {
        action: "record_operator_review",
        reason: "SOURCE_PACK_REVIEW_POLICY_REQUIRED",
      };
    }
    return {
      ...matching,
      evidence: {
        acceptedFaces: Number(evidence?.accepted_faces || 0),
        providerEmbeddings,
      },
      latestPack,
      next,
      providerValidation: {
        modelFamily: provider.modelFamily,
        modelVersion: provider.modelVersion,
        providerId: provider.providerId,
        state: "ready",
        vectorSpaceId: provider.vectorSpaceId,
      },
    };
  };

  const runRecognition = async ({ actorId, commandId, workLimit } = {}) => {
    requireProvider();
    if (!mediaOperator) {
      throw typedError(
        "The local media operator is unavailable",
        "FACE_MATCHING_MEDIA_OPERATOR_UNAVAILABLE",
        503,
      );
    }
    const limit = boundedInteger(workLimit, 10, 1, 25, "workLimit");
    const result = await mediaOperator.execute({
      actorId: requiredPublicId(actorId, "actorId"),
      commandId: requiredPublicId(commandId, "commandId"),
      commandKind: "run",
      envelope: {
        candidateLimit: 0,
        leaseSeconds: 300,
        maxDetectionJobs: limit,
        maxDurationMs: 300_000,
        maxInventoryPages: 1,
        maxPendingJobs: 10_000,
        maxRecognitionJobs: limit,
      },
    });
    return {
      automaticIdentityAuthority: "none",
      commandId: result.commandId,
      inventory: result.inventory
        ? {
            admittedAssetCount: Number(
              result.inventory.admittedAssetCount || 0,
            ),
            state: result.inventory.state || null,
          }
        : null,
      queue: {
        failed: Number(result.queueAfter?.failed || 0),
        paused: Number(result.queueAfter?.paused || 0),
        pending: Number(result.queueAfter?.pending || 0),
        processing: Number(result.queueAfter?.processing || 0),
      },
      replayed: Boolean(result.replayed),
      schemaVersion: faceMatchingOperatorSchemaVersion,
      state: result.state,
      work: {
        detections: Number(result.work?.detections || 0),
        inventoryPages: Number(result.work?.inventoryPages || 0),
        recognitions: Number(result.work?.recognitions || 0),
      },
    };
  };

  const compile = async () => {
    await requireEnhanced();
    const provider = requireProvider();
    const faces = await loadSourcePackFaces(sql, {
      configDigest: provider.configDigest,
      modelFamily: provider.modelFamily,
      modelVersion: provider.modelVersion,
    });
    const plan = deriveOwnerSourcePackPlan(faces);
    const [active] = await sql`
      SELECT pack_id, source_revision_digest,
        manifest->>'evidenceCutoff' AS evidence_cutoff
      FROM current_source_pack
      WHERE model_family = ${provider.modelFamily}
        AND model_version = ${provider.modelVersion}
        AND config_digest = ${provider.configDigest}
    `;
    const { pack } = await compileAndPersistSourcePack(
      sql,
      {
        configDigest: provider.configDigest,
        cutoff: plan.evidenceCutoff,
        evaluationContext: {
          calibrationEnd: plan.calibrationEnd,
          reason: plan.reason,
          reviewability: plan.reviewability,
          schemaVersion: plan.schemaVersion,
          strategy: plan.strategy,
        },
        modelFamily: provider.modelFamily,
        modelVersion: provider.modelVersion,
        predecessorPackId: active?.pack_id || null,
      },
      { execute: false },
    );
    if (
      active &&
      active.source_revision_digest === pack.sourceRevisionDigest &&
      isoTime(active.evidence_cutoff) === pack.evidenceCutoff
    ) {
      return {
        automaticIdentityAuthority: "none",
        changed: false,
        pack: projectPack(await loadPackRow(active.pack_id)),
        plan: {
          calibrationQueries: plan.calibrationQueries,
          completePeople: plan.completePeople,
          holdoutQueries: plan.holdoutQueries,
          reason: plan.reason,
          referenceEvidence: plan.referenceEvidence,
          referencePeople: plan.referencePeople,
          reviewability: plan.reviewability,
          schemaVersion: plan.schemaVersion,
          strategy: plan.strategy,
        },
        replayed: true,
        schemaVersion: faceMatchingOperatorSchemaVersion,
      };
    }
    const persistence = await persistSourcePack(sql, pack, { execute: true });
    return {
      automaticIdentityAuthority: "none",
      changed: persistence.created,
      pack: projectPack(await loadPackRow(pack.packId)),
      plan: {
        calibrationQueries: plan.calibrationQueries,
        completePeople: plan.completePeople,
        holdoutQueries: plan.holdoutQueries,
        reason: plan.reason,
        referenceEvidence: plan.referenceEvidence,
        referencePeople: plan.referencePeople,
        reviewability: plan.reviewability,
        schemaVersion: plan.schemaVersion,
        strategy: plan.strategy,
      },
      replayed: !persistence.created,
      schemaVersion: faceMatchingOperatorSchemaVersion,
    };
  };

  const readPack = async ({ packId }) => ({
    automaticIdentityAuthority: "none",
    pack: projectPack(await loadPackRow(packId)),
    schemaVersion: faceMatchingOperatorSchemaVersion,
  });

  const evaluate = async ({ packId }) => {
    await requireEnhanced();
    const row = await loadPackRow(packId);
    const [existing] = await sql`
      SELECT evaluation_id, cohort_digest, leakage_assertions, metrics,
        split_definition, status
      FROM source_pack_evaluation
      WHERE pack_id = ${row.pack_id}
        AND evaluator_version = ${sourcePackEvaluatorVersion}
      ORDER BY created_at, evaluation_id
      LIMIT 1
    `;
    if (existing) {
      return {
        automaticIdentityAuthority: "none",
        changed: false,
        evaluation: projectEvaluation(
          {
            cohortDigest: existing.cohort_digest,
            leakage: existing.leakage_assertions,
            metrics: existing.metrics?.lanes || [],
            reviewGate: existing.metrics?.reviewGate || null,
            split: existing.split_definition,
            status: existing.status,
            verifiedUnknowns: existing.metrics?.verifiedUnknowns || 0,
          },
          existing.evaluation_id,
          row.pack_id,
        ),
        pack: projectPack(await loadPackRow(row.pack_id)),
        replayed: true,
        schemaVersion: faceMatchingOperatorSchemaVersion,
      };
    }
    const [pack] = await sql`
      SELECT manifest FROM source_pack WHERE pack_id = ${row.pack_id}
    `;
    const calibrationEnd = pack?.manifest?.evaluationContext?.calibrationEnd;
    if (!calibrationEnd) {
      throw typedError(
        "This pack has no truthful temporal holdout",
        "FACE_MATCHING_HOLDOUT_UNAVAILABLE",
      );
    }
    const evaluation = await evaluateSourcePack(sql, {
      calibrationEnd,
      maxQueriesPerPerson: 5,
      packId: row.pack_id,
    });
    const persistence = await persistSourcePackEvaluation(
      sql,
      row.pack_id,
      evaluation,
      { execute: true },
    );
    return {
      automaticIdentityAuthority: "none",
      changed: persistence.created,
      evaluation: projectEvaluation(
        evaluation,
        persistence.evaluationId,
        row.pack_id,
      ),
      pack: projectPack(await loadPackRow(row.pack_id)),
      replayed: !persistence.created,
      schemaVersion: faceMatchingOperatorSchemaVersion,
    };
  };

  const recordReview = async ({ gateReceipt, packId }) => {
    await requireEnhanced();
    const row = await loadPackRow(packId);
    let validated;
    try {
      validated = validateSourcePackGateReceipt(gateReceipt, row.pack_id);
    } catch {
      throw typedError(
        "SourcePack operator review receipt is invalid",
        "FACE_MATCHING_REVIEW_INVALID",
        400,
      );
    }
    const projected = projectPack(row);
    if (!projected.reviewGateReceipt) {
      throw typedError(
        "SourcePack does not have a reviewable frozen gate artifact",
        "FACE_MATCHING_REVIEW_UNAVAILABLE",
      );
    }
    if (digest(projected.reviewGateReceipt) !== digest(validated)) {
      throw typedError(
        "Operator review does not match the frozen server artifact",
        "FACE_MATCHING_REVIEW_ARTIFACT_MISMATCH",
      );
    }
    const [current] = await sql`
      SELECT evaluation_summary
      FROM source_pack WHERE pack_id = ${row.pack_id}
    `;
    if (
      current?.evaluation_summary?.schemaVersion === sourcePackGateSchemaVersion
    ) {
      const existing = validateSourcePackGateReceipt(
        current.evaluation_summary,
        row.pack_id,
      );
      if (digest(existing) !== digest(validated)) {
        throw typedError(
          "This SourcePack already has another operator review",
          "FACE_MATCHING_REVIEW_CONFLICT",
        );
      }
      return {
        automaticIdentityAuthority: "none",
        changed: false,
        disposition: existing.status,
        pack: projectPack(await loadPackRow(row.pack_id)),
        replayed: true,
        schemaVersion: faceMatchingOperatorSchemaVersion,
      };
    }
    await persistSourcePackGateReceipt(sql, validated, { execute: true });
    return {
      automaticIdentityAuthority: "none",
      changed: true,
      disposition: validated.status,
      pack: projectPack(await loadPackRow(row.pack_id)),
      replayed: false,
      schemaVersion: faceMatchingOperatorSchemaVersion,
    };
  };

  const activate = async ({
    expectedEvaluationId,
    expectedCurrentPackId,
    packId,
  }) => {
    await requireEnhanced();
    const row = await loadPackRow(packId);
    const expectedEvaluation = requiredPublicId(
      expectedEvaluationId,
      "expectedEvaluationId",
    );
    if (row.evaluation_id !== expectedEvaluation) {
      throw typedError(
        "SourcePack evaluation head changed",
        "FACE_MATCHING_SOURCE_PACK_STALE",
      );
    }
    const [active] = await sql`
      SELECT pack_id FROM current_source_pack
      WHERE model_family = ${requireProvider().modelFamily}
        AND model_version = ${matchingProvider.modelVersion}
        AND config_digest = ${matchingProvider.configDigest}
    `;
    const expectedCurrent =
      expectedCurrentPackId == null || expectedCurrentPackId === ""
        ? null
        : requiredPublicId(expectedCurrentPackId, "expectedCurrentPackId");
    if (active?.pack_id === row.pack_id && row.state === "active") {
      return {
        activated: false,
        automaticIdentityAuthority: "none",
        changed: false,
        pack: projectPack(row),
        replayed: true,
        retiredPackIds: [],
        schemaVersion: faceMatchingOperatorSchemaVersion,
      };
    }
    if ((active?.pack_id || null) !== expectedCurrent) {
      throw typedError(
        "Active SourcePack head changed",
        "FACE_MATCHING_SOURCE_PACK_STALE",
      );
    }
    const result = await activateSourcePack(sql, row.pack_id, {
      execute: true,
    });
    return {
      activated: result.activated,
      automaticIdentityAuthority: "none",
      changed: result.activated,
      pack: projectPack(await loadPackRow(row.pack_id)),
      replayed: false,
      retiredPackIds: result.retiredPackIds,
      schemaVersion: faceMatchingOperatorSchemaVersion,
    };
  };

  const rollback = async ({ expectedPredecessorPackId, packId }) => {
    await requireEnhanced();
    const row = await loadPackRow(packId);
    const predecessorId = requiredPublicId(
      expectedPredecessorPackId,
      "expectedPredecessorPackId",
    );
    if (row.predecessor_pack_id !== predecessorId) {
      throw typedError(
        "SourcePack predecessor head changed",
        "FACE_MATCHING_SOURCE_PACK_STALE",
      );
    }
    const [predecessor] = await sql`
      SELECT state FROM source_pack WHERE pack_id = ${predecessorId}
    `;
    if (row.state === "retired" && predecessor?.state === "active") {
      return {
        automaticIdentityAuthority: "none",
        changed: false,
        replayed: true,
        restoredPackId: predecessorId,
        rolledBack: true,
        schemaVersion: faceMatchingOperatorSchemaVersion,
      };
    }
    const result = await rollbackSourcePack(sql, row.pack_id, {
      execute: true,
    });
    return {
      automaticIdentityAuthority: "none",
      changed: result.rolledBack,
      replayed: false,
      restoredPackId: result.restoredPackId,
      rolledBack: result.rolledBack,
      schemaVersion: faceMatchingOperatorSchemaVersion,
    };
  };

  return {
    activate,
    compile,
    evaluate,
    readPack,
    recordReview,
    rollback,
    runRecognition,
    status,
  };
};
