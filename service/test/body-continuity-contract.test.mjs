import assert from "node:assert/strict";
import test from "node:test";
import {
  bodyContinuityComparisonSchemaVersion,
  bodyContinuityContractDigest,
  bodyContinuityFeatureResultSchemaVersion,
  bodyContinuityProviderSchemaVersion,
  bodyContinuityValidationReceiptSchemaVersion,
  createBodyContinuityValidationReceipt,
  deriveBodyContinuityComparisonResultDigest,
  deriveBodyContinuityFeatureSpaceId,
  deriveBodyContinuityProviderConfigDigest,
  projectValidatedBodyContinuityEdges,
  projectValidatedBodyContinuityForRepository,
  validateBodyContinuityComparison,
  validateBodyContinuityProviderManifest,
} from "../src/body-continuity-contract.mjs";
import {
  bodyDetectionResultSchemaVersion,
  bodyDetectorSchemaVersion,
  deriveBodyDetectorConfigDigest,
  validateBodyDetectionResult,
} from "../src/body-detector-contract.mjs";
import { recognitionDigest } from "../src/recognition-provider-contract.mjs";

const digest = (character) => character.repeat(64).slice(0, 64);

const detectorManifest = ({ modelId = "synthetic-body-detector" } = {}) => {
  const value = {
    detector: {
      artifactDigest: recognitionDigest(modelId),
      modelId,
      modelVersionId: "v1",
      scoreThreshold: 0.5,
    },
    execution: {
      device: "cpu",
      network: "forbidden",
      runtimeId: "synthetic-runtime",
      threads: 1,
    },
    licensing: {
      code: "declared",
      model: "unknown",
      trainingData: "unknown",
    },
    preprocessing: {
      colorSpace: "rgb",
      coordinateSpace: "normalized_image",
      inputHeight: 640,
      inputWidth: 640,
      resizeMode: "letterbox",
    },
    privacy: {
      externalUpload: "none",
      sourceMedia: "local-read-only",
    },
    provider: {
      providerId: "synthetic-provider",
      versionId: "v1",
    },
    resources: {
      maxMemoryMiB: 1024,
      maxRuntimeMs: 30_000,
    },
    schemaVersion: bodyDetectorSchemaVersion,
  };
  return {
    ...value,
    detectorConfigDigest: deriveBodyDetectorConfigDigest(value),
  };
};

const bodyObservation = (index, geometryOffset = 0) => ({
  box: {
    h: Number((0.8 - index * 0.05).toFixed(6)),
    w: 0.35,
    x: Number((0.05 + index * 0.45 + geometryOffset).toFixed(6)),
    y: 0.1,
  },
  confidence: Number((0.95 - index * 0.01).toFixed(6)),
  headBox: null,
  quality: { occlusion: 0.1, truncation: 0, visibility: 0.9 },
});

const bodyValidation = ({
  assetCharacter,
  bodyCount = 2,
  detector = detectorManifest(),
  geometryOffset = 0,
  sourceContentDigest,
  state = bodyCount === 0 ? "no_body" : "bodies_detected",
} = {}) =>
  validateBodyDetectionResult(
    {
      assetToken: digest(assetCharacter),
      bodies: Array.from({ length: bodyCount }, (_, index) =>
        bodyObservation(index, geometryOffset),
      ),
      detectorConfigDigest: detector.detectorConfigDigest,
      inputRevision: recognitionDigest(`${assetCharacter}:revision`),
      schemaVersion: bodyDetectionResultSchemaVersion,
      sourceContentDigest:
        sourceContentDigest ?? recognitionDigest(`${assetCharacter}:source`),
      state,
    },
    detector,
  );

const providerManifest = (overrides = {}) => {
  const core = {
    execution: {
      device: "cpu",
      network: "forbidden",
      runtimeId: "synthetic-runtime",
      threads: 1,
    },
    feature: {
      artifactDigest: digest("a"),
      modelId: "synthetic-body-appearance",
      modelVersionId: "v1",
      scoreSemantics: "unit_interval_similarity",
    },
    licensing: {
      code: "declared",
      model: "unknown",
      trainingData: "unknown",
    },
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
    privacy: {
      externalUpload: "none",
      sourceMedia: "local-read-only",
    },
    provider: {
      providerId: "synthetic-appearance-provider",
      versionId: "v1",
    },
    resources: {
      maxMemoryMiB: 1024,
      maxRuntimeMs: 30_000,
    },
    schemaVersion: bodyContinuityProviderSchemaVersion,
    ...overrides,
  };
  return {
    ...core,
    featureSpaceId: deriveBodyContinuityFeatureSpaceId(core),
    providerConfigDigest: deriveBodyContinuityProviderConfigDigest(core),
  };
};

