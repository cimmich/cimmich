import { createHash } from "node:crypto";
import { projectValidatedBodyResultForRepository } from "./body-detector-contract.mjs";
import { consumeCurrentBodyPoseProjection } from "./body-pose-current-projection.mjs";
import {
  bodyPoseDigest,
  bodyPoseEvaluationSchemaVersion,
  createBodyPoseReceipt,
  projectValidatedBodyPoseForRepository,
  validateBodyPoseEvidence,
  validateBodyPoseManifest,
} from "./body-pose-provider-contract.mjs";

export const localBodyPoseWorkerSchemaVersion =
  "cimmich.local-body-pose-worker.v1";
export const localBodyPoseWorkerReceiptSchemaVersion =
  "cimmich.local-body-pose-worker-receipt.v1";

const digestPattern = /^[0-9a-f]{64}$/;
const privateIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const preparedJobs = new WeakSet();
const preparedBindings = new WeakMap();
const executionEnvelopes = new WeakSet();
const executionBindings = new WeakMap();

const workerError = (code, message, statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const exactObject = (value, keys, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw workerError(
      "LOCAL_BODY_POSE_WORKER_INPUT_INVALID",
      `${label} must be an object`,
    );
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw workerError(
      "LOCAL_BODY_POSE_WORKER_INPUT_INVALID",
      `${label} fields are invalid`,
    );
  }
};

const requiredPrivateId = (value, label) => {
  if (typeof value !== "string" || !privateIdPattern.test(value)) {
    throw workerError(
      "LOCAL_BODY_POSE_WORKER_INPUT_INVALID",
      `${label} is invalid`,
    );
  }
  return value;
};

const requiredDigest = (value, label) => {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw workerError(
      "LOCAL_BODY_POSE_WORKER_INPUT_INVALID",
      `${label} must be a lowercase SHA-256 digest`,
    );
  }
  return value;
};

export const prepareLocalBodyPoseJob = ({
  assetId,
  bodyValidation,
  manifest,
  projection,
}) => {
  const normalizedAssetId = requiredPrivateId(assetId, "assetId");
  exactObject(projection, ["assetId", "inputRevision"], "projection");
  if (
    requiredPrivateId(projection.assetId, "projection.assetId") !==
    normalizedAssetId
  ) {
    throw workerError(
      "LOCAL_BODY_POSE_WORKER_INPUT_INVALID",
      "Body-pose job crosses its asset projection",
    );
  }
  const inputRevision = requiredDigest(
    projection.inputRevision,
    "projection.inputRevision",
  );
  const validatedManifest = validateBodyPoseManifest(manifest);
  const bodyResult = projectValidatedBodyResultForRepository(bodyValidation);
  if (bodyResult.inputRevision !== inputRevision) {
    throw workerError(
      "LOCAL_BODY_POSE_WORKER_STALE",
      "Validated Body evidence uses another asset revision",
      409,
    );
  }
  const requestDigest = bodyPoseDigest({
    assetId: normalizedAssetId,
    bodyResultDigest: bodyResult.resultDigest,
    inputRevision,
    poseConfigDigest: validatedManifest.poseConfigDigest,
    schemaVersion: localBodyPoseWorkerSchemaVersion,
  });
  const prepared = deepFreeze({
    authority: {
      databaseWrite: "not_executed",
      identity: "none",
      mediaRead: "not_executed",
      providerExecution: "not_executed",
    },
    bodyResultDigest: bodyResult.resultDigest,
    poseConfigDigest: validatedManifest.poseConfigDigest,
    requestDigest,
    schemaVersion: localBodyPoseWorkerSchemaVersion,
  });
  preparedBindings.set(
    prepared,
    deepFreeze({
      assetId: normalizedAssetId,
      bodyResult,
      bodyValidation,
      inputRevision,
      manifest: validatedManifest,
    }),
  );
  preparedJobs.add(prepared);
  return prepared;
};

export const prepareLocalBodyPoseJobFromCurrent = ({ current, manifest }) => {
  const binding = consumeCurrentBodyPoseProjection(current);
  return prepareLocalBodyPoseJob({
    assetId: binding.assetId,
    bodyValidation: binding.validation,
    manifest,
    projection: {
      assetId: binding.assetId,
      inputRevision: binding.validation.result.inputRevision,
    },
  });
};

const requirePrepared = (value) => {
  if (!preparedJobs.has(value) || !preparedBindings.has(value)) {
    throw workerError(
      "LOCAL_BODY_POSE_WORKER_PREPARED_INVALID",
      "An exact prepared Body-pose job is required",
    );
  }
  return preparedBindings.get(value);
};

const assertInterfaces = ({ companion, provider }, manifest) => {
  if (
    typeof companion?.readAssetImage !== "function" ||
    typeof companion?.getAsset !== "function" ||
    typeof provider?.detect !== "function" ||
    provider?.manifest?.poseConfigDigest !== manifest.poseConfigDigest
  ) {
    throw workerError(
      "LOCAL_BODY_POSE_WORKER_CONFIG_INVALID",
      "Worker companion or provider configuration is invalid",
    );
  }
};

