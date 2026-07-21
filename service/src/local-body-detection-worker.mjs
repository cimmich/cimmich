import {
  bodyDetectionDigest,
  projectValidatedBodyResultForRepository,
  validateBodyDetectorManifest,
} from "./body-detector-contract.mjs";
import {
  bodyProviderConformanceEvaluationSchemaVersion,
  projectReplayConsistentBodyProviderResult,
  validateBodyProviderConformance,
} from "./body-provider-conformance.mjs";
import { deriveRepositoryBodyAssetToken } from "./body-detection-result-repository.mjs";
import { consumeValidatedAssetSourceRead } from "./asset-source-revision.mjs";

export const localBodyDetectionWorkerVersion =
  "cimmich.local-body-detection-worker.v1";

const privateIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const digestPattern = /^[0-9a-f]{64}$/;
const preparedJobs = new WeakSet();

const typedError = (message) =>
  Object.assign(new Error(message), {
    code: "LOCAL_BODY_DETECTION_WORKER_INPUT_INVALID",
    statusCode: 400,
  });

const exactObject = (value, keys, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw typedError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw typedError(`${label} fields are invalid`);
  }
};

const requiredPrivateId = (value, label) => {
  if (typeof value !== "string" || !privateIdPattern.test(value)) {
    throw typedError(`${label} is invalid`);
  }
  return value;
};

const requiredDigest = (value, label) => {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw typedError(`${label} must be a lowercase SHA-256 digest`);
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

const issuePreparedJob = ({
  assetId,
  manifest,
  projection,
  sourceContentDigest = null,
}) => {
  const normalizedAssetId = requiredPrivateId(assetId, "assetId");
  exactObject(projection, ["assetId", "inputRevision"], "projection");
  if (
    requiredPrivateId(projection.assetId, "projection.assetId") !==
    normalizedAssetId
  ) {
    throw typedError("Body detection job crosses its asset projection");
  }
  const inputRevision = requiredDigest(
    projection.inputRevision,
    "projection.inputRevision",
  );
  const validatedManifest = validateBodyDetectorManifest(manifest);
  const assetToken = deriveRepositoryBodyAssetToken({
    assetId: normalizedAssetId,
    detectorConfigDigest: validatedManifest.detectorConfigDigest,
    inputRevision,
  });
  const prepared = deepFreeze({
    assetId: normalizedAssetId,
    assetToken,
    authority: {
      databaseWrite: "not_executed",
      identity: "none",
      mediaRead: "not_executed",
      providerExecution: "not_executed",
    },
    detectorConfigDigest: validatedManifest.detectorConfigDigest,
    inputRevision,
    manifest: validatedManifest,
    requestDigest: bodyDetectionDigest({
      assetId: normalizedAssetId,
      assetToken,
      detectorConfigDigest: validatedManifest.detectorConfigDigest,
      inputRevision,
      schemaVersion: localBodyDetectionWorkerVersion,
    }),
    schemaVersion: localBodyDetectionWorkerVersion,
    sourceContentDigest,
  });
  preparedJobs.add(prepared);
  return prepared;
};

export const prepareLocalBodyDetectionJob = (input) => issuePreparedJob(input);

export const prepareLocalBodyDetectionJobFromSourceRead = ({
  manifest,
  sourceRead,
}) => {
  const source = consumeValidatedAssetSourceRead(sourceRead);
  return issuePreparedJob({
    assetId: source.assetId,
    manifest,
    projection: {
      assetId: source.assetId,
      inputRevision: source.inputRevision,
    },
    sourceContentDigest: source.sourceContentDigest,
  });
};

export const assembleLocalBodyDetectionResult = ({
  prepared,
  runs,
  sourceContentDigest,
}) => {
  if (!preparedJobs.has(prepared)) {
    throw typedError("An exact prepared Body detection job is required");
  }
  if (!Array.isArray(runs) || runs.length !== 2) {
    throw typedError("Body detection assembly requires exactly two runs");
  }
  const sourceDigest = requiredDigest(
    sourceContentDigest,
    "sourceContentDigest",
  );
  if (
    prepared.sourceContentDigest &&
    prepared.sourceContentDigest !== sourceDigest
  ) {
    throw typedError("Body detection source read changed after preparation");
  }
  const conformance = validateBodyProviderConformance({
    first: runs[0],
    manifest: prepared.manifest,
    schemaVersion: bodyProviderConformanceEvaluationSchemaVersion,
    second: runs[1],
  });
  const validation = projectReplayConsistentBodyProviderResult(conformance);
  const projected = projectValidatedBodyResultForRepository(validation);
  if (
    projected.assetToken !== prepared.assetToken ||
    projected.detectorConfigDigest !== prepared.detectorConfigDigest ||
    projected.inputRevision !== prepared.inputRevision ||
    projected.sourceContentDigest !== sourceDigest
  ) {
    throw typedError("Body detection result drifted from its prepared job");
  }
  return validation;
};
