import { createHash } from "node:crypto";
import { projectValidatedBodyResultForRepository } from "./body-detector-contract.mjs";
import { consumeCurrentBodyPoseProjection } from "./body-pose-current-projection.mjs";
import {
  bodyMaskDigest,
  bodyMaskEvaluationSchemaVersion,
  createBodyMaskReceipt,
  projectValidatedBodyMasks,
  validateBodyMaskEvidence,
  validateBodyMaskManifest,
} from "./body-mask-provider-contract.mjs";

export const localBodyMaskWorkerSchemaVersion =
  "cimmich.local-body-mask-worker.v1";
export const localBodyMaskWorkerReceiptSchemaVersion =
  "cimmich.local-body-mask-worker-receipt.v1";

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

const requiredPrivateId = (value, label) => {
  if (typeof value !== "string" || !privateIdPattern.test(value))
    throw workerError(
      "LOCAL_BODY_MASK_WORKER_INPUT_INVALID",
      `${label} is invalid`,
    );
  return value;
};

const requiredDigest = (value, label) => {
  if (typeof value !== "string" || !digestPattern.test(value))
    throw workerError(
      "LOCAL_BODY_MASK_WORKER_INPUT_INVALID",
      `${label} must be a lowercase SHA-256 digest`,
    );
  return value;
};

