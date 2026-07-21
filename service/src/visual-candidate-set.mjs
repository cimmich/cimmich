import { recognitionDigest } from "./recognition-provider-contract.mjs";
import {
  bodyContinuityRepositoryProjectionSchemaVersion,
  projectValidatedBodyContinuityForRepository,
} from "./body-continuity-contract.mjs";
import { allTrustedShortlistPolicyV1 } from "./all-trusted-shortlist-policy.mjs";

export const visualCandidateSetSchemaVersion =
  "cimmich.visual-candidate-set.v1";
export const visualCandidateBodyEvidenceSchemaVersion =
  "cimmich.visual-candidate-body-evidence.v1";
export const visualCandidateCaptureEvidenceSchemaVersion =
  "cimmich.visual-candidate-capture-evidence.v1";
export const visualCandidateSamePhotoEvidenceSchemaVersion =
  "cimmich.visual-candidate-same-photo-evidence.v1";

const digestPattern = /^[0-9a-f]{64}$/;
const vectorSpacePattern = /^vector_space_[0-9a-f]{64}$/;
const publicIdPattern = /^[a-z0-9][a-z0-9._-]{0,95}$/;
const scorePrecision = 6;
const scorerVersion = "cimmich-best-individual-prime-v1";

const validatedEnvelopes = new WeakSet();
const validatedBodyEvidenceEnvelopes = new WeakSet();
const validatedCaptureEvidenceEnvelopes = new WeakSet();
const validatedSamePhotoEvidenceEnvelopes = new WeakSet();
const privateCandidateBindings = new WeakMap();
const privateConditionReviewSuggestions = new WeakMap();
const privateAllTrustedShortlistSuggestions = new WeakMap();

const typedError = (
  message,
  code = "VISUAL_CANDIDATE_SET_INPUT_INVALID",
  statusCode = 400,
) => Object.assign(new Error(message), { code, statusCode });

const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

const exactObject = (value, label, keys) => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw typedError(`${label} must be an object`);
  }
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !keys.includes(key))
  ) {
    throw typedError(`${label} must use the exact contract fields`);
  }
  return value;
};

const requiredDigest = (value, label) => {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw typedError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
};

const requiredVectorSpace = (value, label) => {
  if (typeof value !== "string" || !vectorSpacePattern.test(value)) {
    throw typedError(`${label} must be a derived vector-space identifier`);
  }
  return value;
};

const requiredPublicId = (value, label) => {
  if (typeof value !== "string" || !publicIdPattern.test(value)) {
    throw typedError(`${label} must be a bounded public identifier`);
  }
  return value;
};

const requiredPrivateId = (value, label) => {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 160 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw typedError(`${label} must be a bounded internal identifier`);
  }
  return value;
};

const requiredLimit = (value) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 64) {
    throw typedError("limit must be an integer from 1 to 64");
  }
  return value;
};

const requiredFloor = (value) => {
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1 ||
    Number(value.toFixed(scorePrecision)) !== value
  ) {
    throw typedError("visualFloor must be a canonical unit-interval decimal");
  }
  return value;
};

const requiredContextKind = (value) => {
  if (!["rapid_burst", "same_moment", "sequence"].includes(value)) {
    throw typedError(
      "Capture context kind is invalid",
      "VISUAL_CANDIDATE_SET_REPOSITORY_CONFLICT",
      409,
    );
  }
  return value;
};

const requiredAssociationType = (value) => {
  if (!["body", "body_link", "face", "head", "presence"].includes(value)) {
    throw typedError(
      "Same-photo association type is invalid",
      "VISUAL_CANDIDATE_SET_REPOSITORY_CONFLICT",
      409,
    );
  }
  return value;
};

const canonicalUnitScore = (value, label) => {
  const numeric = Number(value);
  if (
    !Number.isFinite(numeric) ||
    numeric < 0 ||
    numeric > 1 ||
    Number(numeric.toFixed(scorePrecision)) !== numeric
  ) {
    throw typedError(
      `${label} must be a canonical unit-interval score`,
      "VISUAL_CANDIDATE_SET_REPOSITORY_CONFLICT",
      409,
    );
  }
  return numeric;
};

const requiredPrivateIdList = (value, label) => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) {
    throw typedError(
      `${label} must be a bounded non-empty identifier list`,
      "VISUAL_CANDIDATE_SET_REPOSITORY_CONFLICT",
      409,
    );
  }
  const result = value.map((item, index) =>
    requiredPrivateId(item, `${label}[${index}]`),
  );
  if (new Set(result).size !== result.length) {
    throw typedError(
      `${label} must contain unique identifiers`,
      "VISUAL_CANDIDATE_SET_REPOSITORY_CONFLICT",
      409,
    );
  }
  return [...result].sort();
};

const requiredDigestList = (value, label) => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) {
    throw typedError(
      `${label} must be a bounded non-empty digest list`,
      "VISUAL_CANDIDATE_SET_REPOSITORY_CONFLICT",
      409,
    );
  }
  const result = value.map((item, index) =>
    requiredDigest(item, `${label}[${index}]`),
  );
  return [...result].sort();
};

const optionalTimestamp = (value, label) => {
  if (value == null) return null;
  const milliseconds = new Date(value).getTime();
  if (!Number.isFinite(milliseconds)) {
    throw typedError(
      `${label} must be a valid timestamp`,
      "VISUAL_CANDIDATE_SET_REPOSITORY_CONFLICT",
      409,
    );
  }
  return milliseconds;
};

const canonicalScore = (value, label) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < -1 || numeric > 1) {
    throw typedError(
      `${label} must be a finite cosine score`,
      "VISUAL_CANDIDATE_SET_REPOSITORY_CONFLICT",
      409,
    );
  }
  return Number(numeric.toFixed(scorePrecision));
};

const unavailableEnvelope = (reason, requestedConfigDigest) => {
  const core = {
    authority: {
      activation: "none",
      automaticIdentityAuthority: "none",
      persistence: "none",
      recommendation: "none",
      training: "none",
    },
    baseline: null,
    binding: null,
    boundary: {
      candidateManufacture: "forbidden",
      currentRepositoryRevisionValidation: "not_available",
      identityProjection: "none",
      repositoryWrites: "none",
      sourceMediaRead: "none",
    },
    candidateSetDigest: recognitionDigest([]),
    candidates: [],
    queryToken: null,
    reason,
    requestedProviderConfigDigest: requestedConfigDigest,
    schemaVersion: visualCandidateSetSchemaVersion,
    scorerVersion,
    state: "unavailable",
  };
  const envelope = deepFreeze({
    ...core,
    receiptDigest: recognitionDigest(core),
  });
  validatedEnvelopes.add(envelope);
  privateCandidateBindings.set(envelope, {
    candidates: new Map(),
    query: null,
  });
  return envelope;
};

const normalizeBindingRow = (row, requestedConfigDigest) => {
  if (row == null || typeof row !== "object" || Array.isArray(row)) {
    throw typedError("Repository binding row is invalid");
  }
  const configDigest = requiredDigest(row.config_digest, "configDigest");
  if (configDigest !== requestedConfigDigest) {
    throw typedError(
      "Repository provider binding conflicts with the requested configuration",
      "VISUAL_CANDIDATE_SET_BINDING_CONFLICT",
      409,
    );
  }
  return {
    assetId: requiredPrivateId(row.asset_id, "assetId"),
    currentPersonId:
      row.current_person_id == null
        ? null
        : requiredPrivateId(row.current_person_id, "currentPersonId"),
    dimension: Number(row.dimension),
    embeddingId: requiredPrivateId(row.embedding_id, "embeddingId"),
    faceId: requiredPrivateId(row.face_id, "faceId"),
    inputRevision: requiredDigest(row.input_revision, "inputRevision"),
    modelFamily: requiredPrivateId(row.model_family, "modelFamily"),
    modelVersion: requiredPrivateId(row.model_version, "modelVersion"),
    packDigest: requiredDigest(row.pack_digest, "packDigest"),
    packId: requiredPrivateId(row.pack_id, "packId"),
    policyVersion: requiredPublicId(row.policy_version, "policyVersion"),
    providerConfigDigest: configDigest,
    sourceContentDigest: requiredDigest(
      row.source_content_digest,
      "sourceContentDigest",
    ),
    sourceRevisionDigest: requiredDigest(
      row.source_revision_digest,
      "sourceRevisionDigest",
    ),
    vectorDigest: requiredDigest(row.vector_digest, "vectorDigest"),
    vectorSpaceId: requiredVectorSpace(row.vector_space_id, "vectorSpaceId"),
  };
};

