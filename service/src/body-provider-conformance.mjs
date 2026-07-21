import {
  bodyDetectionContractDigest,
  bodyDetectionDigest,
  createBodyDetectionValidationReceipt,
  validateBodyDetectionResult,
} from "./body-detector-contract.mjs";

export const bodyProviderConformanceEvaluationSchemaVersion =
  "cimmich.body-provider-conformance-evaluation.v1";
export const bodyProviderConformanceReceiptSchemaVersion =
  "cimmich.body-provider-conformance-receipt.v1";

const publicIdentifierPattern = /^[a-z0-9](?:[a-z0-9._-]{0,63})$/;
const validatedConformanceEnvelopes = new WeakSet();
const conformanceResultValidations = new WeakMap();

const typedError = (message) =>
  Object.assign(new Error(message), {
    code: "BODY_PROVIDER_CONFORMANCE_INPUT_INVALID",
    statusCode: 400,
  });

const exactObject = (value, label, allowedKeys) => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw typedError(`${label} must be an object`);
  }
  const keys = Object.keys(value);
  if (
    keys.length !== allowedKeys.length ||
    keys.some((key) => !allowedKeys.includes(key))
  ) {
    throw typedError(`${label} fields are invalid`);
  }
  return value;
};

const requiredPublicIdentifier = (value, label) => {
  if (typeof value !== "string" || !publicIdentifierPattern.test(value)) {
    throw typedError(
      `${label} must be a 1-64 character lowercase public identifier`,
    );
  }
  return value;
};

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const normalizeRun = (value, label, manifest) => {
  exactObject(value, label, ["result", "runId"]);
  const runId = requiredPublicIdentifier(value.runId, `${label}.runId`);
  const validation = validateBodyDetectionResult(value.result, manifest);
  const minimized = createBodyDetectionValidationReceipt(validation);
  return deepFreeze({
    observationCount: minimized.observationCount,
    resultDigest: minimized.resultDigest,
    runId,
    state: minimized.state,
    validation,
  });
};

const assertSameInputBinding = (left, right) => {
  const leftResult = left.validation.result;
  const rightResult = right.validation.result;
  if (
    leftResult.assetToken !== rightResult.assetToken ||
    leftResult.detectorConfigDigest !== rightResult.detectorConfigDigest ||
    leftResult.inputRevision !== rightResult.inputRevision ||
    leftResult.sourceContentDigest !== rightResult.sourceContentDigest
  ) {
    throw typedError(
      "Replay packets must bind the exact same anonymous input revision",
    );
  }
};

export const bodyProviderConformanceContractDigest = bodyDetectionDigest({
  bodyDetectionContractDigest,
  evaluationSchemaVersion: bodyProviderConformanceEvaluationSchemaVersion,
  receiptSchemaVersion: bodyProviderConformanceReceiptSchemaVersion,
});

export const validateBodyProviderConformance = (value) => {
  exactObject(value, "input", ["first", "manifest", "schemaVersion", "second"]);
  if (value.schemaVersion !== bodyProviderConformanceEvaluationSchemaVersion) {
    throw typedError(
      `Body provider conformance input must use ${bodyProviderConformanceEvaluationSchemaVersion}`,
    );
  }

  const first = normalizeRun(value.first, "first", value.manifest);
  const second = normalizeRun(value.second, "second", value.manifest);
  if (first.runId === second.runId) {
    throw typedError("Replay packets require distinct public run identifiers");
  }
  assertSameInputBinding(first, second);

  const orderedRuns = [first, second].sort((left, right) =>
    left.runId.localeCompare(right.runId),
  );
  const replayEvidence =
    first.resultDigest === second.resultDigest ? "consistent" : "drift";
  const envelope = deepFreeze({
    detectorArtifactDigest: first.validation.manifest.detector.artifactDigest,
    detectorConfigDigest: first.validation.manifest.detectorConfigDigest,
    evidenceDigest: bodyDetectionDigest(
      orderedRuns.map(({ resultDigest, runId }) => ({ resultDigest, runId })),
    ),
    replayEvidence,
    runs: orderedRuns.map(({ observationCount, resultDigest, state }) => ({
      observationCount,
      resultDigest,
      state,
    })),
  });
  validatedConformanceEnvelopes.add(envelope);
  conformanceResultValidations.set(
    envelope,
    replayEvidence === "consistent" ? first.validation : null,
  );
  return envelope;
};

const requireValidatedEnvelope = (value) => {
  if (
    value == null ||
    typeof value !== "object" ||
    !validatedConformanceEnvelopes.has(value)
  ) {
    throw typedError(
      "An exact validated provider conformance envelope is required",
    );
  }
  return value;
};

export const createBodyProviderConformanceReceipt = (input) => {
  const validation = requireValidatedEnvelope(input);
  const receipt = {
    authority: {
      activation: "none",
      automaticIdentityAuthority: "none",
      recommendation: "none",
      training: "none",
    },
    binding: {
      contractDigest: bodyProviderConformanceContractDigest,
      detectorArtifactDigest: validation.detectorArtifactDigest,
      detectorConfigDigest: validation.detectorConfigDigest,
      evidenceDigest: validation.evidenceDigest,
      resultDigests: validation.runs.map((run) => run.resultDigest),
    },
    boundary: {
      databaseWrites: "none",
      externalNetwork: "none",
      identityWrites: "none",
      immichWrites: "none",
      licenceRightsInference: "none",
      mediaReads: "none",
      mediaWrites: "none",
      persistence: "none",
      providerExecution: "none",
      providerExecutionProof: "none",
    },
    decision: {
      reasons:
        validation.replayEvidence === "consistent"
          ? []
          : ["RESULT_REPLAY_DRIFT"],
      status:
        validation.replayEvidence === "consistent"
          ? "replay_consistent"
          : "replay_drift",
    },
    replay: {
      evidence: validation.replayEvidence,
      packetCount: 2,
      providerExecutionProof: "none",
    },
    runs: validation.runs,
    schemaVersion: bodyProviderConformanceReceiptSchemaVersion,
  };
  return deepFreeze({
    ...receipt,
    receiptDigest: bodyDetectionDigest(receipt),
  });
};

export const projectReplayConsistentBodyProviderResult = (input) => {
  const validation = requireValidatedEnvelope(input);
  if (validation.replayEvidence !== "consistent") {
    throw typedError(
      "Body provider result projection requires replay-consistent evidence",
    );
  }
  const resultValidation = conformanceResultValidations.get(validation);
  if (!resultValidation) {
    throw typedError(
      "Body provider result projection is missing its exact validation",
    );
  }
  return resultValidation;
};