const assetBinding = (validation) => ({
  assetToken: validation.result.assetToken,
  bodyResultDigest: validation.resultDigest,
  detectorConfigDigest: validation.result.detectorConfigDigest,
  inputRevision: validation.result.inputRevision,
  sourceContentDigest: validation.result.sourceContentDigest,
});

const featureResult = (
  validation,
  featureSpaceId,
  { state = "available" } = {},
) => ({
  binding: assetBinding(validation),
  featureSpaceId,
  observations: validation.result.bodies.map((body, index) => ({
    bodyId: body.bodyId,
    featureDigest:
      state === "available"
        ? recognitionDigest(`${body.bodyId}:feature`)
        : null,
    quality: {
      occlusion: 0.1,
      truncation: 0,
      visibility: Number((0.95 - index * 0.01).toFixed(6)),
    },
    reason:
      state === "available"
        ? "none"
        : state === "missing"
          ? "missing_feature"
          : "provider_abstained",
    state,
  })),
  schemaVersion: bodyContinuityFeatureResultSchemaVersion,
});

const defaultScores = [
  [0.95, 0.2],
  [0.25, 0.94],
];

const comparisonPacket = ({
  contextEvidenceDigest = digest("e"),
  featureSpaces,
  left,
  leftState = "available",
  manifest,
  right,
  rightState = "available",
  runId,
  scores = defaultScores,
} = {}) => {
  const leftFeatureSpace = featureSpaces?.left ?? manifest.featureSpaceId;
  const rightFeatureSpace = featureSpaces?.right ?? manifest.featureSpaceId;
  const leftResult = featureResult(left, leftFeatureSpace, {
    state: leftState,
  });
  const rightResult = featureResult(right, rightFeatureSpace, {
    state: rightState,
  });
  const availableLeft = leftResult.observations.filter(
    (observation) => observation.state === "available",
  );
  const availableRight = rightResult.observations.filter(
    (observation) => observation.state === "available",
  );
  const sameSpace =
    leftFeatureSpace === manifest.featureSpaceId &&
    rightFeatureSpace === manifest.featureSpaceId;
  const comparisons = sameSpace
    ? availableLeft.flatMap((leftObservation, leftIndex) =>
        availableRight.map((rightObservation, rightIndex) => ({
          leftBodyId: leftObservation.bodyId,
          rightBodyId: rightObservation.bodyId,
          similarity: scores[leftIndex]?.[rightIndex] ?? 0,
        })),
      )
    : [];
  const packet = {
    comparisons,
    contextEvidenceDigest,
    contextScope: "capture_context_candidate",
    left: leftResult,
    providerConfigDigest: manifest.providerConfigDigest,
    right: rightResult,
    runId,
    schemaVersion: bodyContinuityComparisonSchemaVersion,
  };
  return {
    ...packet,
    resultDigest: deriveBodyContinuityComparisonResultDigest(packet),
  };
};

const redigest = (packet) => ({
  ...packet,
  resultDigest: deriveBodyContinuityComparisonResultDigest(packet),
});

const fixture = ({
  left = bodyValidation({ assetCharacter: "b" }),
  manifest = providerManifest(),
  right = bodyValidation({ assetCharacter: "c" }),
  firstOptions = {},
  secondOptions = {},
} = {}) => ({
  first: comparisonPacket({
    left,
    manifest,
    right,
    runId: "run_one",
    ...firstOptions,
  }),
  leftBodyValidation: left,
  manifest,
  rightBodyValidation: right,
  second: comparisonPacket({
    left,
    manifest,
    right,
    runId: "run_two",
    ...secondOptions,
  }),
});

test("provider manifest is exact, locally bounded and digest-derived", () => {
  const value = providerManifest();
  const validated = validateBodyContinuityProviderManifest(value);
  assert.equal(validated.execution.network, "forbidden");
  assert.equal(validated.privacy.externalUpload, "none");
  assert.equal(validated.privacy.sourceMedia, "local-read-only");
  assert.match(validated.providerConfigDigest, /^[0-9a-f]{64}$/);
  assert.match(validated.featureSpaceId, /^feature_space_[0-9a-f]{64}$/);
  assert.match(bodyContinuityContractDigest, /^[0-9a-f]{64}$/);
  assert.throws(
    () =>
      validateBodyContinuityProviderManifest({
        ...value,
        providerConfigDigest: digest("f"),
      }),
    /configuration digest does not match/,
  );
});

