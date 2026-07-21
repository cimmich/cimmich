import assert from "node:assert/strict";
import test from "node:test";
import {
  createVisualCandidateSetRepository,
  visualCandidateBodyEvidenceContractDigest,
  visualCandidateCaptureEvidenceContractDigest,
  visualCandidateSamePhotoEvidenceContractDigest,
  visualCandidateSetContractDigest,
  visualCandidateSetSchemaVersion,
} from "../src/visual-candidate-set.mjs";
import {
  bodyContinuityComparisonSchemaVersion,
  bodyContinuityFeatureResultSchemaVersion,
  bodyContinuityProviderSchemaVersion,
  deriveBodyContinuityComparisonResultDigest,
  deriveBodyContinuityFeatureSpaceId,
  deriveBodyContinuityProviderConfigDigest,
  validateBodyContinuityComparison,
} from "../src/body-continuity-contract.mjs";
import {
  bodyDetectionResultSchemaVersion,
  bodyDetectorSchemaVersion,
  deriveBodyDetectorConfigDigest,
  validateBodyDetectionResult,
} from "../src/body-detector-contract.mjs";
import { recognitionDigest } from "../src/recognition-provider-contract.mjs";
import {
  adaptCandidateBodyEvidence,
  contextualCandidateBodyAdapterContractDigest,
  contextualCandidateBodyAdapterSchemaVersion,
} from "../src/contextual-candidate-body-adapter.mjs";
import {
  adaptCandidateCaptureEvidence,
  contextualCandidateCaptureAdapterContractDigest,
  contextualCandidateCaptureAdapterSchemaVersion,
} from "../src/contextual-candidate-capture-adapter.mjs";
import {
  adaptCandidateSamePhotoEvidence,
  contextualCandidateSamePhotoAdapterContractDigest,
  contextualCandidateSamePhotoAdapterSchemaVersion,
} from "../src/contextual-candidate-same-photo-adapter.mjs";
import {
  contextualCandidatePriorSchemaVersion,
  contextualCandidateSetDigest,
  contextualEvidenceDigest,
  contextualPolicyDigest,
  evaluateContextualCandidatePrior,
} from "../src/candidate-context-policy-v2.mjs";

const digest = (character) => character.repeat(64).slice(0, 64);
const binding = (overrides = {}) => ({
  asset_id: "asset-internal-query",
  config_digest: digest("c"),
  current_person_id: null,
  dimension: 4,
  embedding_id: "embedding-internal-query",
  face_id: "face-internal-query",
  input_revision: digest("1"),
  model_family: "synthetic-model",
  model_version: "v1",
  pack_digest: digest("2"),
  pack_id: "sourcepack-internal-active",
  policy_version: "cimmich-source-pack-v8-evidence-modifiers",
  source_content_digest: digest("3"),
  source_revision_digest: digest("4"),
  vector_digest: digest("5"),
  vector_space_id: `vector_space_${digest("6")}`,
  ...overrides,
});

const repository = ({
  bindingRows = [binding()],
  bodyRows = [],
  candidateRows = [],
  captureRows = [],
  samePhotoRows = [],
} = {}) => {
  const statements = [];
  const sql = async (strings, ...values) => {
    const statement = strings.join("?");
    statements.push({ statement, values });
    if (statement.includes("SELECT DISTINCT face.face_id")) return bindingRows;
    if (statement.includes("current_body_detection_result_observation"))
      return bodyRows;
    if (statement.includes("cimmich.visual-candidate-capture-evidence.v1"))
      return captureRows;
    if (statement.includes("cimmich.visual-candidate-same-photo-evidence.v1"))
      return samePhotoRows;
    return candidateRows;
  };
  return {
    api: createVisualCandidateSetRepository(sql, {
      presentationRank: () => 1,
    }),
    statements,
  };
};