export const prepareLocalBodyMaskJob = ({
  assetId,
  bodyValidation,
  manifest,
  projection,
}) => {
  const normalizedAssetId = requiredPrivateId(assetId, "assetId");
  if (
    !projection ||
    Object.keys(projection).sort().join(",") !== "assetId,inputRevision" ||
    requiredPrivateId(projection.assetId, "projection.assetId") !==
      normalizedAssetId
  )
    throw workerError(
      "LOCAL_BODY_MASK_WORKER_INPUT_INVALID",
      "Body-mask job crosses its asset projection",
    );
  const inputRevision = requiredDigest(
    projection.inputRevision,
    "projection.inputRevision",
  );
  const validatedManifest = validateBodyMaskManifest(manifest);
  const bodyResult = projectValidatedBodyResultForRepository(bodyValidation);
  if (bodyResult.inputRevision !== inputRevision)
    throw workerError(
      "LOCAL_BODY_MASK_WORKER_STALE",
      "Validated Body evidence uses another asset revision",
      409,
    );
  const requestDigest = bodyMaskDigest({
    assetId: normalizedAssetId,
    bodyResultDigest: bodyResult.resultDigest,
    inputRevision,
    maskConfigDigest: validatedManifest.maskConfigDigest,
    schemaVersion: localBodyMaskWorkerSchemaVersion,
  });
  const prepared = deepFreeze({
    authority: {
      countAuthority: "none",
      databaseWrite: "not_executed",
      identity: "none",
      mediaRead: "not_executed",
      providerExecution: "not_executed",
    },
    bodyResultDigest: bodyResult.resultDigest,
    maskConfigDigest: validatedManifest.maskConfigDigest,
    requestDigest,
    schemaVersion: localBodyMaskWorkerSchemaVersion,
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

export const prepareLocalBodyMaskJobFromCurrent = ({ current, manifest }) => {
  const binding = consumeCurrentBodyPoseProjection(current);
  return prepareLocalBodyMaskJob({
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
  if (!preparedJobs.has(value) || !preparedBindings.has(value))
    throw workerError(
      "LOCAL_BODY_MASK_WORKER_PREPARED_INVALID",
      "An exact prepared Body-mask job is required",
    );
  return preparedBindings.get(value);
};

export const executeLocalBodyMaskJob = async ({
  companion,
  prepared,
  provider,
}) => {
  const binding = requirePrepared(prepared);
  if (
    typeof companion?.readAssetImage !== "function" ||
    typeof companion?.getAsset !== "function" ||
    typeof provider?.detect !== "function" ||
    provider?.manifest?.maskConfigDigest !== binding.manifest.maskConfigDigest
  )
    throw workerError(
      "LOCAL_BODY_MASK_WORKER_CONFIG_INVALID",
      "Worker companion or provider configuration is invalid",
    );
  const media = await companion.readAssetImage({ assetId: binding.assetId });
  if (
    !media ||
    !Buffer.isBuffer(media.bytes) ||
    !media.bytes.length ||
    !["immich-api-read-only", "operator-local-read-only"].includes(
      media.sourceAccess,
    ) ||
    media.asset?.immichAssetId !== binding.assetId ||
    media.asset?.inputRevision !== binding.inputRevision
  )
    throw workerError(
      "LOCAL_BODY_MASK_WORKER_STALE",
      "Local media read does not match the prepared asset revision",
      409,
    );
  const contentDigest = requiredDigest(
    media.contentDigest,
    "media.contentDigest",
  );
  if (
    createHash("sha256").update(media.bytes).digest("hex") !== contentDigest ||
    contentDigest !== binding.bodyResult.sourceContentDigest
  )
    throw workerError(
      "LOCAL_BODY_MASK_WORKER_SOURCE_DRIFT",
      "Local media bytes do not match the validated Body source",
      409,
    );
  const prompts = binding.bodyResult.bodies.map(({ bodyId, box }) => ({
    bodyId,
    box,
  }));
  const runId = (index) =>
    `run-${index}-${bodyMaskDigest({ index, requestDigest: prepared.requestDigest }).slice(0, 40)}`;
  const detect = (index) =>
    provider.detect({
      assetToken: binding.bodyResult.assetToken,
      bodyResultDigest: binding.bodyResult.resultDigest,
      bytes: media.bytes,
      inputRevision: binding.inputRevision,
      prompts,
      runId: runId(index),
      sourceContentDigest: contentDigest,
    });
  const runs = [await detect(1), await detect(2)];
  const current = await companion.getAsset({ assetId: binding.assetId });
  if (
    current?.asset?.immichAssetId !== binding.assetId ||
    current?.asset?.inputRevision !== binding.inputRevision
  )
    throw workerError(
      "LOCAL_BODY_MASK_WORKER_STALE",
      "Asset revision changed during local Body-mask execution",
      409,
    );
  const validation = validateBodyMaskEvidence({
    bodyValidation: binding.bodyValidation,
    manifest: binding.manifest,
    runs,
    schemaVersion: bodyMaskEvaluationSchemaVersion,
  });
  const contractReceipt = createBodyMaskReceipt(validation);
  const projection =
    validation.replayEvidence === "consistent"
      ? projectValidatedBodyMasks(validation)
      : null;
  const core = {
    contractReceiptDigest: contractReceipt.receiptDigest,
    disposition: validation.status,
    maskConfigDigest: binding.manifest.maskConfigDigest,
    replayEvidence: validation.replayEvidence,
    requestDigest: prepared.requestDigest,
    schemaVersion: localBodyMaskWorkerSchemaVersion,
    sourceAccess: media.sourceAccess,
  };
  const execution = deepFreeze({
    ...core,
    executionDigest: bodyMaskDigest(core),
  });
  executionBindings.set(
    execution,
    deepFreeze({ contractReceipt, projection, validation }),
  );
  executionEnvelopes.add(execution);
  return execution;
};

const requireExecution = (value) => {
  if (!executionEnvelopes.has(value) || !executionBindings.has(value))
    throw workerError(
      "LOCAL_BODY_MASK_WORKER_EXECUTION_INVALID",
      "An exact Body-mask execution envelope is required",
    );
  return executionBindings.get(value);
};

export const createLocalBodyMaskWorkerReceipt = (execution) => {
  const binding = requireExecution(execution);
  const core = {
    authority: {
      activation: "none",
      automaticIdentityAuthority: "none",
      countAuthority: "none",
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
    maskConfigDigest: execution.maskConfigDigest,
    replayEvidence: execution.replayEvidence,
    requestDigest: execution.requestDigest,
    schemaVersion: localBodyMaskWorkerReceiptSchemaVersion,
  };
  return deepFreeze({ ...core, receiptDigest: bodyMaskDigest(core) });
};

export const projectLocalBodyMasks = (execution) => {
  const binding = requireExecution(execution);
  if (!binding.projection)
    throw workerError(
      "LOCAL_BODY_MASK_WORKER_REPLAY_DRIFT",
      "Body-mask projection requires exact replay",
    );
  return binding.projection;
};

export const consumeLocalBodyMaskValidation = (execution) =>
  requireExecution(execution).validation;