test("consistent replay derives deterministic anonymous one-to-one edges", () => {
  const input = fixture();
  const validation = validateBodyContinuityComparison(input);
  const receipt = createBodyContinuityValidationReceipt(validation);
  const projection = projectValidatedBodyContinuityEdges(validation);
  const repositoryProjection =
    projectValidatedBodyContinuityForRepository(validation);
  assert.equal(validation.decision.state, "supported");
  assert.equal(validation.edges.length, 2);
  assert.equal(
    receipt.schemaVersion,
    bodyContinuityValidationReceiptSchemaVersion,
  );
  assert.equal(receipt.replay.evidence, "consistent");
  assert.equal(receipt.replay.providerExecutionProof, "none");
  assert.notEqual(input.first.runId, input.second.runId);
  assert.notEqual(input.first.resultDigest, input.second.resultDigest);
  assert.equal(
    receipt.boundary.currentRepositoryRevisionValidation,
    "not_performed",
  );
  assert.equal(receipt.boundary.operationalStaleStateDetection, "none");
  assert.equal(receipt.boundary.providerExecutionProof, "none");
  assert.equal(receipt.boundary.geometryScore, "none");
  assert.equal(receipt.boundary.captureContextScore, "none");
  assert.equal(receipt.nonRepresentative, true);
  assert.equal(receipt.operationalUse, "none");
  assert.equal(projection.edges.length, 2);
  assert.equal(projection.operationalUse, "none");
  assert.equal(repositoryProjection.edges.length, 2);
  assert.equal(
    repositoryProjection.left.resultDigest,
    input.leftBodyValidation.resultDigest,
  );
  assert.equal(
    repositoryProjection.right.resultDigest,
    input.rightBodyValidation.resultDigest,
  );
  assert.equal(
    repositoryProjection.edges.every(
      (edge) =>
        /^body_[0-9a-f]{40}$/.test(edge.leftBodyId) &&
        /^body_[0-9a-f]{40}$/.test(edge.rightBodyId),
    ),
    true,
  );
  assert.throws(() =>
    projectValidatedBodyContinuityForRepository({ ...validation }),
  );
  assert.equal(
    projection.edges.every(
      (edge) =>
        /^[0-9a-f]{64}$/.test(edge.leftObservationToken) &&
        /^[0-9a-f]{64}$/.test(edge.rightObservationToken) &&
        /^[0-9a-f]{64}$/.test(edge.evidenceDigest),
    ),
    true,
  );
  assert.match(receipt.receiptDigest, /^[0-9a-f]{64}$/);
});

test("canonical ordering makes feature and comparison input order irrelevant", () => {
  const input = fixture();
  const first = createBodyContinuityValidationReceipt(
    validateBodyContinuityComparison(input),
  );
  const reversedFirst = redigest({
    ...input.first,
    comparisons: [...input.first.comparisons].reverse(),
    left: {
      ...input.first.left,
      observations: [...input.first.left.observations].reverse(),
    },
    right: {
      ...input.first.right,
      observations: [...input.first.right.observations].reverse(),
    },
  });
  const reversedSecond = redigest({
    ...input.second,
    comparisons: [...input.second.comparisons].reverse(),
    left: {
      ...input.second.left,
      observations: [...input.second.left.observations].reverse(),
    },
    right: {
      ...input.second.right,
      observations: [...input.second.right.observations].reverse(),
    },
  });
  const second = createBodyContinuityValidationReceipt(
    validateBodyContinuityComparison({
      ...input,
      first: reversedFirst,
      second: reversedSecond,
    }),
  );
  assert.deepEqual(second, first);
});

test("a 1x1 comparison reports both missing alternatives and emits no edge", () => {
  const left = bodyValidation({ assetCharacter: "b", bodyCount: 1 });
  const right = bodyValidation({ assetCharacter: "c", bodyCount: 1 });
  const validation = validateBodyContinuityComparison(
    fixture({
      firstOptions: { scores: [[0.99]] },
      left,
      right,
      secondOptions: { scores: [[0.99]] },
    }),
  );
  assert.equal(validation.decision.state, "abstained");
  assert.deepEqual(validation.decision.reasons, [
    "MISSING_ALTERNATIVE_EVIDENCE",
  ]);
  assert.equal(validation.decision.missingAlternativeCount, 2);
  assert.equal(projectValidatedBodyContinuityEdges(validation).edges.length, 0);
});

