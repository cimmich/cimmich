import { createHash } from "node:crypto";
import {
  assetSimilarityDigest,
  assetSimilarityResultDigest,
  createAssetSimilarityValidationReceipt,
  validateAssetSimilarityContext,
  validateAssetSimilarityEvidence,
  validateAssetSimilarityManifest,
} from "./asset-similarity-contract.mjs";

export const localAssetSimilarityWorkerVersion =
  "cimmich.local-asset-similarity-worker.v1";
export const localAssetSimilarityWorkerReceiptVersion =
  "cimmich.local-asset-similarity-worker-receipt.v1";

const digestPattern = /^[0-9a-f]{64}$/;
const publicIdentifierPattern = /^[a-z0-9](?:[a-z0-9._-]{0,127})$/;
const preparedJobs = new WeakSet();
const preparedBindings = new WeakMap();
const executionEnvelopes = new WeakSet();
const executionBindings = new WeakMap();

const workerError = (code, message) =>
  Object.assign(new Error(message), { code, statusCode: 400 });

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const exactObject = (value, label, keys) => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw workerError(
      "ASSET_SIMILARITY_WORKER_INPUT_INVALID",
      `${label} must be an object`,
    );
  }
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !keys.includes(key))
  ) {
    throw workerError(
      "ASSET_SIMILARITY_WORKER_INPUT_INVALID",
      `${label} must use the exact contract fields`,
    );
  }
  return value;
};

const requiredDigest = (value, label) => {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw workerError(
      "ASSET_SIMILARITY_WORKER_INPUT_INVALID",
      `${label} must be a lowercase SHA-256 digest`,
    );
  }
  return value;
};

const requiredPublicIdentifier = (value, label) => {
  if (typeof value !== "string" || !publicIdentifierPattern.test(value)) {
    throw workerError(
      "ASSET_SIMILARITY_WORKER_INPUT_INVALID",
      `${label} must be a bounded public identifier`,
    );
  }
  return value;
};

const normalizeProjection = (value, label) => {
  exactObject(value, label, [
    "assetToken",
    "immichAssetId",
    "inputRevision",
    "sourceId",
  ]);
  return {
    assetToken: requiredDigest(value.assetToken, `${label}.assetToken`),
    immichAssetId: requiredPublicIdentifier(
      value.immichAssetId,
      `${label}.immichAssetId`,
    ),
    inputRevision: requiredDigest(
      value.inputRevision,
      `${label}.inputRevision`,
    ),
    sourceId: requiredPublicIdentifier(value.sourceId, `${label}.sourceId`),
  };
};

const normalizeProjections = (value) => {
  if (!Array.isArray(value) || value.length !== 2) {
    throw workerError(
      "ASSET_SIMILARITY_WORKER_INPUT_INVALID",
      "projections must contain exactly two assets",
    );
  }
  const projections = value
    .map((projection, index) =>
      normalizeProjection(projection, `projections[${index}]`),
    )
    .sort((left, right) => left.assetToken.localeCompare(right.assetToken));
  if (
    projections[0].assetToken === projections[1].assetToken ||
    projections[0].immichAssetId === projections[1].immichAssetId
  ) {
    throw workerError(
      "ASSET_SIMILARITY_WORKER_INPUT_INVALID",
      "projections must identify two distinct assets",
    );
  }
  if (projections[0].sourceId !== projections[1].sourceId) {
    throw workerError(
      "ASSET_SIMILARITY_WORKER_INPUT_INVALID",
      "projections must use one configured local source",
    );
  }
  return projections;
};

export const prepareAssetSimilarityJob = ({
  context,
  manifest,
  projections,
}) => {
  const validatedManifest = validateAssetSimilarityManifest(manifest);
  const validatedContext = validateAssetSimilarityContext(context);
  const validatedProjections = normalizeProjections(projections);
  const requestDigest = assetSimilarityDigest({
    context: validatedContext,
    projections: validatedProjections,
    providerConfigDigest: validatedManifest.providerConfigDigest,
    schemaVersion: localAssetSimilarityWorkerVersion,
  });
  const prepared = deepFreeze({
    authority: {
      mediaRead: "not_executed",
      providerExecution: "not_executed",
      repositoryWrite: "none",
    },
    providerConfigDigest: validatedManifest.providerConfigDigest,
    requestDigest,
    schemaVersion: localAssetSimilarityWorkerVersion,
  });
  preparedBindings.set(
    prepared,
    deepFreeze({
      context: validatedContext,
      manifest: validatedManifest,
      projections: validatedProjections,
    }),
  );
  preparedJobs.add(prepared);
  return prepared;
};

const requirePrepared = (value) => {
  if (!preparedJobs.has(value) || !preparedBindings.has(value)) {
    throw workerError(
      "ASSET_SIMILARITY_WORKER_PREPARED_INVALID",
      "An exact prepared asset-similarity job is required",
    );
  }
  return preparedBindings.get(value);
};