const validateMediaRead = (media, binding) => {
  if (
    !media ||
    typeof media !== "object" ||
    !Buffer.isBuffer(media.bytes) ||
    media.bytes.length === 0 ||
    !["immich-api-read-only", "operator-local-read-only"].includes(
      media.sourceAccess,
    ) ||
    media.asset?.immichAssetId !== binding.assetId ||
    media.asset?.inputRevision !== binding.inputRevision
  ) {
    throw workerError(
      "LOCAL_BODY_POSE_WORKER_STALE",
      "Local media read does not match the prepared asset revision",
      409,
    );
  }
  const contentDigest = requiredDigest(
    media.contentDigest,
    "media.contentDigest",
  );
  if (
    createHash("sha256").update(media.bytes).digest("hex") !== contentDigest ||
    contentDigest !== binding.bodyResult.sourceContentDigest
  ) {
    throw workerError(
      "LOCAL_BODY_POSE_WORKER_SOURCE_DRIFT",
      "Local media bytes do not match the validated Body source",
      409,
    );
  }
  return {
    bytes: media.bytes,
    contentDigest,
    sourceAccess: media.sourceAccess,
  };
};

const assertCurrent = (current, binding) => {
  if (
    current?.asset?.immichAssetId !== binding.assetId ||
    current?.asset?.inputRevision !== binding.inputRevision
  ) {
    throw workerError(
      "LOCAL_BODY_POSE_WORKER_STALE",
      "Asset revision changed during local pose execution",
      409,
    );
  }
};

export const executeLocalBodyPoseJob = async ({
  companion,
  policy,
  prepared,
  provider,
}) => {
  const binding = requirePrepared(prepared);
  assertInterfaces({ companion, provider }, binding.manifest);
  const media = validateMediaRead(
    await companion.readAssetImage({ assetId: binding.assetId }),
    binding,
  );
  const runId = (index) =>
    `run-${index}-${bodyPoseDigest({ index, requestDigest: prepared.requestDigest }).slice(0, 40)}`;
  const detect = (index) =>
    provider.detect({
      assetToken: binding.bodyResult.assetToken,
      bytes: media.bytes,
      inputRevision: binding.inputRevision,
      runId: runId(index),
      sourceContentDigest: media.contentDigest,
    });
  const runs = [await detect(1), await detect(2)];
  assertCurrent(
    await companion.getAsset({ assetId: binding.assetId }),
    binding,
  );
  const validation = validateBodyPoseEvidence({
    bodyValidation: binding.bodyValidation,
    manifest: binding.manifest,
    policy,
    runs,
    schemaVersion: bodyPoseEvaluationSchemaVersion,
  });
  const contractReceipt = createBodyPoseReceipt(validation);
  const repositoryProjection =
    validation.replayEvidence === "consistent"
      ? projectValidatedBodyPoseForRepository(validation)
      : null;
  const core = {
    contractReceiptDigest: contractReceipt.receiptDigest,
    disposition: contractReceipt.decision.status,
    poseConfigDigest: binding.manifest.poseConfigDigest,
    replayEvidence: validation.replayEvidence,
    requestDigest: prepared.requestDigest,
    schemaVersion: localBodyPoseWorkerSchemaVersion,
    sourceAccess: media.sourceAccess,
  };
  const execution = deepFreeze({
    ...core,
    executionDigest: bodyPoseDigest(core),
  });
  executionBindings.set(
    execution,
    deepFreeze({ contractReceipt, repositoryProjection, validation }),
  );
  executionEnvelopes.add(execution);
  return execution;
};

const requireExecution = (value) => {
  if (!executionEnvelopes.has(value) || !executionBindings.has(value)) {
    throw workerError(
      "LOCAL_BODY_POSE_WORKER_EXECUTION_INVALID",
      "An exact Body-pose execution envelope is required",
    );
  }
  return executionBindings.get(value);
};

export const createLocalBodyPoseWorkerReceipt = (execution) => {
  const binding = requireExecution(execution);
  const core = {
    authority: {
      activation: "none",
      automaticIdentityAuthority: "none",
      databaseWrite: "none",
      recommendation: "none",
      training: "none",
    },
    boundary: {
      externalUpload: "none",
      immichWrite: "none",
      mediaRead: execution.sourceAccess,
      mediaWrite: "none",
      providerProcessInvocations: 2,
    },
    contractReceiptDigest: binding.contractReceipt.receiptDigest,
    disposition: execution.disposition,
    executionDigest: execution.executionDigest,
    poseConfigDigest: execution.poseConfigDigest,
    replayEvidence: execution.replayEvidence,
    requestDigest: execution.requestDigest,
    schemaVersion: localBodyPoseWorkerReceiptSchemaVersion,
  };
  return deepFreeze({ ...core, receiptDigest: bodyPoseDigest(core) });
};

export const projectLocalBodyPoseForRepository = (execution) => {
  const binding = requireExecution(execution);
  if (!binding.repositoryProjection) {
    throw workerError(
      "LOCAL_BODY_POSE_WORKER_REPLAY_DRIFT",
      "Body-pose repository projection requires exact replay",
    );
  }
  return binding.repositoryProjection;
};

export const consumeLocalBodyPoseValidation = (execution) =>
  requireExecution(execution).validation;