test("symmetric and near-symmetric evidence abstains instead of inventing continuity", () => {
  const scores = [
    [0.9, 0.9],
    [0.9, 0.9],
  ];
  const validation = validateBodyContinuityComparison(
    fixture({
      firstOptions: { scores },
      secondOptions: { scores },
    }),
  );
  assert.equal(validation.decision.state, "ambiguous");
  assert.equal(validation.decision.ambiguousCount, 4);
  assert.equal(validation.edges.length, 0);
});

test("weak appearance evidence produces no edge", () => {
  const scores = [
    [0.79, 0.1],
    [0.1, 0.78],
  ];
  const validation = validateBodyContinuityComparison(
    fixture({
      firstOptions: { scores },
      secondOptions: { scores },
    }),
  );
  assert.equal(validation.decision.state, "unsupported");
  assert.deepEqual(validation.decision.reasons, ["WEAK_APPEARANCE_EVIDENCE"]);
  assert.equal(validation.edges.length, 0);
});

test("no-body and missing feature evidence remain unavailable", () => {
  const noBodyLeft = bodyValidation({ assetCharacter: "b", bodyCount: 0 });
  const noBody = validateBodyContinuityComparison(
    fixture({ left: noBodyLeft }),
  );
  assert.equal(noBody.decision.state, "unavailable");
  assert.deepEqual(noBody.decision.reasons, ["NO_BODY_EVIDENCE"]);

  const missing = validateBodyContinuityComparison(
    fixture({
      firstOptions: { leftState: "missing", rightState: "missing" },
      secondOptions: { leftState: "missing", rightState: "missing" },
    }),
  );
  assert.equal(missing.decision.state, "unavailable");
  assert.deepEqual(missing.decision.reasons, ["FEATURE_EVIDENCE_UNAVAILABLE"]);
  assert.equal(missing.decision.unavailableFeatureCount, 4);

  const abstained = validateBodyContinuityComparison(
    fixture({
      firstOptions: { leftState: "abstained", rightState: "abstained" },
      secondOptions: { leftState: "abstained", rightState: "abstained" },
    }),
  );
  assert.equal(abstained.decision.state, "unavailable");
  assert.equal(abstained.edges.length, 0);
});

test("capture scope and body geometry bind evidence but contribute zero score", () => {
  const baselineInput = fixture();
  const baseline = projectValidatedBodyContinuityEdges(
    validateBodyContinuityComparison(baselineInput),
  );
  const changedContext = projectValidatedBodyContinuityEdges(
    validateBodyContinuityComparison(
      fixture({
        firstOptions: { contextEvidenceDigest: digest("9") },
        secondOptions: { contextEvidenceDigest: digest("9") },
      }),
    ),
  );
  const movedLeft = bodyValidation({
    assetCharacter: "d",
    bodyCount: 2,
    geometryOffset: 0.03,
  });
  const movedGeometry = projectValidatedBodyContinuityEdges(
    validateBodyContinuityComparison(fixture({ left: movedLeft })),
  );
  for (const projection of [changedContext, movedGeometry]) {
    assert.equal(projection.state, "supported");
    assert.deepEqual(
      projection.edges.map((edge) => edge.similarity).sort(),
      baseline.edges.map((edge) => edge.similarity).sort(),
    );
  }
});

test("cross feature space and detector drift are well-formed abstentions", () => {
  const crossSpaceId = `feature_space_${digest("9")}`;
  const crossSpace = validateBodyContinuityComparison(
    fixture({
      firstOptions: {
        featureSpaces: { left: crossSpaceId, right: crossSpaceId },
      },
      secondOptions: {
        featureSpaces: { left: crossSpaceId, right: crossSpaceId },
      },
    }),
  );
  assert.equal(crossSpace.decision.state, "abstained");
  assert.deepEqual(crossSpace.decision.reasons, ["CROSS_FEATURE_SPACE"]);

  const right = bodyValidation({
    assetCharacter: "c",
    detector: detectorManifest({ modelId: "another-body-detector" }),
  });
  const detectorDrift = validateBodyContinuityComparison(fixture({ right }));
  assert.equal(detectorDrift.decision.state, "abstained");
  assert.deepEqual(detectorDrift.decision.reasons, ["DETECTOR_CONFIG_DRIFT"]);
});