const issueEnvelope = (binding, candidateRows, visualFloor) => {
  if (!Array.isArray(candidateRows)) {
    throw typedError("Repository candidate rows must be an array");
  }
  const queryRevisionDigest = recognitionDigest({
    inputRevision: binding.inputRevision,
    sourceContentDigest: binding.sourceContentDigest,
  });
  const queryEvidenceDigest = recognitionDigest({
    embeddingId: binding.embeddingId,
    faceId: binding.faceId,
    providerConfigDigest: binding.providerConfigDigest,
    vectorDigest: binding.vectorDigest,
    vectorSpaceId: binding.vectorSpaceId,
  });
  const visualPolicyDigest = recognitionDigest({
    packPolicyVersion: binding.policyVersion,
    scorerVersion,
    visualFloor,
  });
  const queryToken = recognitionDigest({
    assetId: binding.assetId,
    faceId: binding.faceId,
    packDigest: binding.packDigest,
    queryEvidenceDigest,
    queryRevisionDigest,
    visualPolicyDigest,
  });
  const seenPeople = new Set();
  const privateBindings = new Map();
  const candidates = candidateRows.map((row, index) => {
    const personId = requiredPrivateId(
      row?.person_id,
      `candidateRows[${index}].personId`,
    );
    if (seenPeople.has(personId)) {
      throw typedError(
        "Repository candidate rows contain a duplicate subject",
        "VISUAL_CANDIDATE_SET_REPOSITORY_CONFLICT",
        409,
      );
    }
    seenPeople.add(personId);
    const visualScore = canonicalScore(
      row.visual_score,
      `candidateRows[${index}].visualScore`,
    );
    if (visualScore < visualFloor) {
      throw typedError(
        "Repository returned a candidate below the frozen visual floor",
        "VISUAL_CANDIDATE_SET_REPOSITORY_CONFLICT",
        409,
      );
    }
    const candidateToken = recognitionDigest({
      packDigest: binding.packDigest,
      personId,
      providerConfigDigest: binding.providerConfigDigest,
      queryToken,
      visualPolicyDigest,
    });
    privateBindings.set(candidateToken, { personId });
    return { candidateToken, visualScore };
  });
  candidates.sort(
    (left, right) =>
      right.visualScore - left.visualScore ||
      left.candidateToken.localeCompare(right.candidateToken),
  );
  if (candidates.length === 0) {
    const core = {
      authority: {
        activation: "none",
        automaticIdentityAuthority: "none",
        persistence: "none",
        recommendation: "none",
        training: "none",
      },
      baseline: null,
      binding: {
        packDigest: binding.packDigest,
        providerConfigDigest: binding.providerConfigDigest,
        queryEvidenceDigest,
        queryRevisionDigest,
        sourceRevisionDigest: binding.sourceRevisionDigest,
        vectorSpaceId: binding.vectorSpaceId,
        visualPolicyDigest,
      },
      boundary: {
        candidateManufacture: "forbidden",
        currentRepositoryRevisionValidation: "performed_at_issue",
        identityProjection: "none",
        repositoryWrites: "none",
        sourceMediaRead: "none",
      },
      candidateSetDigest: recognitionDigest([]),
      candidates: [],
      queryToken,
      reason: "NO_VISUAL_CANDIDATES",
      requestedProviderConfigDigest: binding.providerConfigDigest,
      schemaVersion: visualCandidateSetSchemaVersion,
      scorerVersion,
      state: "unavailable",
    };
    const envelope = deepFreeze({
      ...core,
      receiptDigest: recognitionDigest(core),
    });
    validatedEnvelopes.add(envelope);
    privateCandidateBindings.set(envelope, {
      candidates: privateBindings,
      query: deepFreeze({ ...binding }),
    });
    return envelope;
  }
  const margin =
    candidates.length === 1
      ? 1
      : Number(
          (candidates[0].visualScore - candidates[1].visualScore).toFixed(
            scorePrecision,
          ),
        );
  const candidateSetDigest = recognitionDigest(candidates);
  const core = {
    authority: {
      activation: "none",
      automaticIdentityAuthority: "none",
      persistence: "none",
      recommendation: "none",
      training: "none",
    },
    baseline: {
      candidateToken: candidates[0].candidateToken,
      margin,
      visualScore: candidates[0].visualScore,
    },
    binding: {
      packDigest: binding.packDigest,
      providerConfigDigest: binding.providerConfigDigest,
      queryEvidenceDigest,
      queryRevisionDigest,
      sourceRevisionDigest: binding.sourceRevisionDigest,
      vectorSpaceId: binding.vectorSpaceId,
      visualPolicyDigest,
    },
    boundary: {
      candidateManufacture: "forbidden",
      currentRepositoryRevisionValidation: "performed_at_issue",
      identityProjection: "none",
      repositoryWrites: "none",
      sourceMediaRead: "none",
    },
    candidateSetDigest,
    candidates,
    queryToken,
    reason: null,
    requestedProviderConfigDigest: binding.providerConfigDigest,
    schemaVersion: visualCandidateSetSchemaVersion,
    scorerVersion,
    state: "available",
  };
  const envelope = deepFreeze({
    ...core,
    receiptDigest: recognitionDigest(core),
  });
  validatedEnvelopes.add(envelope);
  privateCandidateBindings.set(envelope, {
    candidates: privateBindings,
    query: deepFreeze({ ...binding }),
  });
  return envelope;
};

const requireValidatedEnvelope = (envelope) => {
  if (
    envelope == null ||
    typeof envelope !== "object" ||
    !validatedEnvelopes.has(envelope) ||
    !privateCandidateBindings.has(envelope)
  ) {
    throw typedError(
      "An exact repository-issued candidate envelope is required",
    );
  }
  return envelope;
};

export const projectValidatedVisualCandidateSet = (envelope) =>
  requireValidatedEnvelope(envelope);

const issueBodyEvidenceEnvelope = (core) => {
  const envelope = deepFreeze({
    ...core,
    receiptDigest: recognitionDigest(core),
  });
  validatedBodyEvidenceEnvelopes.add(envelope);
  return envelope;
};

export const projectValidatedCandidateBodyEvidence = (envelope) => {
  if (
    envelope == null ||
    typeof envelope !== "object" ||
    !validatedBodyEvidenceEnvelopes.has(envelope)
  ) {
    throw typedError(
      "An exact issued candidate Body evidence envelope is required",
    );
  }
  return envelope;
};

const issueCaptureEvidenceEnvelope = (core) => {
  const envelope = deepFreeze({
    ...core,
    receiptDigest: recognitionDigest(core),
  });
  validatedCaptureEvidenceEnvelopes.add(envelope);
  return envelope;
};

export const projectValidatedCandidateCaptureEvidence = (envelope) => {
  if (
    envelope == null ||
    typeof envelope !== "object" ||
    !validatedCaptureEvidenceEnvelopes.has(envelope)
  ) {
    throw typedError(
      "An exact issued candidate capture evidence envelope is required",
    );
  }
  return envelope;
};

const issueSamePhotoEvidenceEnvelope = (core) => {
  const envelope = deepFreeze({
    ...core,
    receiptDigest: recognitionDigest(core),
  });
  validatedSamePhotoEvidenceEnvelopes.add(envelope);
  return envelope;
};

export const projectValidatedCandidateSamePhotoEvidence = (envelope) => {
  if (
    envelope == null ||
    typeof envelope !== "object" ||
    !validatedSamePhotoEvidenceEnvelopes.has(envelope)
  ) {
    throw typedError(
      "An exact issued candidate same-photo evidence envelope is required",
    );
  }
  return envelope;
};