const assertInterfaces = ({ companion, provider }, manifest) => {
  if (
    typeof companion?.readAssetImage !== "function" ||
    typeof companion?.getAsset !== "function" ||
    typeof provider?.compare !== "function" ||
    provider?.manifest?.providerConfigDigest !== manifest.providerConfigDigest
  ) {
    throw workerError(
      "ASSET_SIMILARITY_WORKER_CONFIG_INVALID",
      "Worker companion or provider configuration is invalid",
    );
  }
};

const validateRead = (media, projection) => {
  if (
    media == null ||
    typeof media !== "object" ||
    !Buffer.isBuffer(media.bytes) ||
    !media.bytes.length ||
    media.sourceAccess !== "immich-api-read-only" ||
    media.asset?.immichAssetId !== projection.immichAssetId ||
    media.asset?.inputRevision !== projection.inputRevision
  ) {
    throw workerError(
      "ASSET_SIMILARITY_WORKER_STALE",
      "Local media read does not match its prepared asset revision",
    );
  }
  const contentDigest = requiredDigest(
    media.contentDigest,
    "media.contentDigest",
  );
  if (
    createHash("sha256").update(media.bytes).digest("hex") !== contentDigest
  ) {
    throw workerError(
      "ASSET_SIMILARITY_WORKER_SOURCE_DRIFT",
      "Local media bytes do not match their source digest",
    );
  }
  return { bytes: media.bytes, contentDigest };
};

const assertCurrent = (current, projection) => {
  if (
    current?.asset?.immichAssetId !== projection.immichAssetId ||
    current?.asset?.inputRevision !== projection.inputRevision
  ) {
    throw workerError(
      "ASSET_SIMILARITY_WORKER_STALE",
      "Asset revision changed during local similarity execution",
    );
  }
};

export const executeAssetSimilarityJob = async ({
  companion,
  prepared,
  provider,
}) => {
  const binding = requirePrepared(prepared);
  assertInterfaces({ companion, provider }, binding.manifest);
  const media = await Promise.all(
    binding.projections.map((projection) =>
      companion.readAssetImage({ assetId: projection.immichAssetId }),
    ),
  );
  const reads = media.map((item, index) =>
    validateRead(item, binding.projections[index]),
  );
  const assets = binding.projections.map((projection, index) => ({
    assetToken: projection.assetToken,
    inputRevision: projection.inputRevision,
    sourceContentDigest: reads[index].contentDigest,
  }));
  const runId = (index) =>
    `run-${index}-${assetSimilarityDigest({
      index,
      requestDigest: prepared.requestDigest,
    }).slice(0, 40)}`;
  const compare = (index) =>
    provider.compare({
      assets,
      leftBytes: reads[0].bytes,
      rightBytes: reads[1].bytes,
      runId: runId(index),
    });
  const runs = [await compare(1), await compare(2)];
  const current = await Promise.all(
    binding.projections.map((projection) =>
      companion.getAsset({ assetId: projection.immichAssetId }),
    ),
  );
  current.forEach((item, index) =>
    assertCurrent(item, binding.projections[index]),
  );
  const validation = validateAssetSimilarityEvidence({
    assets,
    context: binding.context,
    manifest: binding.manifest,
    runs,
  });
  const contractReceipt = createAssetSimilarityValidationReceipt(validation);
  const publicCore = {
    contractReceiptDigest: contractReceipt.receiptDigest,
    disposition: validation.disposition,
    envelopeDigest: validation.envelopeDigest,
    providerConfigDigest: validation.providerConfigDigest,
    replayEvidence: validation.replayEvidence,
    requestDigest: prepared.requestDigest,
    schemaVersion: localAssetSimilarityWorkerVersion,
  };
  const execution = deepFreeze({
    ...publicCore,
    executionDigest: assetSimilarityDigest(publicCore),
  });
  executionBindings.set(execution, deepFreeze({ contractReceipt, validation }));
  executionEnvelopes.add(execution);
  return execution;
};

export const createAssetSimilarityWorkerReceipt = (execution) => {
  if (!executionEnvelopes.has(execution) || !executionBindings.has(execution)) {
    throw workerError(
      "ASSET_SIMILARITY_WORKER_EXECUTION_INVALID",
      "An exact asset-similarity execution envelope is required",
    );
  }
  const binding = executionBindings.get(execution);
  const receipt = {
    authority: {
      acceptedTruthMutation: "none",
      automaticIdentityAuthority: "none",
      providerExecutionAuthority: "none",
      recommendation: "none",
      repositoryWrite: "none",
      training: "none",
    },
    boundary: {
      externalUpload: "none",
      providerExecutionProof: "none",
      providerProcessInvocations: 2,
      sourceMediaReadPerformed: "immich-api-read-only",
      sourceWrite: "none",
    },
    contractReceiptDigest: binding.contractReceipt.receiptDigest,
    disposition: execution.disposition,
    executionDigest: execution.executionDigest,
    providerConfigDigest: execution.providerConfigDigest,
    replayEvidence: execution.replayEvidence,
    requestDigest: execution.requestDigest,
    schemaVersion: localAssetSimilarityWorkerReceiptVersion,
  };
  return deepFreeze({
    ...receipt,
    receiptDigest: assetSimilarityDigest(receipt),
  });
};