test("replay comparison drift abstains and proves no provider executions", () => {
  const validation = validateBodyContinuityComparison(
    fixture({
      secondOptions: {
        scores: [
          [0.94, 0.2],
          [0.25, 0.94],
        ],
      },
    }),
  );
  const receipt = createBodyContinuityValidationReceipt(validation);
  assert.equal(validation.decision.state, "abstained");
  assert.deepEqual(validation.decision.reasons, ["REPLAY_COMPARISON_DRIFT"]);
  assert.equal(receipt.replay.evidence, "drift");
  assert.equal(receipt.replay.providerExecutionProof, "none");
  assert.equal(receipt.boundary.providerExecution, "none");
});

test("exact envelope revision agreement is enforced without claiming current state", () => {
  const input = fixture();
  const substituted = {
    ...input.first,
    left: {
      ...input.first.left,
      binding: {
        ...input.first.left.binding,
        inputRevision: digest("9"),
      },
    },
  };
  assert.throws(
    () =>
      validateBodyContinuityComparison({
        ...input,
        first: redigest(substituted),
      }),
    /does not match its validated body envelope/,
  );
  const receipt = createBodyContinuityValidationReceipt(
    validateBodyContinuityComparison(input),
  );
  assert.equal(
    receipt.boundary.currentRepositoryRevisionValidation,
    "not_performed",
  );
  assert.equal(receipt.boundary.operationalStaleStateDetection, "none");
});

test("the same asset token is structurally invalid before a receipt exists", () => {
  const left = bodyValidation({ assetCharacter: "b" });
  let receipt;
  assert.throws(
    () => {
      receipt = createBodyContinuityValidationReceipt(
        validateBodyContinuityComparison(fixture({ left, right: left })),
      );
    },
    (error) =>
      error.code === "BODY_CONTINUITY_INPUT_INVALID" &&
      /two distinct assets/.test(error.message),
  );
  assert.equal(receipt, undefined);
});

test("distinct assets with one source observation abstain stably without echoing its digest", () => {
  const sharedSourceContentDigest = digest("9");
  const left = bodyValidation({
    assetCharacter: "b",
    sourceContentDigest: sharedSourceContentDigest,
  });
  const right = bodyValidation({
    assetCharacter: "c",
    sourceContentDigest: sharedSourceContentDigest,
  });
  const input = fixture({ left, right });
  const validation = validateBodyContinuityComparison(input);
  const receipt = createBodyContinuityValidationReceipt(validation);
  const projection = projectValidatedBodyContinuityEdges(validation);
  assert.equal(receipt.decision.state, "abstained");
  assert.deepEqual(receipt.decision.reasons, ["SAME_SOURCE_OBSERVATION"]);
  assert.equal(receipt.replay.evidence, "consistent");
  assert.equal(receipt.replay.providerExecutionProof, "none");
  assert.equal(receipt.decision.supportedEdgeCount, 0);
  assert.equal(projection.state, "abstained");
  assert.deepEqual(projection.reasons, ["SAME_SOURCE_OBSERVATION"]);
  assert.deepEqual(projection.edges, []);
  assert.equal(
    JSON.stringify(receipt).includes(sharedSourceContentDigest),
    false,
  );
  assert.equal(
    JSON.stringify(projection).includes(sharedSourceContentDigest),
    false,
  );

  const reversePacket = (packet) =>
    redigest({
      ...packet,
      comparisons: [...packet.comparisons].reverse(),
      left: {
        ...packet.left,
        observations: [...packet.left.observations].reverse(),
      },
      right: {
        ...packet.right,
        observations: [...packet.right.observations].reverse(),
      },
    });
  const replayed = createBodyContinuityValidationReceipt(
    validateBodyContinuityComparison({
      ...input,
      first: reversePacket(input.first),
      second: reversePacket(input.second),
    }),
  );
  assert.deepEqual(replayed, receipt);
});

test("copied body or continuity envelopes cannot receipt or project", () => {
  const input = fixture();
  const copiedBody = Object.freeze({
    manifest: input.leftBodyValidation.manifest,
    result: input.leftBodyValidation.result,
    resultDigest: input.leftBodyValidation.resultDigest,
  });
  assert.throws(
    () =>
      validateBodyContinuityComparison({
        ...input,
        leftBodyValidation: copiedBody,
      }),
    /validated body result/,
  );

  const validation = validateBodyContinuityComparison(input);
  const copied = Object.freeze({ ...validation });
  const substituted = Object.freeze({
    ...validation,
    manifest: Object.freeze({
      ...validation.manifest,
      providerConfigDigest: digest("9"),
    }),
  });
  for (const forged of [copied, substituted]) {
    let receipt;
    assert.throws(() => {
      receipt = createBodyContinuityValidationReceipt(forged);
    }, /exact validated continuity envelope/);
    assert.equal(receipt, undefined);
    assert.throws(
      () => projectValidatedBodyContinuityEdges(forged),
      /exact validated continuity envelope/,
    );
  }
});

