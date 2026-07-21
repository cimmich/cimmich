import {
  manualRecognitionDigest,
  manualRecognitionIntakeVersion,
  validateManualRecognitionIntake,
} from "./manual-recognition-intake.mjs";
import { validateRecognitionProviderManifest } from "./recognition-provider-contract.mjs";

export const localManualFaceRecognitionWorkerVersion =
  "cimmich.local-manual-face-recognition-worker.v1";

const exactObject = (value, keys, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${label} has unsupported or missing fields`);
  }
};

export const prepareManualRecognitionJob = ({
  operation,
  projection,
  manifest,
}) => {
  exactObject(
    operation,
    ["assetId", "faceId", "identityClaimId", "operationId", "region"],
    "operation",
  );
  exactObject(
    projection,
    ["assetId", "immichAssetId", "inputRevision", "sourceId"],
    "projection",
  );
  if (operation.assetId !== projection.assetId) {
    throw new Error("Manual recognition job crosses its asset projection");
  }
  const validatedManifest = validateRecognitionProviderManifest(manifest);
  const regionDigest = manualRecognitionDigest(operation.region);
  const requestCore = {
    assetId: operation.assetId,
    faceId: operation.faceId,
    identityClaimId: operation.identityClaimId,
    immichAssetId: projection.immichAssetId,
    inputRevision: projection.inputRevision,
    operationId: operation.operationId,
    providerConfigDigest: validatedManifest.providerConfigDigest,
    regionDigest,
    sourceId: projection.sourceId,
    vectorSpaceId: validatedManifest.vectorSpaceId,
  };
  return Object.freeze({
    authority: { mediaRead: "not_executed", providerExecution: "not_executed" },
    job: {
      assetId: operation.assetId,
      configDigest: validatedManifest.providerConfigDigest,
      inputRevision: projection.inputRevision,
      maxAttempts: 3,
      operation: "recognize_manual_face",
      toolVersion: localManualFaceRecognitionWorkerVersion,
    },
    manifest: validatedManifest,
    operation: structuredClone(operation),
    projection: structuredClone(projection),
    regionDigest,
    requestDigest: manualRecognitionDigest(requestCore),
    schemaVersion: localManualFaceRecognitionWorkerVersion,
  });
};

export const assembleManualRecognitionIntake = ({
  prepared,
  quality,
  runs,
  sourceContentDigest,
}) => {
  if (prepared?.schemaVersion !== localManualFaceRecognitionWorkerVersion) {
    throw new Error("Manual recognition prepared job is invalid");
  }
  const envelope = validateManualRecognitionIntake({
    manifest: prepared.manifest,
    operation: prepared.operation,
    projection: {
      ...prepared.projection,
      sourceContentDigest,
    },
    quality,
    runs,
    schemaVersion: manualRecognitionIntakeVersion,
  });
  if (
    envelope.requestDigest !== prepared.requestDigest ||
    envelope.regionDigest !== prepared.regionDigest
  ) {
    throw new Error(
      "Manual recognition execution drifted from its prepared job",
    );
  }
  return envelope;
};