const continuityFixture = () => {
  const detectorCore = {
    detector: {
      artifactDigest: digest("a"),
      modelId: "synthetic-body-detector",
      modelVersionId: "v1",
      scoreThreshold: 0.5,
    },
    execution: {
      device: "cpu",
      network: "forbidden",
      runtimeId: "synthetic-runtime",
      threads: 1,
    },
    licensing: { code: "declared", model: "unknown", trainingData: "unknown" },
    preprocessing: {
      colorSpace: "rgb",
      coordinateSpace: "normalized_image",
      inputHeight: 640,
      inputWidth: 640,
      resizeMode: "letterbox",
    },
    privacy: { externalUpload: "none", sourceMedia: "local-read-only" },
    provider: { providerId: "synthetic-provider", versionId: "v1" },
    resources: { maxMemoryMiB: 1024, maxRuntimeMs: 30_000 },
    schemaVersion: bodyDetectorSchemaVersion,
  };
  const detector = {
    ...detectorCore,
    detectorConfigDigest: deriveBodyDetectorConfigDigest(detectorCore),
  };
  const bodyResult = (character) =>
    validateBodyDetectionResult(
      {
        assetToken: digest(character),
        bodies: [0, 1].map((index) => ({
          box: { h: 0.7, w: 0.3, x: 0.05 + index * 0.5, y: 0.1 },
          confidence: 0.9,
          quality: { visibility: 0.9 },
        })),
        detectorConfigDigest: detector.detectorConfigDigest,
        inputRevision: recognitionDigest(`${character}:revision`),
        schemaVersion: bodyDetectionResultSchemaVersion,
        sourceContentDigest: recognitionDigest(`${character}:source`),
        state: "bodies_detected",
      },
      detector,
    );
  const left = bodyResult("b");
  const right = bodyResult("c");
  const providerCore = {
    execution: {
      device: "cpu",
      network: "forbidden",
      runtimeId: "synthetic-runtime",
      threads: 1,
    },
    feature: {
      artifactDigest: digest("d"),
      modelId: "synthetic-body-appearance",
      modelVersionId: "v1",
      scoreSemantics: "unit_interval_similarity",
    },
    licensing: { code: "declared", model: "unknown", trainingData: "unknown" },
    policy: {
      maximumBodiesPerAsset: 8,
      maximumComparisons: 64,
      minimumBidirectionalMargin: 0.1,
      minimumSimilarity: 0.8,
      missingAlternativeRule: "abstain_without_alternative",
    },
    preprocessing: {
      colorSpace: "rgb",
      inputHeight: 256,
      inputWidth: 128,
      resizeMode: "letterbox",
    },
    privacy: { externalUpload: "none", sourceMedia: "local-read-only" },
    provider: { providerId: "synthetic-appearance", versionId: "v1" },
    resources: { maxMemoryMiB: 1024, maxRuntimeMs: 30_000 },
    schemaVersion: bodyContinuityProviderSchemaVersion,
  };
  const provider = {
    ...providerCore,
    featureSpaceId: deriveBodyContinuityFeatureSpaceId(providerCore),
    providerConfigDigest:
      deriveBodyContinuityProviderConfigDigest(providerCore),
  };
  const assetBinding = (validation) => ({
    assetToken: validation.result.assetToken,
    bodyResultDigest: validation.resultDigest,
    detectorConfigDigest: validation.result.detectorConfigDigest,
    inputRevision: validation.result.inputRevision,
    sourceContentDigest: validation.result.sourceContentDigest,
  });
  const feature = (validation) => ({
    binding: assetBinding(validation),
    featureSpaceId: provider.featureSpaceId,
    observations: validation.result.bodies.map((body) => ({
      bodyId: body.bodyId,
      featureDigest: recognitionDigest(`${body.bodyId}:feature`),
      quality: { occlusion: 0.1, truncation: 0, visibility: 0.9 },
      reason: "none",
      state: "available",
    })),
    schemaVersion: bodyContinuityFeatureResultSchemaVersion,
  });
  const packet = (runId) => {
    const core = {
      comparisons: [
        {
          leftBodyId: left.result.bodies[0].bodyId,
          rightBodyId: right.result.bodies[0].bodyId,
          similarity: 0.95,
        },
        {
          leftBodyId: left.result.bodies[0].bodyId,
          rightBodyId: right.result.bodies[1].bodyId,
          similarity: 0.2,
        },
        {
          leftBodyId: left.result.bodies[1].bodyId,
          rightBodyId: right.result.bodies[0].bodyId,
          similarity: 0.25,
        },
        {
          leftBodyId: left.result.bodies[1].bodyId,
          rightBodyId: right.result.bodies[1].bodyId,
          similarity: 0.94,
        },
      ],
      contextEvidenceDigest: digest("e"),
      contextScope: "capture_context_candidate",
      left: feature(left),
      providerConfigDigest: provider.providerConfigDigest,
      right: feature(right),
      runId,
      schemaVersion: bodyContinuityComparisonSchemaVersion,
    };
    return {
      ...core,
      resultDigest: deriveBodyContinuityComparisonResultDigest(core),
    };
  };
  return {
    left,
    right,
    validation: validateBodyContinuityComparison({
      first: packet("run_one"),
      leftBodyValidation: left,
      manifest: provider,
      rightBodyValidation: right,
      second: packet("run_two"),
    }),
  };
};

const request = (overrides = {}) => ({
  faceId: "face-internal-query",
  limit: 12,
  providerConfigDigest: digest("c"),
  visualFloor: 0.7,
  ...overrides,
});

test("active reviewed same-space evidence issues one anonymous deterministic candidate set", async () => {
  const rows = [
    { person_id: "person-internal-b", visual_score: 0.805 },
    { person_id: "person-internal-a", visual_score: 0.82 },
  ];
  const firstRepository = repository({ candidateRows: rows });
  const secondRepository = repository({ candidateRows: [...rows].reverse() });
  const first = await firstRepository.api.load(request());
  const second = await secondRepository.api.load(request());
  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, visualCandidateSetSchemaVersion);
  assert.equal(first.state, "available");
  assert.equal(first.candidates.length, 2);
  assert.equal(first.baseline.visualScore, 0.82);
  assert.equal(first.baseline.margin, 0.015);
  assert.equal(first.binding.providerConfigDigest, digest("c"));
  assert.equal(first.binding.vectorSpaceId, `vector_space_${digest("6")}`);
  assert.match(first.candidateSetDigest, /^[0-9a-f]{64}$/);
  assert.match(first.queryToken, /^[0-9a-f]{64}$/);
  assert.match(first.receiptDigest, /^[0-9a-f]{64}$/);
  assert.match(visualCandidateSetContractDigest, /^[0-9a-f]{64}$/);
  assert.deepEqual(first.authority, {
    activation: "none",
    automaticIdentityAuthority: "none",
    persistence: "none",
    recommendation: "none",
    training: "none",
  });
  assert.equal(first.boundary.repositoryWrites, "none");
  assert.equal(first.boundary.sourceMediaRead, "none");
});