test("matrices, scores and result digests are exact and precision-bounded", () => {
  const input = fixture();
  const incomplete = {
    ...input.first,
    comparisons: input.first.comparisons.slice(0, 3),
  };
  const duplicate = {
    ...input.first,
    comparisons: [
      ...input.first.comparisons.slice(0, 3),
      input.first.comparisons[0],
    ],
  };
  const nonCanonical = {
    ...input.first,
    comparisons: input.first.comparisons.map((comparison, index) =>
      index === 0 ? { ...comparison, similarity: 0.9000001 } : comparison,
    ),
  };
  const outOfRange = {
    ...input.first,
    comparisons: input.first.comparisons.map((comparison, index) =>
      index === 0 ? { ...comparison, similarity: 1.1 } : comparison,
    ),
  };
  for (const packet of [incomplete, duplicate, nonCanonical, outOfRange]) {
    assert.throws(
      () =>
        validateBodyContinuityComparison({
          ...input,
          first: redigest(packet),
        }),
      (error) => error.code === "BODY_CONTINUITY_INPUT_INVALID",
    );
  }
  assert.throws(
    () =>
      validateBodyContinuityComparison({
        ...input,
        first: { ...input.first, resultDigest: digest("9") },
      }),
    /result digest does not match/,
  );
});

test("absolute resource caps and distinct replay identifiers are structural", () => {
  const base = providerManifest();
  for (const policy of [
    { ...base.policy, maximumBodiesPerAsset: 65 },
    { ...base.policy, maximumComparisons: 4097 },
  ]) {
    assert.throws(
      () => providerManifest({ policy }),
      (error) => error.code === "BODY_CONTINUITY_INPUT_INVALID",
    );
  }

  const input = fixture();
  const sameRun = redigest({ ...input.second, runId: input.first.runId });
  assert.throws(
    () => validateBodyContinuityComparison({ ...input, second: sameRun }),
    /distinct public run identifiers/,
  );
});

test("unsupported private, identity, vector and transport fields fail before receipt", () => {
  const input = fixture();
  const adversarial = [
    {
      ...input,
      manifest: { ...input.manifest, downloadUrl: "https://private.invalid" },
    },
    {
      ...input,
      first: { ...input.first, filename: "private.jpg" },
    },
    {
      ...input,
      first: {
        ...input.first,
        left: {
          ...input.first.left,
          observations: input.first.left.observations.map(
            (observation, index) =>
              index === 0
                ? { ...observation, vector: [0.1, 0.2] }
                : observation,
          ),
        },
      },
    },
    {
      ...input,
      second: { ...input.second, identityClaim: digest("9") },
    },
    { ...input, operatorNote: "free form" },
  ];
  for (const value of adversarial) {
    let receipt;
    assert.throws(
      () => {
        receipt = createBodyContinuityValidationReceipt(
          validateBodyContinuityComparison(value),
        );
      },
      (error) => error.code === "BODY_CONTINUITY_INPUT_INVALID",
    );
    assert.equal(receipt, undefined);
  }
});

test("minimized receipt contains no observation, feature or source tokens", () => {
  const input = fixture();
  const validation = validateBodyContinuityComparison(input);
  const receipt = createBodyContinuityValidationReceipt(validation);
  const serialized = JSON.stringify(receipt);
  for (const forbidden of [
    input.leftBodyValidation.result.assetToken,
    input.rightBodyValidation.result.assetToken,
    input.leftBodyValidation.result.sourceContentDigest,
    input.leftBodyValidation.result.bodies[0].bodyId,
    input.first.left.observations[0].featureDigest,
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.equal(receipt.authority.recommendation, "none");
  assert.equal(receipt.authority.activation, "none");
  assert.equal(receipt.authority.training, "none");
  assert.equal(receipt.authority.automaticIdentityAuthority, "none");
  assert.equal(receipt.authority.persistence, "none");
  assert.equal(receipt.boundary.repositoryWrites, "none");
});