export const createVisualCandidateSetRepository = (
  sql,
  {
    allTrustedShortlistEvaluationReceiptDigest = "",
    allTrustedShortlistFrozenSourcePackId = "",
    presentationRank,
  },
) => {
  if (typeof sql !== "function" || typeof presentationRank !== "function") {
    throw new TypeError(
      "Visual candidate repository requires SQL and visibility-rank functions",
    );
  }

  const load = async (input) => {
    exactObject(input, "input", [
      "faceId",
      "limit",
      "providerConfigDigest",
      "visualFloor",
    ]);
    const faceId = requiredPrivateId(input.faceId, "faceId");
    const limit = requiredLimit(input.limit);
    const providerConfigDigest = requiredDigest(
      input.providerConfigDigest,
      "providerConfigDigest",
    );
    const visualFloor = requiredFloor(input.visualFloor);
    const visibleRank = presentationRank();
    if (
      !Number.isSafeInteger(visibleRank) ||
      visibleRank < 0 ||
      visibleRank > 2
    ) {
      throw typedError("presentation rank is invalid");
    }

    const bindingRows = await sql`
      SELECT DISTINCT face.face_id, face.asset_id,
        provider.input_revision, provider.source_content_digest,
        embedding.embedding_id, embedding.model_family,
        embedding.model_version, embedding.config_digest,
        embedding.dimension, embedding.vector_digest,
        provider.vector_space_id, pack.pack_id, pack.pack_digest,
        pack.policy_version, pack.source_revision_digest,
        current_identity.person_id AS current_person_id
      FROM face_observation face
      JOIN asset query_asset ON query_asset.asset_id = face.asset_id
        AND query_asset.state = 'active'
      JOIN face_embedding embedding ON embedding.face_id = face.face_id
        AND embedding.state = 'active'
        AND embedding.config_digest = ${providerConfigDigest}
      JOIN LATERAL (
        SELECT pipeline.vector_space_id, pipeline.source_content_digest,
          pipeline.input_revision
        FROM media_pipeline_run pipeline
        JOIN media_job job ON job.job_id = pipeline.recognition_job_id
          AND job.state = 'completed'
          AND job.result_receipt_id = embedding.producer_receipt_id
        JOIN current_asset_source_revision revision
          ON revision.revision_id = pipeline.source_revision_id
          AND revision.asset_id = pipeline.asset_id
          AND revision.input_revision = pipeline.input_revision
          AND revision.source_content_digest = pipeline.source_content_digest
        WHERE pipeline.asset_id = face.asset_id
          AND pipeline.run_kind = 'existing_observation_set'
          AND pipeline.recognizer_config_digest = embedding.config_digest
          AND pipeline.state = 'recognized'
        UNION
        SELECT pipeline.vector_space_id, result.source_content_digest,
          pipeline.input_revision
        FROM media_pipeline_run pipeline
        JOIN media_job job ON job.job_id = pipeline.recognition_job_id
          AND job.state = 'completed'
          AND job.result_receipt_id = embedding.producer_receipt_id
        JOIN face_detection_result result
          ON result.detection_result_id = pipeline.detection_result_id
          AND result.asset_id = pipeline.asset_id
          AND result.source_content_digest = pipeline.source_content_digest
        JOIN face_detection_result_observation observation
          ON observation.detection_result_id = result.detection_result_id
          AND observation.face_id = face.face_id
        JOIN immich_asset_projection projection
          ON projection.cimmich_asset_id = pipeline.asset_id
          AND projection.input_revision = pipeline.input_revision
          AND projection.state = 'active'
        WHERE pipeline.asset_id = face.asset_id
          AND pipeline.run_kind = 'detector_result'
          AND pipeline.recognizer_config_digest = embedding.config_digest
          AND pipeline.state = 'recognized'
        UNION
        SELECT evidence.vector_space_id, evidence.source_content_digest,
          evidence.input_revision
        FROM current_manual_face_matching_evidence evidence
        WHERE evidence.face_id = face.face_id
          AND evidence.embedding_id = embedding.embedding_id
          AND evidence.config_digest = embedding.config_digest
          AND evidence.vector_digest = embedding.vector_digest
      ) provider ON true
      JOIN source_pack pack ON pack.state = 'active'
        AND pack.evaluation_status = 'passed'
        AND pack.model_family = embedding.model_family
        AND pack.model_version = embedding.model_version
        AND pack.config_digest = embedding.config_digest
        AND pack.dimension = embedding.dimension
      LEFT JOIN current_face_identity current_identity
        ON current_identity.face_id = face.face_id
        AND current_identity.state = 'accepted'
      WHERE face.face_id = ${faceId} AND face.state = 'valid'
        AND cimmich_visibility_asset_rank(face.asset_id) <= ${visibleRank}
      ORDER BY pack.pack_digest, embedding.embedding_id, provider.vector_space_id
    `;
    if (bindingRows.length === 0) {
      return unavailableEnvelope(
        "PROVIDER_OR_ACTIVE_PACK_BINDING_UNAVAILABLE",
        providerConfigDigest,
      );
    }
    if (bindingRows.length !== 1) {
      throw typedError(
        "Visual candidate query has ambiguous provider or active-pack lineage",
        "VISUAL_CANDIDATE_SET_BINDING_AMBIGUOUS",
        409,
      );
    }
    const binding = normalizeBindingRow(bindingRows[0], providerConfigDigest);
    if (!Number.isSafeInteger(binding.dimension) || binding.dimension < 1) {
      throw typedError(
        "Repository embedding dimension is invalid",
        "VISUAL_CANDIDATE_SET_REPOSITORY_CONFLICT",
        409,
      );
    }
    const candidateRows = await sql`
      WITH query AS (
        SELECT face.asset_id, embedding.embedding
        FROM face_observation face
        JOIN face_embedding embedding ON embedding.face_id = face.face_id
          AND embedding.embedding_id = ${binding.embeddingId}
          AND embedding.state = 'active'
        WHERE face.face_id = ${binding.faceId} AND face.state = 'valid'
          AND cimmich_visibility_asset_rank(face.asset_id) <= ${visibleRank}
      ), query_context AS (
        SELECT context_id FROM current_face_capture_context
        WHERE face_id = ${binding.faceId}
      ), evidence_raw AS (
        SELECT reference.person_id,
          coalesce((
            SELECT 'context:' || min(context.context_id)
            FROM current_face_capture_context context
            WHERE context.face_id = reference.face_id
          ), 'asset:' || reference_face.asset_id) AS evidence_unit,
          (1 - (reference.embedding <=> query.embedding))::float8 AS score
        FROM query
        JOIN source_pack_reference reference
          ON reference.pack_id = ${binding.packId}
          AND reference.bucket_kind = 'prime'
          AND reference.reference_kind = 'face'
          AND reference.routing_state = 'eligible'
          AND reference.model_family = ${binding.modelFamily}
          AND reference.model_version = ${binding.modelVersion}
          AND reference.config_digest = ${binding.providerConfigDigest}
          AND reference.dimension = ${binding.dimension}
        JOIN face_observation reference_face
          ON reference_face.face_id = reference.face_id
          AND reference_face.state = 'valid'
        JOIN current_person subject ON subject.person_id = reference.person_id
          AND subject.status = 'active' AND subject.subject_kind = 'person'
        WHERE reference_face.asset_id <> query.asset_id
          AND cimmich_visibility_asset_rank(reference_face.asset_id) <= ${visibleRank}
          AND reference.person_id IS DISTINCT FROM ${binding.currentPersonId}
          AND NOT EXISTS (
            SELECT 1 FROM current_face_capture_context context
            WHERE context.face_id = reference.face_id
              AND context.context_id IN (SELECT context_id FROM query_context)
          )
      ), evidence AS (
        SELECT person_id, evidence_unit, max(score)::float8 AS score
        FROM evidence_raw GROUP BY person_id, evidence_unit
      ), ranked AS (
        SELECT person_id, score, row_number() OVER (
          PARTITION BY person_id ORDER BY score DESC, evidence_unit
        ) AS evidence_rank
        FROM evidence
      ), candidate AS (
        SELECT person_id, max(score)::float8 AS visual_score,
          avg(score) FILTER (WHERE evidence_rank <= 3)::float8 AS top3_score
        FROM ranked GROUP BY person_id
      )
      SELECT person_id, visual_score
      FROM candidate
      WHERE visual_score >= ${visualFloor}
      ORDER BY visual_score DESC, top3_score DESC NULLS LAST, person_id
      LIMIT ${limit}
    `;
    return issueEnvelope(binding, candidateRows, visualFloor);
  };

  const project = (envelope) => requireValidatedEnvelope(envelope);

  const loadBodyEvidence = async (input) => {
    exactObject(input, "input", ["candidateEnvelope", "continuityEnvelope"]);
    const candidateEnvelope = requireValidatedEnvelope(input.candidateEnvelope);
    const privateBinding = privateCandidateBindings.get(candidateEnvelope);
    if (
      candidateEnvelope.state !== "available" ||
      !privateBinding?.query ||
      privateBinding.candidates.size === 0
    ) {
      throw typedError(
        "Body evidence requires an available exact visual candidate envelope",
      );
    }
    const continuity = projectValidatedBodyContinuityForRepository(
      input.continuityEnvelope,
    );
    const base = {
      authority: {
        activation: "none",
        automaticIdentityAuthority: "none",
        persistence: "none",
        recommendation: "none",
        training: "none",
      },
      binding: {
        candidateSetDigest: candidateEnvelope.candidateSetDigest,
        comparisonEvidenceDigest:
          candidateEnvelope.binding.providerConfigDigest &&
          input.continuityEnvelope.binding.comparisonEvidenceDigest,
        queryToken: candidateEnvelope.queryToken,
      },
      boundary: {
        candidateManufacture: "forbidden",
        currentRepositoryRevisionValidation: "performed_at_issue",
        identityProjection: "none",
        repositoryWrites: "none",
      },
      nonRepresentative: true,
      operationalUse: "none",
      schemaVersion: visualCandidateBodyEvidenceSchemaVersion,
    };
    if (
      continuity.decision.state !== "supported" ||
      continuity.edges.length === 0
    ) {
      const core = {
        ...base,
        evidence: [],
        reasons: continuity.decision.reasons,
        state: continuity.decision.state,
      };
      return issueBodyEvidenceEnvelope(core);
    }
    const bodyIds = [
      ...new Set(
        continuity.edges.flatMap((edge) => [edge.leftBodyId, edge.rightBodyId]),
      ),
    ].sort();
    const visibleRank = presentationRank();
    if (
      !Number.isSafeInteger(visibleRank) ||
      visibleRank < 0 ||
      visibleRank > 2
    ) {
      throw typedError("presentation rank is invalid");
    }
    const rows = await sql`
      SELECT current_result.body_id, current_result.asset_id,
        current_result.asset_token, current_result.detector_config_digest,
        current_result.input_revision, current_result.source_content_digest,
        current_result.result_digest, tag.person_id
      FROM current_body_detection_result_observation current_result
      LEFT JOIN current_body_tag tag ON tag.body_id = current_result.body_id
        AND tag.state = 'accepted'
      WHERE current_result.body_id = ANY(${bodyIds}::text[])
        AND cimmich_visibility_asset_rank(current_result.asset_id) <= ${visibleRank}
      ORDER BY current_result.body_id, tag.person_id NULLS FIRST
    `;
    const byBody = new Map();
    for (const row of rows) {
      if (byBody.has(row.body_id)) {
        throw typedError(
          "Body evidence repository lineage is ambiguous",
          "VISUAL_CANDIDATE_SET_REPOSITORY_CONFLICT",
          409,
        );
      }
      byBody.set(row.body_id, row);
    }
    const sideByBody = new Map([
      ...continuity.left.bodyIds.map((bodyId) => [bodyId, continuity.left]),
      ...continuity.right.bodyIds.map((bodyId) => [bodyId, continuity.right]),
    ]);
    for (const bodyId of bodyIds) {
      const row = byBody.get(bodyId);
      const side = sideByBody.get(bodyId);
      if (
        !row ||
        !side ||
        row.asset_token !== side.assetToken ||
        row.detector_config_digest !== side.detectorConfigDigest ||
        row.input_revision !== side.inputRevision ||
        row.source_content_digest !== side.sourceContentDigest ||
        row.result_digest !== side.resultDigest
      ) {
        const core = {
          ...base,
          evidence: [],
          reasons: ["CURRENT_BODY_RESULT_UNAVAILABLE"],
          state: "unavailable",
        };
        return issueBodyEvidenceEnvelope(core);
      }
    }
    const candidateByPerson = new Map(
      [...privateBinding.candidates].map(([candidateToken, { personId }]) => [
        personId,
        candidateToken,
      ]),
    );
    const evidence = [];
    for (const edge of continuity.edges) {
      const left = byBody.get(edge.leftBodyId);
      const right = byBody.get(edge.rightBodyId);
      const leftIsQuery =
        left.asset_id === privateBinding.query.assetId &&
        left.input_revision === privateBinding.query.inputRevision;
      const rightIsQuery =
        right.asset_id === privateBinding.query.assetId &&
        right.input_revision === privateBinding.query.inputRevision;
      if (leftIsQuery === rightIsQuery) {
        continue;
      }
      const reference = leftIsQuery ? right : left;
      const candidateToken = candidateByPerson.get(reference.person_id);
      if (!candidateToken) continue;
      evidence.push({
        candidateToken,
        evidenceDigest: recognitionDigest({
          candidateSetDigest: candidateEnvelope.candidateSetDigest,
          candidateToken,
          continuityEvidenceDigest: edge.evidenceDigest,
          queryToken: candidateEnvelope.queryToken,
        }),
        margin: Math.min(edge.leftMargin, edge.rightMargin),
        score: edge.similarity,
        state: "supported",
      });
    }
    evidence.sort((left, right) =>
      left.candidateToken.localeCompare(right.candidateToken),
    );
    if (
      new Set(evidence.map((row) => row.candidateToken)).size !==
      evidence.length
    ) {
      const core = {
        ...base,
        evidence: [],
        reasons: ["AMBIGUOUS_BODY_ASSIGNMENT"],
        state: "ambiguous",
      };
      return issueBodyEvidenceEnvelope(core);
    }
    const core = {
      ...base,
      evidence,
      reasons: evidence.length
        ? ["CURRENT_UNIQUE_BODY_CONTINUITY_SUPPORTED"]
        : ["CANDIDATE_BODY_ASSOCIATION_UNAVAILABLE"],
      state: evidence.length ? "supported" : "unavailable",
    };
    return issueBodyEvidenceEnvelope(core);
  };

  const loadCaptureContextEvidence = async (input) => {
    exactObject(input, "input", ["candidateEnvelope"]);
    const candidateEnvelope = requireValidatedEnvelope(input.candidateEnvelope);
    const privateBinding = privateCandidateBindings.get(candidateEnvelope);
    if (
      candidateEnvelope.state !== "available" ||
      !privateBinding?.query ||
      privateBinding.candidates.size === 0
    ) {
      throw typedError(
        "Capture evidence requires an available exact visual candidate envelope",
      );
    }
    const visibleRank = presentationRank();
    if (
      !Number.isSafeInteger(visibleRank) ||
      visibleRank < 0 ||
      visibleRank > 2
    ) {
      throw typedError("presentation rank is invalid");
    }
    const base = {
      authority: {
        activation: "none",
        automaticIdentityAuthority: "none",
        persistence: "none",
        recommendation: "none",
        training: "none",
      },
      binding: {
        candidateSetDigest: candidateEnvelope.candidateSetDigest,
        queryRevisionDigest: candidateEnvelope.binding.queryRevisionDigest,
        queryToken: candidateEnvelope.queryToken,
      },
      boundary: {
        candidateManufacture: "forbidden",
        captureContextIdentityAuthority: "none",
        currentRepositoryRevisionValidation: "performed_at_issue",
        identityProjection: "none",
        repositoryWrites: "none",
        visibilityBeforeCount: "enforced",
      },
      nonRepresentative: true,
      operationalUse: "none",
      schemaVersion: visualCandidateCaptureEvidenceSchemaVersion,
    };
    const rows = await sql`
      /* cimmich.visual-candidate-capture-evidence.v1 */
      WITH support_raw AS (
        SELECT context.context_id, context.context_kind,
          context.confidence::float8 AS context_confidence,
          context.created_by, context.decision_id,
          context.start_time, context.end_time,
          query_member.membership_event_id AS query_membership_event_id,
          query_member.actor_kind AS query_actor_kind,
          query_member.confidence::float8 AS query_member_confidence,
          query_member.reason_code AS query_reason_code,
          query_asset.capture_time,
          query_projection.input_revision,
          identity.person_id, identity.identity_claim_id,
          support_member.asset_id AS support_asset_id,
          support_member.membership_event_id AS support_membership_event_id,
          support_projection.input_revision AS support_input_revision,
          face.face_id
        FROM current_capture_context_member query_member
        JOIN capture_context context ON context.context_id = query_member.context_id
          AND context.state = 'active'
        JOIN asset query_asset ON query_asset.asset_id = query_member.asset_id
          AND query_asset.state = 'active'
        JOIN immich_asset_projection query_projection
          ON query_projection.cimmich_asset_id = query_member.asset_id
          AND query_projection.state = 'active'
        JOIN current_capture_context_member support_member
          ON support_member.context_id = query_member.context_id
          AND support_member.asset_id <> query_member.asset_id
        JOIN immich_asset_projection support_projection
          ON support_projection.cimmich_asset_id = support_member.asset_id
          AND support_projection.state = 'active'
        JOIN face_observation face ON face.asset_id = support_member.asset_id
          AND face.state = 'valid'
        JOIN current_face_identity identity ON identity.face_id = face.face_id
          AND identity.state = 'accepted'
        JOIN current_person_review_state review ON review.person_id = identity.person_id
          AND review.matching_authority = 'trusted'
        WHERE query_member.asset_id = ${privateBinding.query.assetId}
          AND query_projection.input_revision = ${privateBinding.query.inputRevision}
          AND cimmich_visibility_asset_rank(query_member.asset_id) <= ${visibleRank}
          AND cimmich_visibility_asset_rank(support_member.asset_id) <= ${visibleRank}
          AND (
            context.created_by <> 'model'
            OR (
              context.confidence >= 0.90
              AND query_member.confidence >= 0.90
              AND context.grouping_features->>'candidateOnly' = 'true'
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM face_observation query_face
            JOIN current_face_identity query_identity
              ON query_identity.face_id = query_face.face_id
              AND query_identity.state = 'accepted'
            WHERE query_face.asset_id = query_member.asset_id
              AND query_face.state = 'valid'
              AND query_identity.person_id = identity.person_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM current_presence_tag presence
            WHERE presence.asset_id = query_member.asset_id
              AND presence.person_id = identity.person_id
              AND presence.state = 'accepted'
          )
      )
      SELECT context_id, context_kind, context_confidence, created_by,
        decision_id, start_time, end_time, query_membership_event_id,
        query_actor_kind, query_member_confidence, query_reason_code,
        capture_time, input_revision, person_id,
        count(DISTINCT support_asset_id)::int AS supporting_asset_count,
        LEAST(
          0.90,
          coalesce(context_confidence, 0.5) *
            (0.45 + 0.1 * count(DISTINCT support_asset_id))
        )::float8 AS candidate_confidence,
        array_agg(DISTINCT support_asset_id ORDER BY support_asset_id)
          AS support_asset_ids,
        array_agg(DISTINCT support_membership_event_id
          ORDER BY support_membership_event_id) AS support_membership_event_ids,
        array_agg(DISTINCT support_input_revision ORDER BY support_input_revision)
          AS support_input_revisions,
        array_agg(DISTINCT face_id ORDER BY face_id) AS support_face_ids,
        array_agg(DISTINCT identity_claim_id ORDER BY identity_claim_id)
          AS support_identity_claim_ids
      FROM support_raw
      GROUP BY context_id, context_kind, context_confidence, created_by,
        decision_id, start_time, end_time, query_membership_event_id,
        query_actor_kind, query_member_confidence, query_reason_code,
        capture_time, input_revision, person_id
      HAVING count(DISTINCT support_asset_id) >= 2
      ORDER BY person_id, context_id
    `;
    if (!Array.isArray(rows)) {
      throw typedError(
        "Capture evidence repository rows are invalid",
        "VISUAL_CANDIDATE_SET_REPOSITORY_CONFLICT",
        409,
      );
    }
    const candidateByPerson = new Map(
      [...privateBinding.candidates].map(([candidateToken, { personId }]) => [
        personId,
        candidateToken,
      ]),
    );
    const evidence = [];
    for (const [index, row] of rows.entries()) {
      const personId = requiredPrivateId(
        row?.person_id,
        `captureRows[${index}].personId`,
      );
      const candidateToken = candidateByPerson.get(personId);
      if (!candidateToken) continue;
      if (row.input_revision !== privateBinding.query.inputRevision) {
        const core = {
          ...base,
          evidence: [],
          reasons: ["CURRENT_CAPTURE_CONTEXT_UNAVAILABLE"],
          state: "unavailable",
        };
        return issueCaptureEvidenceEnvelope(core);
      }
      const contextId = requiredPrivateId(
        row.context_id,
        `captureRows[${index}].contextId`,
      );
      const contextKind = requiredContextKind(row.context_kind);
      const confidence = canonicalUnitScore(
        row.candidate_confidence,
        `captureRows[${index}].candidateConfidence`,
      );
      const supportingAssetCount = Number(row.supporting_asset_count);
      if (
        !Number.isSafeInteger(supportingAssetCount) ||
        supportingAssetCount < 2 ||
        supportingAssetCount > 200
      ) {
        throw typedError(
          "Capture evidence supporting count is invalid",
          "VISUAL_CANDIDATE_SET_REPOSITORY_CONFLICT",
          409,
        );
      }
      const supportAssetIds = requiredPrivateIdList(
        row.support_asset_ids,
        `captureRows[${index}].supportAssetIds`,
      );
      if (supportAssetIds.length !== supportingAssetCount) {
        throw typedError(
          "Capture evidence support count conflicts with visible support assets",
          "VISUAL_CANDIDATE_SET_REPOSITORY_CONFLICT",
          409,
        );
      }
      const supportMembershipEventIds = requiredPrivateIdList(
        row.support_membership_event_ids,
        `captureRows[${index}].supportMembershipEventIds`,
      );
      const supportInputRevisions = requiredDigestList(
        row.support_input_revisions,
        `captureRows[${index}].supportInputRevisions`,
      );
      const supportFaceIds = requiredPrivateIdList(
        row.support_face_ids,
        `captureRows[${index}].supportFaceIds`,
      );
      const supportIdentityClaimIds = requiredPrivateIdList(
        row.support_identity_claim_ids,
        `captureRows[${index}].supportIdentityClaimIds`,
      );
      const queryMembershipEventId = requiredPrivateId(
        row.query_membership_event_id,
        `captureRows[${index}].queryMembershipEventId`,
      );
      const contextConfidence =
        row.context_confidence == null
          ? null
          : canonicalUnitScore(
              row.context_confidence,
              `captureRows[${index}].contextConfidence`,
            );
      const queryMemberConfidence =
        row.query_member_confidence == null
          ? null
          : canonicalUnitScore(
              row.query_member_confidence,
              `captureRows[${index}].queryMemberConfidence`,
            );
      const userVerified =
        row.created_by === "user" &&
        row.query_actor_kind === "user" &&
        row.query_reason_code === "explicit_capture_context" &&
        row.decision_id != null;
      const decisionId =
        row.decision_id == null
          ? null
          : requiredPrivateId(
              row.decision_id,
              `captureRows[${index}].decisionId`,
            );
      const captureTime = optionalTimestamp(
        row.capture_time,
        `captureRows[${index}].captureTime`,
      );
      const startTime = optionalTimestamp(
        row.start_time,
        `captureRows[${index}].startTime`,
      );
      const endTime = optionalTimestamp(
        row.end_time,
        `captureRows[${index}].endTime`,
      );
      const metadataVerified =
        userVerified &&
        captureTime != null &&
        startTime != null &&
        endTime != null;
      const errorSeconds = metadataVerified
        ? Math.ceil(
            captureTime < startTime
              ? (startTime - captureTime) / 1000
              : captureTime > endTime
                ? (captureTime - endTime) / 1000
                : 0,
          )
        : 0;
      const lineage = {
        candidateSetDigest: candidateEnvelope.candidateSetDigest,
        candidateToken,
        contextConfidence,
        contextId,
        contextKind,
        decisionId,
        queryMemberConfidence,
        queryMembershipEventId,
        queryRevisionDigest: candidateEnvelope.binding.queryRevisionDigest,
        queryToken: candidateEnvelope.queryToken,
        supportAssetIds,
        supportFaceIds,
        supportIdentityClaimIds,
        supportInputRevisions,
        supportMembershipEventIds,
      };
      evidence.push({
        candidateToken,
        captureContext: {
          coappearance: "supporting",
          confidence,
          contextKind,
          evidenceDigest: recognitionDigest({ ...lineage, family: "capture" }),
          reliability: userVerified ? "verified" : "suspect",
          state: "supported",
          time: metadataVerified ? "supporting" : "unavailable",
        },
        metadata: {
          errorSeconds,
          evidenceDigest: recognitionDigest({
            ...lineage,
            captureTime,
            endTime,
            family: "metadata",
            startTime,
          }),
          reliability: metadataVerified ? "verified" : "unavailable",
        },
      });
    }
    evidence.sort((left, right) =>
      left.candidateToken.localeCompare(right.candidateToken),
    );
    if (
      new Set(evidence.map((row) => row.candidateToken)).size !==
      evidence.length
    ) {
      const core = {
        ...base,
        evidence: [],
        reasons: ["AMBIGUOUS_CAPTURE_CONTEXT"],
        state: "ambiguous",
      };
      return issueCaptureEvidenceEnvelope(core);
    }
    const core = {
      ...base,
      evidence,
      reasons: evidence.length
        ? ["CURRENT_VISIBLE_CAPTURE_CONTEXT_SUPPORTED"]
        : ["CANDIDATE_CAPTURE_CONTEXT_UNAVAILABLE"],
      state: evidence.length ? "supported" : "unavailable",
    };
    return issueCaptureEvidenceEnvelope(core);
  };

  const loadSamePhotoEvidence = async (input) => {
    exactObject(input, "input", ["candidateEnvelope"]);
    const candidateEnvelope = requireValidatedEnvelope(input.candidateEnvelope);
    const privateBinding = privateCandidateBindings.get(candidateEnvelope);
    if (
      candidateEnvelope.state !== "available" ||
      !privateBinding?.query ||
      privateBinding.candidates.size === 0
    ) {
      throw typedError(
        "Same-photo evidence requires an available exact visual candidate envelope",
      );
    }
    const visibleRank = presentationRank();
    if (
      !Number.isSafeInteger(visibleRank) ||
      visibleRank < 0 ||
      visibleRank > 2
    ) {
      throw typedError("presentation rank is invalid");
    }
    const base = {
      authority: {
        activation: "none",
        automaticIdentityAuthority: "none",
        persistence: "none",
        recommendation: "none",
        training: "none",
      },
      binding: {
        candidateSetDigest: candidateEnvelope.candidateSetDigest,
        queryRevisionDigest: candidateEnvelope.binding.queryRevisionDigest,
        queryToken: candidateEnvelope.queryToken,
      },
      boundary: {
        candidateManufacture: "forbidden",
        currentRepositoryRevisionValidation: "performed_at_issue",
        identityProjection: "none",
        repositoryWrites: "none",
        samePhotoAuthority: "suppress_only",
        visibilityBeforeProjection: "enforced",
      },
      nonRepresentative: true,
      operationalUse: "none",
      schemaVersion: visualCandidateSamePhotoEvidenceSchemaVersion,
    };
    const rows = await sql`
      /* cimmich.visual-candidate-same-photo-evidence.v1 */
      WITH current_query AS (
        SELECT projection.input_revision
        FROM immich_asset_projection projection
        JOIN asset query_asset ON query_asset.asset_id = projection.cimmich_asset_id
          AND query_asset.state = 'active'
        WHERE projection.cimmich_asset_id = ${privateBinding.query.assetId}
          AND projection.state = 'active'
          AND cimmich_visibility_asset_rank(projection.cimmich_asset_id) <= ${visibleRank}
      )
      SELECT current_query.input_revision, association.person_id,
        association.association_type, association.geometry_id
      FROM current_query
      LEFT JOIN asset_people association
        ON association.asset_id = ${privateBinding.query.assetId}
        AND association.authority_state = 'accepted'
      ORDER BY association.person_id, association.association_type,
        association.geometry_id NULLS FIRST
    `;
    if (!Array.isArray(rows) || rows.length === 0) {
      const core = {
        ...base,
        evidence: [],
        reasons: ["CURRENT_QUERY_REVISION_UNAVAILABLE"],
        state: "unavailable",
      };
      return issueSamePhotoEvidenceEnvelope(core);
    }
    if (
      rows.some(
        (row) => row.input_revision !== privateBinding.query.inputRevision,
      )
    ) {
      const core = {
        ...base,
        evidence: [],
        reasons: ["CURRENT_QUERY_REVISION_UNAVAILABLE"],
        state: "unavailable",
      };
      return issueSamePhotoEvidenceEnvelope(core);
    }
    const candidateByPerson = new Map(
      [...privateBinding.candidates].map(([candidateToken, { personId }]) => [
        personId,
        candidateToken,
      ]),
    );
    const associationsByCandidate = new Map();
    for (const [index, row] of rows.entries()) {
      if (row.person_id == null) continue;
      const personId = requiredPrivateId(
        row.person_id,
        `samePhotoRows[${index}].personId`,
      );
      const candidateToken = candidateByPerson.get(personId);
      if (!candidateToken) continue;
      const associationType = requiredAssociationType(row.association_type);
      const geometryId =
        row.geometry_id == null
          ? null
          : requiredPrivateId(
              row.geometry_id,
              `samePhotoRows[${index}].geometryId`,
            );
      const associations = associationsByCandidate.get(candidateToken) || [];
      const associationKey = `${associationType}:${geometryId || "none"}`;
      if (associations.some((item) => item.key === associationKey)) {
        throw typedError(
          "Same-photo repository evidence is duplicated",
          "VISUAL_CANDIDATE_SET_REPOSITORY_CONFLICT",
          409,
        );
      }
      associations.push({
        associationType,
        geometryId,
        key: associationKey,
      });
      associationsByCandidate.set(candidateToken, associations);
    }
    const evidence = [...associationsByCandidate]
      .map(([candidateToken, associations]) => {
        const canonicalAssociations = associations
          .map(({ associationType, geometryId }) => ({
            associationType,
            geometryId,
          }))
          .sort(
            (left, right) =>
              left.associationType.localeCompare(right.associationType) ||
              (left.geometryId || "").localeCompare(right.geometryId || ""),
          );
        return {
          candidateToken,
          samePhoto: {
            evidenceDigest: recognitionDigest({
              associations: canonicalAssociations,
              candidateSetDigest: candidateEnvelope.candidateSetDigest,
              candidateToken,
              inputRevision: privateBinding.query.inputRevision,
              queryToken: candidateEnvelope.queryToken,
            }),
            state: "accepted_present",
          },
        };
      })
      .sort((left, right) =>
        left.candidateToken.localeCompare(right.candidateToken),
      );
    const core = {
      ...base,
      evidence,
      reasons: evidence.length
        ? ["CURRENT_ACCEPTED_SAME_PHOTO_TRUTH"]
        : ["NO_ACCEPTED_SAME_PHOTO_TRUTH"],
      state: "available",
    };
    return issueSamePhotoEvidenceEnvelope(core);
  };

  const routeProviderConditionsWithMode = async (input, mode) => {
    exactObject(input, "input", ["candidateEnvelope"]);
    const candidateEnvelope = requireValidatedEnvelope(input.candidateEnvelope);
    const privateBinding = privateCandidateBindings.get(candidateEnvelope);
    if (
      candidateEnvelope.state !== "available" ||
      candidateEnvelope.candidates.length < 2 ||
      !privateBinding?.query ||
      privateBinding.candidates.size < 2
    ) {
      throw typedError(
        "Provider condition routing requires an available exact Prime top two",
      );
    }
    const visibleRank = presentationRank();
    if (
      !Number.isSafeInteger(visibleRank) ||
      visibleRank < 0 ||
      visibleRank > 2
    ) {
      throw typedError("presentation rank is invalid");
    }
    const binding = privateBinding.query;
    const qualityRows = await sql`
      /* cimmich.provider-condition-current-quality.v1 */
      SELECT face.face_id, face.asset_id, provider.input_revision,
        embedding.embedding_id, embedding.vector_digest,
        pack.pack_id, pack.pack_digest,
        round(face.detection_confidence, 6)::float8 AS detection_confidence,
        round((face.box_w * face.box_h)::numeric, 6)::float8 AS face_area_ratio,
        round(nullif(face.quality_measurements->>'frontal_score', '')::numeric, 6)::float8 AS frontal_score,
        round(nullif(face.quality_measurements->>'quality_score', '')::numeric, 6)::float8 AS quality_score
      FROM face_observation face
      JOIN asset query_asset ON query_asset.asset_id = face.asset_id
        AND query_asset.state = 'active'
      JOIN face_embedding embedding ON embedding.face_id = face.face_id
        AND embedding.embedding_id = ${binding.embeddingId}
        AND embedding.state = 'active'
        AND embedding.config_digest = ${binding.providerConfigDigest}
        AND embedding.vector_digest = ${binding.vectorDigest}
      JOIN LATERAL (
        SELECT pipeline.input_revision
        FROM media_pipeline_run pipeline
        JOIN media_job job ON job.job_id = pipeline.recognition_job_id
          AND job.state = 'completed'
          AND job.result_receipt_id = embedding.producer_receipt_id
        JOIN current_asset_source_revision revision
          ON revision.revision_id = pipeline.source_revision_id
          AND revision.asset_id = pipeline.asset_id
          AND revision.input_revision = pipeline.input_revision
          AND revision.source_content_digest = pipeline.source_content_digest
        WHERE pipeline.asset_id = face.asset_id
          AND pipeline.run_kind = 'existing_observation_set'
          AND pipeline.input_revision = ${binding.inputRevision}
          AND pipeline.recognizer_config_digest = embedding.config_digest
          AND pipeline.state = 'recognized'
        UNION
        SELECT pipeline.input_revision
        FROM media_pipeline_run pipeline
        JOIN media_job job ON job.job_id = pipeline.recognition_job_id
          AND job.state = 'completed'
          AND job.result_receipt_id = embedding.producer_receipt_id
        JOIN face_detection_result result
          ON result.detection_result_id = pipeline.detection_result_id
          AND result.asset_id = pipeline.asset_id
          AND result.source_content_digest = pipeline.source_content_digest
        JOIN face_detection_result_observation observation
          ON observation.detection_result_id = result.detection_result_id
          AND observation.face_id = face.face_id
        JOIN immich_asset_projection projection
          ON projection.cimmich_asset_id = pipeline.asset_id
          AND projection.input_revision = pipeline.input_revision
          AND projection.state = 'active'
        WHERE pipeline.asset_id = face.asset_id
          AND pipeline.run_kind = 'detector_result'
          AND pipeline.input_revision = ${binding.inputRevision}
          AND pipeline.recognizer_config_digest = embedding.config_digest
          AND pipeline.state = 'recognized'
        UNION
        SELECT evidence.input_revision
        FROM current_manual_face_matching_evidence evidence
        WHERE evidence.face_id = face.face_id
          AND evidence.embedding_id = embedding.embedding_id
          AND evidence.config_digest = embedding.config_digest
          AND evidence.vector_digest = embedding.vector_digest
          AND evidence.input_revision = ${binding.inputRevision}
      ) provider ON true
      JOIN source_pack pack ON pack.pack_id = ${binding.packId}
        AND pack.pack_digest = ${binding.packDigest}
        AND pack.state = 'active' AND pack.evaluation_status = 'passed'
        AND pack.model_family = ${binding.modelFamily}
        AND pack.model_version = ${binding.modelVersion}
        AND pack.config_digest = ${binding.providerConfigDigest}
        AND pack.dimension = ${binding.dimension}
      WHERE face.face_id = ${binding.faceId} AND face.state = 'valid'
        AND cimmich_visibility_asset_rank(face.asset_id) <= ${visibleRank}
      ORDER BY face.face_id
    `;
    if (qualityRows.length !== 1) {
      throw typedError(
        "Current query quality lineage is unavailable or ambiguous",
        "VISUAL_CANDIDATE_SET_BINDING_CONFLICT",
        409,
      );
    }
    const quality = qualityRows[0];
    if (
      quality.face_id !== binding.faceId ||
      quality.asset_id !== binding.assetId ||
      quality.input_revision !== binding.inputRevision ||
      quality.embedding_id !== binding.embeddingId ||
      quality.vector_digest !== binding.vectorDigest ||
      quality.pack_id !== binding.packId ||
      quality.pack_digest !== binding.packDigest
    ) {
      throw typedError(
        "Current query quality lineage drifted after candidate issue",
        "VISUAL_CANDIDATE_SET_BINDING_CONFLICT",
        409,
      );
    }
    const topTwoTokens = candidateEnvelope.candidates
      .slice(0, 2)
      .map(({ candidateToken }) => candidateToken);
    const candidateByPerson = new Map(
      topTwoTokens.map((candidateToken) => [
        privateBinding.candidates.get(candidateToken)?.personId,
        candidateToken,
      ]),
    );
    if (candidateByPerson.has(undefined) || candidateByPerson.size !== 2) {
      throw typedError(
        "Prime top-two repository identity binding is unavailable",
      );
    }
    const candidatePersonIds = [...candidateByPerson.keys()].sort();
    const conditionRows = await sql`
      /* cimmich.provider-condition-reference-evidence.v1 */
      WITH query AS (
        SELECT face.asset_id, embedding.embedding
        FROM face_observation face
        JOIN face_embedding embedding ON embedding.face_id = face.face_id
          AND embedding.embedding_id = ${binding.embeddingId}
          AND embedding.state = 'active'
          AND embedding.config_digest = ${binding.providerConfigDigest}
          AND embedding.vector_digest = ${binding.vectorDigest}
        WHERE face.face_id = ${binding.faceId} AND face.state = 'valid'
          AND cimmich_visibility_asset_rank(face.asset_id) <= ${visibleRank}
      ), query_context AS (
        SELECT context_id FROM current_face_capture_context
        WHERE face_id = ${binding.faceId}
      )
      SELECT reference.person_id, reference.bucket_kind,
        reference.reference_id, reference.face_id,
        reference_face.asset_id,
        (1 - (reference.embedding <=> query.embedding))::float8 AS score
      FROM query
      JOIN source_pack_reference reference
        ON reference.pack_id = ${binding.packId}
        AND reference.person_id = ANY(${candidatePersonIds}::text[])
        AND reference.reference_kind = 'face'
        AND (
          (reference.bucket_kind = 'secondary' AND reference.routing_state <> 'disabled')
          OR
          (reference.bucket_kind = 'lq' AND reference.routing_state = 'condition_only')
        )
        AND reference.model_family = ${binding.modelFamily}
        AND reference.model_version = ${binding.modelVersion}
        AND reference.config_digest = ${binding.providerConfigDigest}
        AND reference.dimension = ${binding.dimension}
      JOIN face_observation reference_face
        ON reference_face.face_id = reference.face_id
        AND reference_face.state = 'valid'
      WHERE reference_face.asset_id <> query.asset_id
        AND cimmich_visibility_asset_rank(reference_face.asset_id) <= ${visibleRank}
        AND NOT EXISTS (
          SELECT 1 FROM current_face_capture_context context
          WHERE context.face_id = reference.face_id
            AND context.context_id IN (SELECT context_id FROM query_context)
        )
      ORDER BY reference.person_id, reference.bucket_kind,
        score DESC, reference.reference_id
    `;
    if (!Array.isArray(conditionRows) || conditionRows.length > 4096) {
      throw typedError("Provider condition repository evidence is unbounded");
    }
    const evidenceByToken = new Map(
      topTwoTokens.map((candidateToken) => [
        candidateToken,
        { lq: [], secondary: [] },
      ]),
    );
    const seenReferences = new Set();
    for (const [index, row] of conditionRows.entries()) {
      const candidateToken = candidateByPerson.get(row?.person_id);
      if (!candidateToken || !["lq", "secondary"].includes(row?.bucket_kind)) {
        throw typedError(
          "Provider condition repository returned out-of-frontier evidence",
          "VISUAL_CANDIDATE_SET_REPOSITORY_CONFLICT",
          409,
        );
      }
      const referenceId = requiredPrivateId(
        row.reference_id,
        `conditionRows[${index}].referenceId`,
      );
      const referenceKey = `${row.bucket_kind}:${referenceId}`;
      if (seenReferences.has(referenceKey)) {
        throw typedError(
          "Provider condition repository evidence is duplicated",
          "VISUAL_CANDIDATE_SET_REPOSITORY_CONFLICT",
          409,
        );
      }
      seenReferences.add(referenceKey);
      evidenceByToken.get(candidateToken)[row.bucket_kind].push({
        assetId: requiredPrivateId(
          row.asset_id,
          `conditionRows[${index}].assetId`,
        ),
        faceId: requiredPrivateId(
          row.face_id,
          `conditionRows[${index}].faceId`,
        ),
        referenceId,
        score: canonicalScore(row.score, `conditionRows[${index}].score`),
      });
    }
    const familyEvidence = (rows) => {
      if (rows.length === 0) return { evidenceDigest: null, score: null };
      rows.sort(
        (left, right) =>
          right.score - left.score ||
          left.referenceId.localeCompare(right.referenceId),
      );
      return {
        evidenceDigest: recognitionDigest(rows),
        score: rows[0].score,
      };
    };
    const conditionEvidence = topTwoTokens.map((candidateToken) => {
      const evidence = evidenceByToken.get(candidateToken);
      const secondary = familyEvidence(evidence.secondary);
      const lowQuality = familyEvidence(evidence.lq);
      return {
        candidateToken,
        lowQualityEvidenceDigest: lowQuality.evidenceDigest,
        lowQualityScore: lowQuality.score,
        secondaryEvidenceDigest: secondary.evidenceDigest,
        secondaryScore: secondary.score,
      };
    });
    const {
      classifyFaceCondition,
      faceConditionClassifierSchemaVersion,
      waveOneFaceConditionPolicyV1,
    } = await import("./face-condition-classifier.mjs");
    const {
      prepareProviderConditionConsensusEvidence,
      prepareProviderConditionEvidence,
      providerConditionConsensusPolicyV1,
      providerConditionConsensusRouterSchemaVersion,
      providerConditionRouterSchemaVersion,
      providerConditionTopTwoPolicyV1,
      resolveProviderConditionConsensusEvidence,
      resolveProviderConditionEvidence,
    } = await import("./provider-condition-router.mjs");
    const numberOrNull = (value, label) =>
      value == null ? null : canonicalUnitScore(value, label);
    const classification = classifyFaceCondition({
      observation: {
        detectionConfidence: numberOrNull(
          quality.detection_confidence,
          "quality.detectionConfidence",
        ),
        faceAreaRatio: canonicalUnitScore(
          quality.face_area_ratio,
          "quality.faceAreaRatio",
        ),
        frontalScore: numberOrNull(
          quality.frontal_score,
          "quality.frontalScore",
        ),
        qualityScore: numberOrNull(
          quality.quality_score,
          "quality.qualityScore",
        ),
      },
      policy: waveOneFaceConditionPolicyV1,
      queryRevisionDigest: candidateEnvelope.binding.queryRevisionDigest,
      schemaVersion: faceConditionClassifierSchemaVersion,
    });
    const consensus = mode === "consensus";
    const prepared = (
      consensus
        ? prepareProviderConditionConsensusEvidence
        : prepareProviderConditionEvidence
    )({
      candidateEnvelope,
      conditionEvidence,
      policy: consensus
        ? providerConditionConsensusPolicyV1
        : providerConditionTopTwoPolicyV1,
      qualityClassification: classification,
      schemaVersion: consensus
        ? providerConditionConsensusRouterSchemaVersion
        : providerConditionRouterSchemaVersion,
    });
    const result = (
      consensus
        ? resolveProviderConditionConsensusEvidence
        : resolveProviderConditionEvidence
    )(prepared);
    if (consensus) {
      const proposed = privateBinding.candidates.get(
        result.proposedCandidateToken,
      );
      if (!proposed) {
        throw typedError(
          "Condition consensus resolved outside the exact candidate set",
          "VISUAL_CANDIDATE_SET_REPOSITORY_CONFLICT",
          409,
        );
      }
      privateConditionReviewSuggestions.set(
        result,
        deepFreeze({
          candidates: candidateEnvelope.candidates.map((candidate, index) => ({
            personId: privateBinding.candidates.get(candidate.candidateToken)
              .personId,
            rank: index + 1,
            visualScore: candidate.visualScore,
          })),
          faceId: privateBinding.query.faceId,
          personId: proposed.personId,
        }),
      );
    }
    return result;
  };

  const routeAllTrustedShortlist = async (input) => {
    try {
      requiredPrivateId(
        allTrustedShortlistFrozenSourcePackId,
        "allTrustedShortlistFrozenSourcePackId",
      );
      requiredDigest(
        allTrustedShortlistEvaluationReceiptDigest,
        "allTrustedShortlistEvaluationReceiptDigest",
      );
    } catch {
      throw typedError(
        "All-trusted shortlist evaluation authority is not configured",
        "VISUAL_CANDIDATE_SET_BINDING_CONFLICT",
        409,
      );
    }
    exactObject(input, "input", ["candidateEnvelope"]);
    const candidateEnvelope = requireValidatedEnvelope(input.candidateEnvelope);
    const privateBinding = privateCandidateBindings.get(candidateEnvelope);
    if (
      candidateEnvelope.state !== "available" ||
      candidateEnvelope.candidates.length < 3 ||
      !privateBinding?.query ||
      privateBinding.candidates.size < 3
    ) {
      throw typedError(
        "All-trusted shortlist routing requires a bounded Prime frontier",
      );
    }
    const visibleRank = presentationRank();
    if (
      !Number.isSafeInteger(visibleRank) ||
      visibleRank < 0 ||
      visibleRank > 2
    ) {
      throw typedError("presentation rank is invalid");
    }
    const binding = privateBinding.query;
    const qualityRows = await sql`
      /* cimmich.all-trusted-shortlist-current-quality.v1 */
      SELECT face.face_id, face.asset_id, provider.input_revision,
        embedding.embedding_id, embedding.vector_digest,
        pack.pack_id, pack.pack_digest,
        round(face.detection_confidence, 6)::float8 AS detection_confidence,
        round((face.box_w * face.box_h)::numeric, 6)::float8 AS face_area_ratio,
        round(nullif(face.quality_measurements->>'frontal_score', '')::numeric, 6)::float8 AS frontal_score,
        round(nullif(face.quality_measurements->>'quality_score', '')::numeric, 6)::float8 AS quality_score
      FROM face_observation face
      JOIN asset query_asset ON query_asset.asset_id = face.asset_id
        AND query_asset.state = 'active'
      JOIN face_embedding embedding ON embedding.face_id = face.face_id
        AND embedding.embedding_id = ${binding.embeddingId}
        AND embedding.state = 'active'
        AND embedding.config_digest = ${binding.providerConfigDigest}
        AND embedding.vector_digest = ${binding.vectorDigest}
      JOIN LATERAL (
        SELECT pipeline.input_revision
        FROM media_pipeline_run pipeline
        JOIN media_job job ON job.job_id = pipeline.recognition_job_id
          AND job.state = 'completed'
          AND job.result_receipt_id = embedding.producer_receipt_id
        JOIN media_pipeline_run_observation observation
          ON observation.pipeline_run_id = pipeline.pipeline_run_id
          AND observation.face_id = face.face_id
        JOIN current_asset_source_revision revision
          ON revision.revision_id = pipeline.source_revision_id
          AND revision.asset_id = pipeline.asset_id
          AND revision.input_revision = pipeline.input_revision
          AND revision.source_content_digest = pipeline.source_content_digest
        WHERE pipeline.asset_id = face.asset_id
          AND pipeline.run_kind = 'existing_observation_set'
          AND pipeline.input_revision = ${binding.inputRevision}
          AND pipeline.recognizer_config_digest = embedding.config_digest
          AND pipeline.state = 'recognized'
        UNION
        SELECT pipeline.input_revision
        FROM media_pipeline_run pipeline
        JOIN media_job job ON job.job_id = pipeline.recognition_job_id
          AND job.state = 'completed'
          AND job.result_receipt_id = embedding.producer_receipt_id
        JOIN face_detection_result result
          ON result.detection_result_id = pipeline.detection_result_id
          AND result.asset_id = pipeline.asset_id
          AND result.source_content_digest = pipeline.source_content_digest
        JOIN face_detection_result_observation observation
          ON observation.detection_result_id = result.detection_result_id
          AND observation.face_id = face.face_id
        JOIN immich_asset_projection projection
          ON projection.cimmich_asset_id = pipeline.asset_id
          AND projection.input_revision = pipeline.input_revision
          AND projection.state = 'active'
        WHERE pipeline.asset_id = face.asset_id
          AND pipeline.run_kind = 'detector_result'
          AND pipeline.input_revision = ${binding.inputRevision}
          AND pipeline.recognizer_config_digest = embedding.config_digest
          AND pipeline.state = 'recognized'
        UNION
        SELECT evidence.input_revision
        FROM current_manual_face_matching_evidence evidence
        WHERE evidence.face_id = face.face_id
          AND evidence.embedding_id = embedding.embedding_id
          AND evidence.config_digest = embedding.config_digest
          AND evidence.vector_digest = embedding.vector_digest
          AND evidence.input_revision = ${binding.inputRevision}
      ) provider ON true
      JOIN source_pack pack ON pack.pack_id = ${binding.packId}
        AND pack.pack_digest = ${binding.packDigest}
        AND pack.state = 'active' AND pack.evaluation_status = 'passed'
        AND pack.model_family = ${binding.modelFamily}
        AND pack.model_version = ${binding.modelVersion}
        AND pack.config_digest = ${binding.providerConfigDigest}
        AND pack.dimension = ${binding.dimension}
      WHERE face.face_id = ${binding.faceId} AND face.state = 'valid'
        AND cimmich_visibility_asset_rank(face.asset_id) <= ${visibleRank}
      ORDER BY face.face_id
    `;
    if (qualityRows.length !== 1) {
      throw typedError(
        "Current shortlist query lineage is unavailable or ambiguous",
        "VISUAL_CANDIDATE_SET_BINDING_CONFLICT",
        409,
      );
    }
    const quality = qualityRows[0];
    if (
      quality.face_id !== binding.faceId ||
      quality.asset_id !== binding.assetId ||
      quality.input_revision !== binding.inputRevision ||
      quality.embedding_id !== binding.embeddingId ||
      quality.vector_digest !== binding.vectorDigest ||
      quality.pack_id !== binding.packId ||
      quality.pack_digest !== binding.packDigest
    ) {
      throw typedError(
        "Current shortlist query lineage drifted after candidate issue",
        "VISUAL_CANDIDATE_SET_BINDING_CONFLICT",
        409,
      );
    }
    const candidateByPerson = new Map(
      [...privateBinding.candidates].map(([candidateToken, { personId }]) => [
        personId,
        candidateToken,
      ]),
    );
    const scoutRows = await sql`
      /* cimmich.all-trusted-shortlist-reference-evidence.v1 */
      WITH query AS (
        SELECT face.asset_id, embedding.embedding
        FROM face_observation face
        JOIN face_embedding embedding ON embedding.face_id = face.face_id
          AND embedding.embedding_id = ${binding.embeddingId}
          AND embedding.state = 'active'
          AND embedding.config_digest = ${binding.providerConfigDigest}
          AND embedding.vector_digest = ${binding.vectorDigest}
        WHERE face.face_id = ${binding.faceId} AND face.state = 'valid'
          AND cimmich_visibility_asset_rank(face.asset_id) <= ${visibleRank}
      ), query_context AS (
        SELECT context_id FROM current_face_capture_context
        WHERE face_id = ${binding.faceId}
      ), evidence_raw AS (
        SELECT identity.person_id, identity.identity_claim_id,
          subject.display_name, reference_face.face_id,
          reference_face.asset_id, reference_embedding.vector_digest,
          reference_receipt.result_digest AS producer_result_digest,
          coalesce((
            SELECT 'context:' || min(context.context_id)
            FROM current_face_capture_context context
            WHERE context.face_id = reference_face.face_id
          ), 'asset:' || reference_face.asset_id) AS evidence_unit,
          (1 - (reference_embedding.embedding <=> query.embedding))::float8 AS score
        FROM query
        JOIN current_face_identity identity ON identity.state = 'accepted'
        JOIN identity_claim claim
          ON claim.identity_claim_id = identity.identity_claim_id
        LEFT JOIN decision identity_decision
          ON identity_decision.decision_id = claim.decision_id
        JOIN current_person subject ON subject.person_id = identity.person_id
          AND subject.status = 'active' AND subject.subject_kind = 'person'
        JOIN face_observation reference_face
          ON reference_face.face_id = identity.face_id
          AND reference_face.state = 'valid'
          AND reference_face.asset_id <> query.asset_id
        JOIN asset reference_asset ON reference_asset.asset_id = reference_face.asset_id
          AND reference_asset.state = 'active'
        JOIN face_embedding reference_embedding
          ON reference_embedding.face_id = reference_face.face_id
          AND reference_embedding.state = 'active'
          AND reference_embedding.model_family = ${binding.modelFamily}
          AND reference_embedding.model_version = ${binding.modelVersion}
          AND reference_embedding.config_digest = ${binding.providerConfigDigest}
          AND reference_embedding.dimension = ${binding.dimension}
        JOIN producer_receipt reference_receipt
          ON reference_receipt.producer_receipt_id = reference_embedding.producer_receipt_id
          AND reference_receipt.completed_at IS NOT NULL
          AND reference_receipt.result_digest ~ '^[0-9a-f]{64}$'
        JOIN source_pack governed_pack ON governed_pack.pack_id = ${binding.packId}
          AND governed_pack.pack_digest = ${binding.packDigest}
          AND governed_pack.source_revision_digest = ${binding.sourceRevisionDigest}
          AND governed_pack.state = 'active'
          AND governed_pack.evaluation_status = 'passed'
          AND governed_pack.model_family = reference_embedding.model_family
          AND governed_pack.model_version = reference_embedding.model_version
          AND governed_pack.config_digest = reference_embedding.config_digest
          AND governed_pack.dimension = reference_embedding.dimension
        JOIN source_pack evaluated_pack
          ON evaluated_pack.pack_id = ${allTrustedShortlistFrozenSourcePackId}
          AND evaluated_pack.source_revision_digest = governed_pack.source_revision_digest
          AND evaluated_pack.model_family = governed_pack.model_family
          AND evaluated_pack.model_version = governed_pack.model_version
          AND evaluated_pack.config_digest = governed_pack.config_digest
          AND evaluated_pack.dimension = governed_pack.dimension
        JOIN source_pack_evaluation shortlist_evaluation
          ON shortlist_evaluation.pack_id = evaluated_pack.pack_id
          AND shortlist_evaluation.status = 'passed'
        JOIN producer_receipt shortlist_receipt
          ON shortlist_receipt.producer_receipt_id = shortlist_evaluation.producer_receipt_id
          AND shortlist_receipt.producer_kind = 'system'
          AND shortlist_receipt.producer_name = 'cimmich-all-trusted-shortlist-gate'
          AND shortlist_receipt.producer_version = 'v1'
          AND shortlist_receipt.completed_at IS NOT NULL
          AND shortlist_receipt.result_digest = ${allTrustedShortlistEvaluationReceiptDigest}
          AND shortlist_evaluation.metrics->>'receiptDigest' = shortlist_receipt.result_digest
          AND shortlist_evaluation.metrics->>'schemaVersion' = 'cimmich.all-trusted-shortlist-scout-evaluation.v1'
        LEFT JOIN current_manual_face_matching_evidence manual_evidence
          ON manual_evidence.face_id = reference_face.face_id
          AND manual_evidence.identity_claim_id = identity.identity_claim_id
          AND manual_evidence.embedding_id = reference_embedding.embedding_id
          AND manual_evidence.config_digest = reference_embedding.config_digest
          AND manual_evidence.vector_digest = reference_embedding.vector_digest
        WHERE (identity.origin IN ('trusted_import','user')
            OR identity_decision.actor_kind = 'user')
          AND reference_asset.capture_time IS NOT NULL
          AND reference_asset.capture_time <= governed_pack.evidence_cutoff
          AND (reference_face.observation_origin <> 'manual_user'
            OR manual_evidence.recognition_evidence_id IS NOT NULL)
          AND NOT EXISTS (
            SELECT 1 FROM (
              (SELECT reference_id, vector_digest
                FROM source_pack_reference
                WHERE pack_id = governed_pack.pack_id
                  AND bucket_kind = 'prime' AND reference_kind = 'face'
                EXCEPT
                SELECT reference_id, vector_digest
                FROM source_pack_reference
                WHERE pack_id = evaluated_pack.pack_id
                  AND bucket_kind = 'prime' AND reference_kind = 'face')
              UNION ALL
              (SELECT reference_id, vector_digest
                FROM source_pack_reference
                WHERE pack_id = evaluated_pack.pack_id
                  AND bucket_kind = 'prime' AND reference_kind = 'face'
                EXCEPT
                SELECT reference_id, vector_digest
                FROM source_pack_reference
                WHERE pack_id = governed_pack.pack_id
                  AND bucket_kind = 'prime' AND reference_kind = 'face')
            ) prime_baseline_drift
          )
          AND NOT EXISTS (
            SELECT 1 FROM current_person_category category
            WHERE category.person_id = identity.person_id
              AND category.slug = 'holding'
          )
          AND cimmich_visibility_asset_rank(reference_face.asset_id) <= ${visibleRank}
          AND NOT EXISTS (
            SELECT 1 FROM current_face_capture_context context
            WHERE context.face_id = reference_face.face_id
              AND context.context_id IN (SELECT context_id FROM query_context)
          )
      ), evidence AS (
        SELECT DISTINCT ON (person_id, evidence_unit)
          person_id, identity_claim_id, display_name, evidence_unit, score,
          face_id, asset_id, vector_digest, producer_result_digest
        FROM evidence_raw
        ORDER BY person_id, evidence_unit, score DESC, face_id
      ), ranked AS (
        SELECT *, row_number() OVER (
          PARTITION BY person_id ORDER BY score DESC, evidence_unit
        ) AS evidence_rank
        FROM evidence
      )
      SELECT person_id, identity_claim_id, display_name, face_id, asset_id,
        vector_digest, producer_result_digest, score
      FROM ranked
      WHERE evidence_rank = 1
      ORDER BY score DESC, person_id
      LIMIT 2
    `;
    if (!Array.isArray(scoutRows) || scoutRows.length !== 2) {
      return null;
    }
    const scoutEvidence = scoutRows.map((row, index) => {
      const candidateToken = candidateByPerson.get(row?.person_id);
      if (!candidateToken && index === 0) return null;
      const evidence = {
        assetId: requiredPrivateId(row.asset_id, `scoutRows[${index}].assetId`),
        faceId: requiredPrivateId(row.face_id, `scoutRows[${index}].faceId`),
        identityClaimId: requiredPrivateId(
          row.identity_claim_id,
          `scoutRows[${index}].identityClaimId`,
        ),
        packSourceRevisionDigest: binding.sourceRevisionDigest,
        producerResultDigest: requiredDigest(
          row.producer_result_digest,
          `scoutRows[${index}].producerResultDigest`,
        ),
        vectorDigest: requiredDigest(
          row.vector_digest,
          `scoutRows[${index}].vectorDigest`,
        ),
      };
      return {
        candidateToken: candidateToken || null,
        evidenceDigest: recognitionDigest(evidence),
        scoutScore: canonicalScore(row.score, `scoutRows[${index}].score`),
      };
    });
    if (scoutEvidence[0] == null) return null;
    const {
      classifyFaceCondition,
      faceConditionClassifierSchemaVersion,
      waveOneFaceConditionPolicyV1,
    } = await import("./face-condition-classifier.mjs");
    const {
      allTrustedShortlistRouterSchemaVersion,
      prepareAllTrustedShortlistEvidence,
      resolveAllTrustedShortlistEvidence,
    } = await import("./all-trusted-shortlist-router.mjs");
    const numberOrNull = (value, label) =>
      value == null ? null : canonicalUnitScore(value, label);
    const classification = classifyFaceCondition({
      observation: {
        detectionConfidence: numberOrNull(
          quality.detection_confidence,
          "quality.detectionConfidence",
        ),
        faceAreaRatio: canonicalUnitScore(
          quality.face_area_ratio,
          "quality.faceAreaRatio",
        ),
        frontalScore: numberOrNull(
          quality.frontal_score,
          "quality.frontalScore",
        ),
        qualityScore: numberOrNull(
          quality.quality_score,
          "quality.qualityScore",
        ),
      },
      policy: waveOneFaceConditionPolicyV1,
      queryRevisionDigest: candidateEnvelope.binding.queryRevisionDigest,
      schemaVersion: faceConditionClassifierSchemaVersion,
    });
    const prepared = prepareAllTrustedShortlistEvidence({
      candidateEnvelope,
      policy: allTrustedShortlistPolicyV1,
      qualityClassification: classification,
      schemaVersion: allTrustedShortlistRouterSchemaVersion,
      scoutEvidence,
    });
    const result = resolveAllTrustedShortlistEvidence(prepared);
    if (result.changed) {
      const proposed = privateBinding.candidates.get(
        result.proposedCandidateToken,
      );
      if (!proposed) {
        throw typedError(
          "All-trusted shortlist resolved outside the frozen frontier",
          "VISUAL_CANDIDATE_SET_REPOSITORY_CONFLICT",
          409,
        );
      }
      privateAllTrustedShortlistSuggestions.set(
        result,
        deepFreeze({
          candidatePrimeScore: result.numericEvidence.candidatePrimeScore,
          displayName: String(scoutRows[0].display_name || ""),
          faceId: privateBinding.query.faceId,
          personId: proposed.personId,
          scoutScore: result.numericEvidence.scoutScore,
        }),
      );
    }
    return result;
  };

  const projectAllTrustedShortlistSuggestion = (result) => {
    const projection = privateAllTrustedShortlistSuggestions.get(result);
    if (!projection) {
      throw typedError(
        "An exact changed repository-issued all-trusted result is required",
      );
    }
    return projection;
  };

  const projectConditionReviewSuggestion = (result) => {
    const projection = privateConditionReviewSuggestions.get(result);
    if (!projection) {
      throw typedError(
        "An exact repository-issued condition-consensus result is required",
      );
    }
    return projection;
  };

  const routeProviderConditions = (input) =>
    routeProviderConditionsWithMode(input, "weighted");

  const routeProviderConditionConsensus = (input) =>
    routeProviderConditionsWithMode(input, "consensus");

  return Object.freeze({
    load,
    loadBodyEvidence,
    loadCaptureContextEvidence,
    loadSamePhotoEvidence,
    project,
    projectAllTrustedShortlistSuggestion,
    projectConditionReviewSuggestion,
    routeAllTrustedShortlist,
    routeProviderConditionConsensus,
    routeProviderConditions,
  });
};

export const visualCandidateSetContractDigest = recognitionDigest({
  schemaVersion: visualCandidateSetSchemaVersion,
  scorePrecision,
  scorerVersion,
});

export const visualCandidateBodyEvidenceContractDigest = recognitionDigest({
  bodyContinuityRepositoryProjectionSchemaVersion,
  schemaVersion: visualCandidateBodyEvidenceSchemaVersion,
  visualCandidateSetContractDigest,
});

export const visualCandidateCaptureEvidenceContractDigest = recognitionDigest({
  schemaVersion: visualCandidateCaptureEvidenceSchemaVersion,
  visualCandidateSetContractDigest,
});

export const visualCandidateSamePhotoEvidenceContractDigest = recognitionDigest(
  {
    schemaVersion: visualCandidateSamePhotoEvidenceSchemaVersion,
    visualCandidateSetContractDigest,
  },
);