test("public envelope and projection contain no repository identity or media keys", async () => {
  const { api } = repository({
    candidateRows: [{ person_id: "person-secret", visual_score: 0.91 }],
  });
  const envelope = await api.load(request());
  assert.equal(api.project(envelope), envelope);
  const serialized = JSON.stringify(envelope);
  for (const forbidden of [
    "person-secret",
    "face-internal-query",
    "asset-internal-query",
    "embedding-internal-query",
    "personId",
    "faceId",
    "assetId",
    "displayName",
    "filename",
    "path",
    "embedding",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("visibility, active-pack, evaluation and provider lineage are structural SQL gates", async () => {
  const { api, statements } = repository();
  await api.load(request());
  assert.equal(statements.length, 2);
  const bindingSql = statements[0].statement;
  const scoringSql = statements[1].statement;
  for (const required of [
    "cimmich_visibility_asset_rank(face.asset_id)",
    "pack.state = 'active'",
    "pack.evaluation_status = 'passed'",
    "pipeline.state = 'recognized'",
    "job.state = 'completed'",
    "current_manual_face_matching_evidence",
    "pipeline.input_revision",
    "pipeline.source_content_digest",
    "evidence.source_content_digest",
    "current_asset_source_revision",
    "face_detection_result_observation",
    "immich_asset_projection",
    "pipeline.run_kind = 'detector_result'",
    "pipeline.run_kind = 'existing_observation_set'",
  ]) {
    assert.equal(bindingSql.includes(required), true, required);
  }
  assert.equal(
    scoringSql.includes(
      "cimmich_visibility_asset_rank(reference_face.asset_id)",
    ),
    true,
  );
  assert.equal(scoringSql.includes("reference.bucket_kind = 'prime'"), true);
  assert.equal(
    scoringSql.includes("reference.routing_state = 'eligible'"),
    true,
  );
});

test("missing provider or active pack lineage abstains without leaking query state", async () => {
  const { api } = repository({ bindingRows: [] });
  const result = await api.load(request());
  assert.equal(result.state, "unavailable");
  assert.equal(result.reason, "PROVIDER_OR_ACTIVE_PACK_BINDING_UNAVAILABLE");
  assert.equal(result.binding, null);
  assert.equal(result.queryToken, null);
  assert.deepEqual(result.candidates, []);
  assert.equal(
    result.boundary.currentRepositoryRevisionValidation,
    "not_available",
  );
});

test("an exact binding with no above-floor candidates produces a bound abstention", async () => {
  const { api } = repository({ candidateRows: [] });
  const result = await api.load(request());
  assert.equal(result.state, "unavailable");
  assert.equal(result.reason, "NO_VISUAL_CANDIDATES");
  assert.match(result.queryToken, /^[0-9a-f]{64}$/);
  assert.equal(
    result.boundary.currentRepositoryRevisionValidation,
    "performed_at_issue",
  );
});

test("ambiguous provider, pack or embedding lineage fails closed", async () => {
  const { api } = repository({ bindingRows: [binding(), binding()] });
  await assert.rejects(
    api.load(request()),
    (error) => error.code === "VISUAL_CANDIDATE_SET_BINDING_AMBIGUOUS",
  );
});

test("provider/config drift and duplicate repository subjects fail before receipt", async () => {
  const drift = repository({
    bindingRows: [binding({ config_digest: digest("d") })],
  });
  await assert.rejects(
    drift.api.load(request()),
    (error) => error.code === "VISUAL_CANDIDATE_SET_BINDING_CONFLICT",
  );

  const duplicate = repository({
    candidateRows: [
      { person_id: "person-duplicate", visual_score: 0.9 },
      { person_id: "person-duplicate", visual_score: 0.8 },
    ],
  });
  await assert.rejects(
    duplicate.api.load(request()),
    (error) => error.code === "VISUAL_CANDIDATE_SET_REPOSITORY_CONFLICT",
  );
});

test("caller fields, bounds and copied envelopes cannot cross the issuer boundary", async () => {
  const { api } = repository({
    candidateRows: [{ person_id: "person-a", visual_score: 0.8 }],
  });
  for (const invalid of [
    { ...request(), vectorSpaceId: `vector_space_${digest("6")}` },
    { ...request(), providerConfigDigest: "not-a-digest" },
    { ...request(), visualFloor: 0.7000001 },
    { ...request(), visualFloor: -1 },
    { ...request(), limit: 65 },
    { ...request(), faceId: "" },
  ]) {
    await assert.rejects(api.load(invalid));
  }
  const envelope = await api.load(request());
  assert.throws(() => api.project({ ...envelope }));
  assert.throws(() => api.project(structuredClone(envelope)));
});

test("below-floor or non-finite repository scores cannot be laundered", async () => {
  for (const visual_score of [0.69, Number.NaN, Number.POSITIVE_INFINITY]) {
    const { api } = repository({
      candidateRows: [{ person_id: "person-a", visual_score }],
    });
    await assert.rejects(
      api.load(request()),
      (error) => error.code === "VISUAL_CANDIDATE_SET_REPOSITORY_CONFLICT",
    );
  }
});

test("current exact Body continuity supports only an already-present anonymous candidate", async () => {
  const continuity = continuityFixture();
  const row = (side, body, asset, person_id = null) => ({
    asset_id: asset,
    asset_token: side.result.assetToken,
    body_id: body.bodyId,
    detector_config_digest: side.result.detectorConfigDigest,
    input_revision: side.result.inputRevision,
    person_id,
    result_digest: side.resultDigest,
    source_content_digest: side.result.sourceContentDigest,
  });
  const bodyRows = [
    ...continuity.left.result.bodies.map((body) =>
      row(continuity.left, body, "asset-internal-query"),
    ),
    row(
      continuity.right,
      continuity.right.result.bodies[0],
      "asset-internal-reference",
      "person-internal-candidate",
    ),
    row(
      continuity.right,
      continuity.right.result.bodies[1],
      "asset-internal-reference",
    ),
  ];
  const captureRows = [
    {
      candidate_confidence: 0.85,
      capture_time: "2026-07-18T00:01:00.000Z",
      context_confidence: 1,
      context_id: "context-internal-current",
      context_kind: "same_moment",
      created_by: "user",
      decision_id: "decision-internal-context",
      end_time: "2026-07-18T00:02:00.000Z",
      input_revision: continuity.left.result.inputRevision,
      person_id: "person-internal-candidate",
      query_actor_kind: "user",
      query_member_confidence: 1,
      query_membership_event_id: "context-member-internal-query",
      query_reason_code: "explicit_capture_context",
      start_time: "2026-07-18T00:00:00.000Z",
      support_asset_ids: [0, 1, 2, 3].map(
        (index) => `asset-internal-support-${index}`,
      ),
      support_face_ids: [0, 1, 2, 3].map(
        (index) => `face-internal-support-${index}`,
      ),
      support_identity_claim_ids: [0, 1, 2, 3].map(
        (index) => `claim-internal-support-${index}`,
      ),
      support_input_revisions: [0, 1, 2, 3].map((index) =>
        recognitionDigest(`support-revision-${index}`),
      ),
      support_membership_event_ids: [0, 1, 2, 3].map(
        (index) => `context-member-internal-support-${index}`,
      ),
      supporting_asset_count: 4,
    },
  ];
  const samePhotoRows = [
    {
      association_type: "body",
      geometry_id: "body-internal-same-photo",
      input_revision: continuity.left.result.inputRevision,
      person_id: "person-internal-same-photo",
    },
  ];
  const { api, statements } = repository({
    bindingRows: [
      binding({ input_revision: continuity.left.result.inputRevision }),
    ],
    bodyRows,
    candidateRows: [
      { person_id: "person-internal-baseline", visual_score: 0.82 },
      { person_id: "person-internal-candidate", visual_score: 0.805 },
      { person_id: "person-internal-same-photo", visual_score: 0.75 },
    ],
    captureRows,
    samePhotoRows,
  });
  const candidates = await api.load(request());
  const evidence = await api.loadBodyEvidence({
    candidateEnvelope: candidates,
    continuityEnvelope: continuity.validation,
  });
  assert.equal(evidence.state, "supported");
  assert.match(visualCandidateBodyEvidenceContractDigest, /^[0-9a-f]{64}$/);
  assert.equal(evidence.evidence.length, 1);
  assert.equal(
    candidates.candidates.some(
      (candidate) =>
        candidate.candidateToken === evidence.evidence[0].candidateToken,
    ),
    true,
  );
  assert.equal(evidence.evidence[0].score, 0.95);
  assert.equal(evidence.nonRepresentative, true);
  assert.equal(evidence.operationalUse, "none");
  const adapted = adaptCandidateBodyEvidence({
    bodyEvidenceEnvelope: evidence,
    candidateEnvelope: candidates,
  });
  assert.equal(
    adapted.schemaVersion,
    contextualCandidateBodyAdapterSchemaVersion,
  );
  assert.match(contextualCandidateBodyAdapterContractDigest, /^[0-9a-f]{64}$/);
  assert.equal(adapted.candidates.length, candidates.candidates.length);
  const supportedCandidate = adapted.candidates.find(
    (candidate) => candidate.bodyContinuity.state === "supported",
  );
  assert.ok(supportedCandidate);
  assert.equal(supportedCandidate.bodyContinuity.score, 0.95);
  assert.equal(adapted.nonRepresentative, true);
  assert.equal(adapted.operationalUse, "none");
  const captureEvidence = await api.loadCaptureContextEvidence({
    candidateEnvelope: candidates,
  });
  assert.equal(captureEvidence.state, "supported");
  assert.match(visualCandidateCaptureEvidenceContractDigest, /^[0-9a-f]{64}$/);
  assert.equal(captureEvidence.evidence.length, 1);
  assert.equal(captureEvidence.evidence[0].captureContext.confidence, 0.85);
  assert.equal(
    captureEvidence.evidence[0].captureContext.reliability,
    "verified",
  );
  assert.equal(captureEvidence.evidence[0].metadata.errorSeconds, 0);
  const captureAdapted = adaptCandidateCaptureEvidence({
    candidateEnvelope: candidates,
    captureEvidenceEnvelope: captureEvidence,
  });
  assert.equal(
    captureAdapted.schemaVersion,
    contextualCandidateCaptureAdapterSchemaVersion,
  );
  assert.match(
    contextualCandidateCaptureAdapterContractDigest,
    /^[0-9a-f]{64}$/,
  );
  assert.equal(captureAdapted.candidates.length, candidates.candidates.length);
  const captureSupportedCandidate = captureAdapted.candidates.find(
    (candidate) => candidate.captureContext.state === "supported",
  );
  assert.equal(
    captureSupportedCandidate.candidateToken,
    supportedCandidate.candidateToken,
  );
  const captureSql = statements.find(({ statement }) =>
    statement.includes("cimmich.visual-candidate-capture-evidence.v1"),
  ).statement;
  assert.equal(
    captureSql.indexOf(
      "cimmich_visibility_asset_rank(support_member.asset_id)",
    ) < captureSql.indexOf("HAVING count(DISTINCT support_asset_id)"),
    true,
  );
  const samePhotoEvidence = await api.loadSamePhotoEvidence({
    candidateEnvelope: candidates,
  });
  assert.equal(samePhotoEvidence.state, "available");
  assert.match(
    visualCandidateSamePhotoEvidenceContractDigest,
    /^[0-9a-f]{64}$/,
  );
  assert.equal(samePhotoEvidence.evidence.length, 1);
  assert.equal(
    samePhotoEvidence.evidence[0].samePhoto.state,
    "accepted_present",
  );
  const samePhotoAdapted = adaptCandidateSamePhotoEvidence({
    candidateEnvelope: candidates,
    samePhotoEvidenceEnvelope: samePhotoEvidence,
  });
  assert.equal(
    samePhotoAdapted.schemaVersion,
    contextualCandidateSamePhotoAdapterSchemaVersion,
  );
  assert.match(
    contextualCandidateSamePhotoAdapterContractDigest,
    /^[0-9a-f]{64}$/,
  );
  const acceptedSamePhotoCandidate = samePhotoAdapted.candidates.find(
    (candidate) => candidate.samePhoto.state === "accepted_present",
  );
  assert.equal(acceptedSamePhotoCandidate.visualScore, 0.75);
  assert.equal(
    samePhotoAdapted.candidates.filter(
      (candidate) => candidate.samePhoto.state === "unknown",
    ).length,
    2,
  );

  const contextualPolicy = Object.freeze({
    bodyAdjustment: 0.01,
    captureAdjustment: 0.01,
    maximumMetadataErrorSeconds: 120,
    maximumTotalAdjustment: 0.02,
    minimumBodyMargin: 0.005,
    minimumBodyScore: 0.8,
    minimumCaptureConfidence: 0.8,
    tieWindow: 0.02,
    visualFloor: 0.7,
  });
  const captureByCandidate = new Map(
    captureAdapted.candidates.map((candidate) => [
      candidate.candidateToken,
      candidate,
    ]),
  );
  const samePhotoByCandidate = new Map(
    samePhotoAdapted.candidates.map((candidate) => [
      candidate.candidateToken,
      candidate.samePhoto,
    ]),
  );
  const contextualCandidates = adapted.candidates.map((candidate) => {
    const capture = captureByCandidate.get(candidate.candidateToken);
    return {
      ambiguity: capture.ambiguity,
      ...candidate,
      captureContext: capture.captureContext,
      metadata: capture.metadata,
      samePhoto: samePhotoByCandidate.get(candidate.candidateToken),
    };
  });
  const contextualReceipt = evaluateContextualCandidatePrior({
    baseline: adapted.baseline,
    bodyContinuitySource: "synthetic_fixture",
    candidateSetDigest: contextualCandidateSetDigest(contextualCandidates),
    candidates: contextualCandidates,
    cohortDigest: recognitionDigest("exact-adapter-synthetic-cohort"),
    contextPolicyDigest: contextualPolicyDigest(contextualPolicy),
    evidenceDigest: contextualEvidenceDigest(contextualCandidates),
    nonRepresentative: true,
    operationalUse: "none",
    policy: contextualPolicy,
    providerConfigDigest: adapted.binding.providerConfigDigest,
    queryToken: adapted.binding.queryToken,
    schemaVersion: contextualCandidatePriorSchemaVersion,
    truthVersionDigest: recognitionDigest("exact-adapter-synthetic-truth"),
    vectorSpaceId: adapted.binding.vectorSpaceId,
    visualPolicyDigest: adapted.binding.visualPolicyDigest,
  });
  assert.equal(contextualReceipt.decision.status, "tie_break_proposed");
  assert.equal(
    contextualReceipt.decision.proposedCandidateToken,
    supportedCandidate.candidateToken,
  );
  assert.equal(
    contextualReceipt.candidates.find(
      (candidate) =>
        candidate.candidateToken === supportedCandidate.candidateToken,
    ).adjustment.bodyContinuity,
    0.01,
  );
  assert.equal(contextualReceipt.nonRepresentative, true);
  assert.equal(contextualReceipt.operationalUse, "none");
  assert.equal(contextualReceipt.authority.automaticIdentityAuthority, "none");
  assert.equal(
    contextualReceipt.candidates.some(
      (candidate) =>
        candidate.candidateToken === acceptedSamePhotoCandidate.candidateToken,
    ),
    false,
  );
  const serialized = JSON.stringify({
    adapted,
    captureAdapted,
    captureEvidence,
    contextualReceipt,
    evidence,
    samePhotoAdapted,
    samePhotoEvidence,
  });
  for (const forbidden of [
    "person-internal-candidate",
    "person-internal-baseline",
    "asset-internal-query",
    "asset-internal-reference",
    "context-internal-current",
    "decision-internal-context",
    "context-member-internal-query",
    "body-internal-same-photo",
    continuity.left.result.bodies[0].bodyId,
    "personId",
    "assetId",
    "bodyId",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  await assert.rejects(
    api.loadBodyEvidence({
      candidateEnvelope: candidates,
      continuityEnvelope: { ...continuity.validation },
    }),
  );
  assert.throws(() =>
    adaptCandidateBodyEvidence({
      bodyEvidenceEnvelope: { ...evidence },
      candidateEnvelope: candidates,
    }),
  );
  assert.throws(() =>
    adaptCandidateCaptureEvidence({
      candidateEnvelope: candidates,
      captureEvidenceEnvelope: { ...captureEvidence },
    }),
  );
  assert.throws(() =>
    adaptCandidateSamePhotoEvidence({
      candidateEnvelope: candidates,
      samePhotoEvidenceEnvelope: { ...samePhotoEvidence },
    }),
  );
  await assert.rejects(
    api.loadSamePhotoEvidence({ candidateEnvelope: { ...candidates } }),
  );
  samePhotoRows[0].input_revision = digest("e");
  const staleSamePhoto = await api.loadSamePhotoEvidence({
    candidateEnvelope: candidates,
  });
  assert.equal(staleSamePhoto.state, "unavailable");
  assert.deepEqual(staleSamePhoto.evidence, []);
  samePhotoRows[0].input_revision = continuity.left.result.inputRevision;
  samePhotoRows[0].person_id = "person-internal-absent";
  const unknownSamePhoto = await api.loadSamePhotoEvidence({
    candidateEnvelope: candidates,
  });
  assert.equal(unknownSamePhoto.state, "available");
  assert.deepEqual(unknownSamePhoto.evidence, []);
  const unknownSamePhotoAdapted = adaptCandidateSamePhotoEvidence({
    candidateEnvelope: candidates,
    samePhotoEvidenceEnvelope: unknownSamePhoto,
  });
  assert.equal(
    unknownSamePhotoAdapted.candidates.every(
      (candidate) => candidate.samePhoto.state === "unknown",
    ),
    true,
  );
  samePhotoRows[0].person_id = "person-internal-same-photo";
  samePhotoRows.push({ ...samePhotoRows[0] });
  await assert.rejects(
    api.loadSamePhotoEvidence({ candidateEnvelope: candidates }),
    (error) => error.code === "VISUAL_CANDIDATE_SET_REPOSITORY_CONFLICT",
  );
  samePhotoRows.pop();
  captureRows.push({
    ...captureRows[0],
    context_id: "context-internal-ambiguous",
    decision_id: "decision-internal-ambiguous",
    query_membership_event_id: "context-member-internal-ambiguous",
  });
  const ambiguousCapture = await api.loadCaptureContextEvidence({
    candidateEnvelope: candidates,
  });
  assert.equal(ambiguousCapture.state, "ambiguous");
  assert.deepEqual(ambiguousCapture.reasons, ["AMBIGUOUS_CAPTURE_CONTEXT"]);
  assert.deepEqual(ambiguousCapture.evidence, []);
  const ambiguousCaptureAdapted = adaptCandidateCaptureEvidence({
    candidateEnvelope: candidates,
    captureEvidenceEnvelope: ambiguousCapture,
  });
  assert.equal(
    ambiguousCaptureAdapted.candidates.every(
      (candidate) => candidate.ambiguity.state === "capture_context",
    ),
    true,
  );
  captureRows.pop();
  captureRows[0].input_revision = digest("e");
  const staleCapture = await api.loadCaptureContextEvidence({
    candidateEnvelope: candidates,
  });
  assert.equal(staleCapture.state, "unavailable");
  assert.deepEqual(staleCapture.reasons, [
    "CURRENT_CAPTURE_CONTEXT_UNAVAILABLE",
  ]);
  assert.deepEqual(staleCapture.evidence, []);
  captureRows[0].input_revision = continuity.left.result.inputRevision;
  captureRows[0].person_id = "person-internal-absent";
  const absentCapture = await api.loadCaptureContextEvidence({
    candidateEnvelope: candidates,
  });
  assert.equal(absentCapture.state, "unavailable");
  assert.deepEqual(absentCapture.evidence, []);
  captureRows[0].person_id = "person-internal-candidate";
  bodyRows[0].result_digest = digest("f");
  const stale = await api.loadBodyEvidence({
    candidateEnvelope: candidates,
    continuityEnvelope: continuity.validation,
  });
  assert.equal(stale.state, "unavailable");
  assert.deepEqual(stale.reasons, ["CURRENT_BODY_RESULT_UNAVAILABLE"]);
  assert.deepEqual(stale.evidence, []);
});

test("current same-pack quality and Secondary/LQ evidence route only Prime top two", async () => {
  const statements = [];
  const sql = async (strings) => {
    const statement = strings.join("?");
    statements.push(statement);
    if (statement.includes("SELECT DISTINCT face.face_id")) return [binding()];
    if (statement.includes("provider-condition-current-quality")) {
      return [
        {
          asset_id: "asset-internal-query",
          detection_confidence: 0.7,
          embedding_id: "embedding-internal-query",
          face_area_ratio: 0.0008,
          face_id: "face-internal-query",
          frontal_score: 0.2,
          input_revision: digest("1"),
          pack_digest: digest("2"),
          pack_id: "sourcepack-internal-active",
          quality_score: 0.35,
          vector_digest: digest("5"),
        },
      ];
    }
    if (statement.includes("provider-condition-reference-evidence")) {
      return [
        {
          asset_id: "asset-reference-alpha",
          bucket_kind: "secondary",
          face_id: "face-reference-alpha",
          person_id: "person-internal-alpha",
          reference_id: "reference-secondary-alpha",
          score: 0.45,
        },
        {
          asset_id: "asset-reference-alpha-lq",
          bucket_kind: "lq",
          face_id: "face-reference-alpha-lq",
          person_id: "person-internal-alpha",
          reference_id: "reference-lq-alpha",
          score: 0.44,
        },
        {
          asset_id: "asset-reference-beta",
          bucket_kind: "secondary",
          face_id: "face-reference-beta",
          person_id: "person-internal-beta",
          reference_id: "reference-secondary-beta",
          score: 0.72,
        },
        {
          asset_id: "asset-reference-beta-lq",
          bucket_kind: "lq",
          face_id: "face-reference-beta-lq",
          person_id: "person-internal-beta",
          reference_id: "reference-lq-beta",
          score: 0.78,
        },
      ];
    }
    return [
      { person_id: "person-internal-alpha", visual_score: 0.61 },
      { person_id: "person-internal-beta", visual_score: 0.6 },
      { person_id: "person-internal-gamma", visual_score: 0.59 },
    ];
  };
  const api = createVisualCandidateSetRepository(sql, {
    presentationRank: () => 1,
  });
  const candidates = await api.load({
    faceId: "face-internal-query",
    limit: 3,
    providerConfigDigest: digest("c"),
    visualFloor: 0.4,
  });
  const result = await api.routeProviderConditions({
    candidateEnvelope: candidates,
  });
  assert.equal(result.changed, true);
  assert.equal(result.qualityBucket, "face_hard");
  assert.equal(result.reason, "CONDITIONED_TOP_TWO_PROPOSAL");
  assert.equal(
    result.proposedCandidateToken,
    candidates.candidates[1].candidateToken,
  );
  assert.equal(result.authority.automaticIdentityAuthority, "none");
  assert.equal(result.authority.persistence, "none");
  const consensus = await api.routeProviderConditionConsensus({
    candidateEnvelope: candidates,
  });
  assert.equal(consensus.changed, true);
  assert.equal(consensus.reason, "INDEPENDENT_CONDITION_CONSENSUS");
  assert.equal(
    consensus.proposedCandidateToken,
    candidates.candidates[1].candidateToken,
  );
  assert.equal(consensus.authority.recommendation, "review_suggestion_only");
  assert.equal(consensus.authority.automaticIdentityAuthority, "none");
  assert.deepEqual(api.projectConditionReviewSuggestion(consensus), {
    candidates: [
      { personId: "person-internal-alpha", rank: 1, visualScore: 0.61 },
      { personId: "person-internal-beta", rank: 2, visualScore: 0.6 },
      { personId: "person-internal-gamma", rank: 3, visualScore: 0.59 },
    ],
    faceId: "face-internal-query",
    personId: "person-internal-beta",
  });
  assert.throws(
    () => api.projectConditionReviewSuggestion({ ...consensus }),
    /exact repository-issued condition-consensus result/,
  );

  const qualitySql = statements.find((statement) =>
    statement.includes("provider-condition-current-quality"),
  );
  const evidenceSql = statements.find((statement) =>
    statement.includes("provider-condition-reference-evidence"),
  );
  assert.match(qualitySql, /pack\.state = 'active'/);
  assert.match(qualitySql, /pack\.evaluation_status = 'passed'/);
  assert.match(qualitySql, /current_asset_source_revision/);
  assert.match(qualitySql, /face_detection_result_observation/);
  assert.match(qualitySql, /immich_asset_projection/);
  assert.match(
    qualitySql,
    /job\.result_receipt_id = embedding\.producer_receipt_id/,
  );
  assert.match(qualitySql, /cimmich_visibility_asset_rank/);
  assert.match(evidenceSql, /reference_face\.asset_id <> query\.asset_id/);
  assert.match(evidenceSql, /current_face_capture_context/);
  assert.match(evidenceSql, /cimmich_visibility_asset_rank/);
});

test("current all-trusted runtime evidence appends only one repository-bound rank four", async () => {
  const statements = [];
  const candidates = [
    ["person-internal-alpha", 0.61],
    ["person-internal-beta", 0.6],
    ["person-internal-gamma", 0.59],
    ["person-internal-scout", 0.55],
    ["person-internal-other", 0.5],
  ].map(([person_id, visual_score]) => ({ person_id, visual_score }));
  const sql = async (strings) => {
    const statement = strings.join("");
    statements.push(statement);
    if (statement.includes("SELECT DISTINCT face.face_id")) return [binding()];
    if (statement.includes("all-trusted-shortlist-current-quality")) {
      return [
        {
          asset_id: "asset-internal-query",
          detection_confidence: 0.7,
          embedding_id: "embedding-internal-query",
          face_area_ratio: 0.0008,
          face_id: "face-internal-query",
          frontal_score: 0.2,
          input_revision: digest("1"),
          pack_digest: digest("2"),
          pack_id: "sourcepack-internal-active",
          quality_score: 0.35,
          vector_digest: digest("5"),
        },
      ];
    }
    if (statement.includes("all-trusted-shortlist-reference-evidence")) {
      return [
        {
          asset_id: "asset-internal-scout",
          display_name: "Scout Candidate",
          face_id: "face-internal-scout",
          identity_claim_id: "claim-internal-scout",
          person_id: "person-internal-scout",
          producer_result_digest: digest("7"),
          score: 0.72,
          vector_digest: digest("9"),
        },
        {
          asset_id: "asset-internal-other",
          display_name: "Other Candidate",
          face_id: "face-internal-other",
          identity_claim_id: "claim-internal-other",
          person_id: "person-internal-other",
          producer_result_digest: digest("a"),
          score: 0.66,
          vector_digest: digest("c"),
        },
      ];
    }
    return candidates;
  };
  const api = createVisualCandidateSetRepository(sql, {
    allTrustedShortlistEvaluationReceiptDigest: digest("e"),
    allTrustedShortlistFrozenSourcePackId: "sourcepack-reviewed-fixture",
    presentationRank: () => 1,
  });
  const candidateEnvelope = await api.load({
    faceId: "face-internal-query",
    limit: 64,
    providerConfigDigest: digest("c"),
    visualFloor: 0,
  });
  const result = await api.routeAllTrustedShortlist({ candidateEnvelope });
  assert.equal(result.changed, true);
  assert.equal(result.reason, "ALL_TRUSTED_REVIEW_SHORTLIST_ADDITION");
  assert.equal(result.authority.automaticIdentityAuthority, "none");
  assert.equal(result.authority.persistence, "none");
  assert.deepEqual(api.projectAllTrustedShortlistSuggestion(result), {
    candidatePrimeScore: 0.55,
    displayName: "Scout Candidate",
    faceId: "face-internal-query",
    personId: "person-internal-scout",
    scoutScore: 0.72,
  });
  assert.throws(
    () => api.projectAllTrustedShortlistSuggestion({ ...result }),
    /exact changed repository-issued all-trusted result/,
  );

  const qualitySql = statements.find((statement) =>
    statement.includes("all-trusted-shortlist-current-quality"),
  );
  const scoutSql = statements.find((statement) =>
    statement.includes("all-trusted-shortlist-reference-evidence"),
  );
  assert.match(qualitySql, /media_pipeline_run_observation/);
  assert.match(qualitySql, /current_asset_source_revision/);
  assert.match(qualitySql, /job\.result_receipt_id = .*producer_receipt_id/s);
  assert.match(qualitySql, /cimmich_visibility_asset_rank/);
  assert.match(scoutSql, /JOIN producer_receipt reference_receipt/);
  assert.match(scoutSql, /reference_receipt\.result_digest/);
  assert.match(scoutSql, /governed_pack\.source_revision_digest/);
  assert.match(scoutSql, /JOIN source_pack evaluated_pack/);
  assert.match(scoutSql, /source_pack_evaluation shortlist_evaluation/);
  assert.match(scoutSql, /shortlist_evaluation\.status = 'passed'/);
  assert.match(scoutSql, /producer_receipt shortlist_receipt/);
  assert.match(
    scoutSql,
    /shortlist_receipt\.producer_name = 'cimmich-all-trusted-shortlist-gate'/,
  );
  assert.match(scoutSql, /shortlist_receipt\.result_digest =/);
  assert.match(
    scoutSql,
    /shortlist_evaluation\.metrics->>'receiptDigest' = shortlist_receipt\.result_digest/,
  );
  assert.match(
    scoutSql,
    /shortlist_evaluation\.metrics->>'schemaVersion' = 'cimmich\.all-trusted-shortlist-scout-evaluation\.v1'/,
  );
  assert.match(scoutSql, /prime_baseline_drift/);
  assert.match(scoutSql, /EXCEPT/);
  assert.match(scoutSql, /governed_pack\.state = 'active'/);
  assert.match(scoutSql, /governed_pack\.evaluation_status = 'passed'/);
  assert.match(scoutSql, /current_manual_face_matching_evidence/);
  assert.match(scoutSql, /cimmich_visibility_asset_rank/);
  assert.match(scoutSql, /identity\.origin IN \('trusted_import','user'\)/);
  assert.match(scoutSql, /category\.slug = 'holding'/);
  assert.match(scoutSql, /current_face_capture_context/);
  assert.match(scoutSql, /reference_face\.asset_id <> query\.asset_id/);
  assert.match(scoutSql, /LIMIT 2/);
  assert.equal(statements.length, 4);
});

test("missing calibrated quality abstains while current Prime stays unchanged", async () => {
  const sql = async (strings) => {
    const statement = strings.join("");
    if (statement.includes("SELECT DISTINCT face.face_id")) return [binding()];
    if (statement.includes("provider-condition-current-quality")) {
      return [
        {
          asset_id: "asset-internal-query",
          detection_confidence: 0.7,
          embedding_id: "embedding-internal-query",
          face_area_ratio: 0.0008,
          face_id: "face-internal-query",
          frontal_score: null,
          input_revision: digest("1"),
          pack_digest: digest("2"),
          pack_id: "sourcepack-internal-active",
          quality_score: null,
          vector_digest: digest("5"),
        },
      ];
    }
    if (statement.includes("provider-condition-reference-evidence")) return [];
    return [
      { person_id: "person-internal-alpha", visual_score: 0.61 },
      { person_id: "person-internal-beta", visual_score: 0.6 },
    ];
  };
  const api = createVisualCandidateSetRepository(sql, {
    presentationRank: () => 1,
  });
  const candidates = await api.load({
    faceId: "face-internal-query",
    limit: 2,
    providerConfigDigest: digest("c"),
    visualFloor: 0.4,
  });
  const result = await api.routeProviderConditions({
    candidateEnvelope: candidates,
  });
  assert.equal(result.changed, false);
  assert.equal(result.qualityBucket, "unknown");
  assert.equal(result.reason, "QUALITY_CLASSIFICATION_UNKNOWN");
  assert.equal(
    result.proposedCandidateToken,
    candidates.candidates[0].candidateToken,
  );
});

test("condition routing rejects copied candidates and current-lineage drift", async () => {
  const { api } = repository({
    candidateRows: [
      { person_id: "person-internal-alpha", visual_score: 0.61 },
      { person_id: "person-internal-beta", visual_score: 0.6 },
    ],
  });
  const candidates = await api.load({
    faceId: "face-internal-query",
    limit: 2,
    providerConfigDigest: digest("c"),
    visualFloor: 0.4,
  });
  await assert.rejects(
    () =>
      api.routeProviderConditions({
        candidateEnvelope: Object.freeze({ ...candidates }),
      }),
    /exact repository-issued candidate envelope/,
  );

  let calls = 0;
  const driftSql = async (strings) => {
    const statement = strings.join("");
    calls += 1;
    if (statement.includes("SELECT DISTINCT face.face_id")) return [binding()];
    if (statement.includes("provider-condition-current-quality")) {
      return [
        {
          asset_id: "asset-other",
          detection_confidence: 0.7,
          embedding_id: "embedding-internal-query",
          face_area_ratio: 0.001,
          face_id: "face-internal-query",
          frontal_score: 0.2,
          input_revision: digest("1"),
          pack_digest: digest("2"),
          pack_id: "sourcepack-internal-active",
          quality_score: 0.35,
          vector_digest: digest("5"),
        },
      ];
    }
    return [
      { person_id: "person-internal-alpha", visual_score: 0.61 },
      { person_id: "person-internal-beta", visual_score: 0.6 },
    ];
  };
  const driftApi = createVisualCandidateSetRepository(driftSql, {
    presentationRank: () => 1,
  });
  const driftCandidates = await driftApi.load({
    faceId: "face-internal-query",
    limit: 2,
    providerConfigDigest: digest("c"),
    visualFloor: 0.4,
  });
  await assert.rejects(
    () =>
      driftApi.routeProviderConditions({
        candidateEnvelope: driftCandidates,
      }),
    /quality lineage drifted/,
  );
  assert.equal(calls, 3);
});
