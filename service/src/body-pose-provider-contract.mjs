import { createHash } from "node:crypto";
import { projectValidatedBodyResultForRepository } from "./body-detector-contract.mjs";

export const bodyPoseProviderSchemaVersion = "cimmich.body-pose-provider.v1";
export const bodyPoseResultSchemaVersion = "cimmich.body-pose-result.v1";
export const bodyPoseEvaluationSchemaVersion =
  "cimmich.body-pose-evaluation.v1";
export const bodyPoseReceiptSchemaVersion = "cimmich.body-pose-receipt.v1";
export const bodyPoseRepositoryProjectionSchemaVersion =
  "cimmich.body-pose-repository-projection.v1";
export const bodyPoseMinimumReliableKeypoints = 7;

const digestPattern = /^[0-9a-f]{64}$/;
const publicIdPattern = /^[a-z0-9](?:[a-z0-9._-]{0,63})$/;
const joints = Object.freeze([
  "nose",
  "left_eye",
  "right_eye",
  "left_ear",
  "right_ear",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
]);
const validatedManifests = new WeakSet();
const validatedEnvelopes = new WeakSet();
const projectedEvidence = new WeakMap();

const typedError = (message) =>
  Object.assign(new Error(message), {
    code: "BODY_POSE_PROVIDER_INPUT_INVALID",
    statusCode: 400,
  });

const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  return value;
};

export const bodyPoseDigest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const exactObject = (value, keys, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw typedError(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    throw typedError(`${label} fields are invalid`);
  return value;
};

const requiredDigest = (value, label) => {
  if (typeof value !== "string" || !digestPattern.test(value))
    throw typedError(`${label} must be a lowercase SHA-256 digest`);
  return value;
};

const publicId = (value, label) => {
  if (typeof value !== "string" || !publicIdPattern.test(value))
    throw typedError(`${label} must be a bounded lowercase identifier`);
  return value;
};

const enumValue = (value, allowed, label) => {
  if (!allowed.includes(value)) throw typedError(`${label} is invalid`);
  return value;
};

const boundedInteger = (value, minimum, maximum, label) => {
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw typedError(`${label} is invalid`);
  return value;
};

const canonicalUnit = (value, label, { positive = false } = {}) => {
  if (
    !Number.isFinite(value) ||
    value < (positive ? 0.000001 : 0) ||
    value > 1 ||
    Number(value.toFixed(6)) !== value
  )
    throw typedError(`${label} must be a canonical unit-interval number`);
  return value;
};

const normalizeBox = (value, label) => {
  exactObject(value, ["h", "w", "x", "y"], label);
  const box = {
    h: canonicalUnit(value.h, `${label}.h`, { positive: true }),
    w: canonicalUnit(value.w, `${label}.w`, { positive: true }),
    x: canonicalUnit(value.x, `${label}.x`),
    y: canonicalUnit(value.y, `${label}.y`),
  };
  if (box.x + box.w > 1.000001 || box.y + box.h > 1.000001)
    throw typedError(`${label} must remain inside the normalized image`);
  return deepFreeze(box);
};

export const deriveBodyPoseManifest = (value) => {
  exactObject(
    value,
    [
      "execution",
      "licensing",
      "pose",
      "preprocessing",
      "privacy",
      "provider",
      "resources",
      "schemaVersion",
    ],
    "manifest",
  );
  if (value.schemaVersion !== bodyPoseProviderSchemaVersion)
    throw typedError("manifest schemaVersion is invalid");
  exactObject(
    value.execution,
    ["device", "network", "runtimeId", "threads"],
    "manifest.execution",
  );
  exactObject(
    value.licensing,
    ["code", "model", "trainingData"],
    "manifest.licensing",
  );
  exactObject(
    value.pose,
    [
      "artifactDigest",
      "jointSchema",
      "keypointThreshold",
      "modelId",
      "modelVersionId",
      "scoreThreshold",
      "topologyId",
    ],
    "manifest.pose",
  );
  exactObject(
    value.preprocessing,
    [
      "colorSpace",
      "coordinateSpace",
      "inputHeight",
      "inputWidth",
      "resizeMode",
    ],
    "manifest.preprocessing",
  );
  exactObject(
    value.privacy,
    ["externalUpload", "sourceMedia"],
    "manifest.privacy",
  );
  exactObject(value.provider, ["providerId", "versionId"], "manifest.provider");
  exactObject(
    value.resources,
    ["maxMemoryMiB", "maxRuntimeMs"],
    "manifest.resources",
  );
  const core = {
    execution: {
      device: enumValue(
        value.execution.device,
        ["auto", "cpu", "gpu"],
        "device",
      ),
      network: enumValue(value.execution.network, ["forbidden"], "network"),
      runtimeId: publicId(value.execution.runtimeId, "runtimeId"),
      threads: boundedInteger(value.execution.threads, 1, 64, "threads"),
    },
    licensing: {
      code: enumValue(value.licensing.code, ["declared"], "code licence"),
      model: enumValue(
        value.licensing.model,
        ["declared", "unknown"],
        "model rights",
      ),
      trainingData: enumValue(
        value.licensing.trainingData,
        ["declared", "unknown"],
        "training-data rights",
      ),
    },
    pose: {
      artifactDigest: requiredDigest(
        value.pose.artifactDigest,
        "artifactDigest",
      ),
      jointSchema: enumValue(value.pose.jointSchema, ["coco17"], "jointSchema"),
      keypointThreshold: canonicalUnit(
        value.pose.keypointThreshold,
        "keypointThreshold",
      ),
      modelId: publicId(value.pose.modelId, "modelId"),
      modelVersionId: publicId(value.pose.modelVersionId, "modelVersionId"),
      scoreThreshold: canonicalUnit(
        value.pose.scoreThreshold,
        "scoreThreshold",
      ),
      topologyId: enumValue(value.pose.topologyId, ["coco17.v1"], "topologyId"),
    },
    preprocessing: {
      colorSpace: enumValue(
        value.preprocessing.colorSpace,
        ["rgb"],
        "colorSpace",
      ),
      coordinateSpace: enumValue(
        value.preprocessing.coordinateSpace,
        ["normalized_image"],
        "coordinateSpace",
      ),
      inputHeight: boundedInteger(
        value.preprocessing.inputHeight,
        128,
        4096,
        "inputHeight",
      ),
      inputWidth: boundedInteger(
        value.preprocessing.inputWidth,
        128,
        4096,
        "inputWidth",
      ),
      resizeMode: enumValue(
        value.preprocessing.resizeMode,
        ["letterbox"],
        "resizeMode",
      ),
    },
    privacy: {
      externalUpload: enumValue(
        value.privacy.externalUpload,
        ["none"],
        "externalUpload",
      ),
      sourceMedia: enumValue(
        value.privacy.sourceMedia,
        ["local-read-only"],
        "sourceMedia",
      ),
    },
    provider: {
      providerId: publicId(value.provider.providerId, "providerId"),
      versionId: publicId(value.provider.versionId, "providerVersionId"),
    },
    resources: {
      maxMemoryMiB: boundedInteger(
        value.resources.maxMemoryMiB,
        64,
        65_536,
        "maxMemoryMiB",
      ),
      maxRuntimeMs: boundedInteger(
        value.resources.maxRuntimeMs,
        1_000,
        600_000,
        "maxRuntimeMs",
      ),
    },
    schemaVersion: bodyPoseProviderSchemaVersion,
  };
  const manifest = deepFreeze({
    ...core,
    poseConfigDigest: bodyPoseDigest(core),
  });
  validatedManifests.add(manifest);
  return manifest;
};

export const validateBodyPoseManifest = (value) => {
  exactObject(
    value,
    [
      "execution",
      "licensing",
      "pose",
      "poseConfigDigest",
      "preprocessing",
      "privacy",
      "provider",
      "resources",
      "schemaVersion",
    ],
    "manifest",
  );
  const { poseConfigDigest, ...core } = value;
  const manifest = deriveBodyPoseManifest(core);
  if (
    requiredDigest(poseConfigDigest, "poseConfigDigest") !==
    manifest.poseConfigDigest
  )
    throw typedError("manifest poseConfigDigest is invalid");
  return manifest;
};

const normalizeKeypoint = (value, index) => {
  const label = `detection.keypoints[${index}]`;
  exactObject(value, ["confidence", "joint", "x", "y"], label);
  if (value.joint !== joints[index])
    throw typedError(`${label}.joint is invalid`);
  const confidence = canonicalUnit(value.confidence, `${label}.confidence`);
  const bothNull = value.x === null && value.y === null;
  const bothNumbers = Number.isFinite(value.x) && Number.isFinite(value.y);
  if (!bothNull && !bothNumbers)
    throw typedError(`${label} coordinates are invalid`);
  return deepFreeze({
    confidence,
    joint: value.joint,
    x: bothNull ? null : canonicalUnit(value.x, `${label}.x`),
    y: bothNull ? null : canonicalUnit(value.y, `${label}.y`),
  });
};

const normalizeDetection = (value) => {
  exactObject(value, ["box", "confidence", "keypoints"], "detection");
  if (
    !Array.isArray(value.keypoints) ||
    value.keypoints.length !== joints.length
  )
    throw typedError("detection.keypoints must be exact COCO17");
  const core = {
    box: normalizeBox(value.box, "detection.box"),
    confidence: canonicalUnit(value.confidence, "detection.confidence"),
    keypoints: value.keypoints.map(normalizeKeypoint),
  };
  return deepFreeze({ ...core, detectionKey: bodyPoseDigest(core) });
};

const normalizeResult = (value, manifest) => {
  exactObject(
    value,
    [
      "assetToken",
      "detections",
      "inputRevision",
      "poseConfigDigest",
      "schemaVersion",
      "sourceContentDigest",
      "state",
    ],
    "result",
  );
  if (value.schemaVersion !== bodyPoseResultSchemaVersion)
    throw typedError("result schemaVersion is invalid");
  if (!Array.isArray(value.detections) || value.detections.length > 100)
    throw typedError("result detections are invalid");
  const detections = value.detections
    .map(normalizeDetection)
    .sort((left, right) => left.detectionKey.localeCompare(right.detectionKey));
  if (
    new Set(detections.map((item) => item.detectionKey)).size !==
    detections.length
  )
    throw typedError("result contains duplicate pose detections");
  const state = enumValue(
    value.state,
    ["poses_detected", "no_pose"],
    "result.state",
  );
  if ((state === "poses_detected") !== detections.length > 0)
    throw typedError("result state does not match its detections");
  if (value.poseConfigDigest !== manifest.poseConfigDigest)
    throw typedError("result uses another pose configuration");
  const result = deepFreeze({
    assetToken: requiredDigest(value.assetToken, "result.assetToken"),
    detections,
    inputRevision: requiredDigest(value.inputRevision, "result.inputRevision"),
    poseConfigDigest: manifest.poseConfigDigest,
    schemaVersion: bodyPoseResultSchemaVersion,
    sourceContentDigest: requiredDigest(
      value.sourceContentDigest,
      "result.sourceContentDigest",
    ),
    state,
  });
  return deepFreeze({ result, resultDigest: bodyPoseDigest(result) });
};

const iou = (left, right) => {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.w, right.x + right.w);
  const y2 = Math.min(left.y + left.h, right.y + right.h);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = left.w * left.h + right.w * right.h - intersection;
  return Number((union > 0 ? intersection / union : 0).toFixed(6));
};

const reliableKeypointCount = (detection, keypointThreshold) =>
  detection.keypoints.filter(
    (item) =>
      item.x !== null &&
      item.y !== null &&
      item.confidence >= keypointThreshold,
  ).length;

const resolveAssociations = (bodies, detections, policy, keypointThreshold) => {
  const usableDetections = detections.filter(
    (detection) =>
      reliableKeypointCount(detection, keypointThreshold) >=
      bodyPoseMinimumReliableKeypoints,
  );
  const scores = usableDetections.map((detection) =>
    bodies.map((body) => iou(detection.box, body.box)),
  );
  const bestBody = scores.map((row) =>
    row
      .map((score, bodyIndex) => ({ bodyIndex, score }))
      .sort(
        (left, right) =>
          right.score - left.score || left.bodyIndex - right.bodyIndex,
      ),
  );
  const bestDetection = bodies.map((_body, bodyIndex) =>
    scores
      .map((row, detectionIndex) => ({ detectionIndex, score: row[bodyIndex] }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.detectionIndex - right.detectionIndex,
      ),
  );
  const edges = [];
  for (
    let detectionIndex = 0;
    detectionIndex < usableDetections.length;
    detectionIndex += 1
  ) {
    const rankedBodies = bestBody[detectionIndex];
    const winner = rankedBodies[0];
    if (!winner || winner.score < policy.minimumIou) continue;
    const bodyAlternatives = rankedBodies[1]?.score ?? 0;
    const rankedDetections = bestDetection[winner.bodyIndex];
    if (rankedDetections[0]?.detectionIndex !== detectionIndex) continue;
    const detectionAlternatives = rankedDetections[1]?.score ?? 0;
    if (
      Number((winner.score - bodyAlternatives).toFixed(6)) <
        policy.alternativeMargin ||
      Number((winner.score - detectionAlternatives).toFixed(6)) <
        policy.alternativeMargin
    )
      continue;
    edges.push({
      bodyId: bodies[winner.bodyIndex].bodyId,
      detectionKey: usableDetections[detectionIndex].detectionKey,
      iou: winner.score,
    });
  }
  return edges.sort((left, right) => left.bodyId.localeCompare(right.bodyId));
};

export const validateBodyPoseEvidence = (value) => {
  exactObject(
    value,
    ["bodyValidation", "manifest", "policy", "runs", "schemaVersion"],
    "evaluation",
  );
  if (value.schemaVersion !== bodyPoseEvaluationSchemaVersion)
    throw typedError("evaluation schemaVersion is invalid");
  const manifest = validateBodyPoseManifest(value.manifest);
  const bodyResult = projectValidatedBodyResultForRepository(
    value.bodyValidation,
  );
  exactObject(value.policy, ["alternativeMargin", "minimumIou"], "policy");
  const policy = deepFreeze({
    alternativeMargin: canonicalUnit(
      value.policy.alternativeMargin,
      "policy.alternativeMargin",
      { positive: true },
    ),
    minimumIou: canonicalUnit(value.policy.minimumIou, "policy.minimumIou", {
      positive: true,
    }),
  });
  if (!Array.isArray(value.runs) || value.runs.length !== 2)
    throw typedError("evaluation requires exactly two pose runs");
  const runs = value.runs.map((run, index) => {
    exactObject(run, ["result", "runId"], `runs[${index}]`);
    const normalized = normalizeResult(run.result, manifest);
    return deepFreeze({
      ...normalized,
      runId: publicId(run.runId, `runs[${index}].runId`),
    });
  });
  if (runs[0].runId === runs[1].runId)
    throw typedError("pose runs require distinct run identifiers");
  for (const run of runs) {
    if (
      run.result.assetToken !== bodyResult.assetToken ||
      run.result.inputRevision !== bodyResult.inputRevision ||
      run.result.sourceContentDigest !== bodyResult.sourceContentDigest
    )
      throw typedError("pose run drifted from the exact validated Body input");
  }
  const replayEvidence =
    runs[0].resultDigest === runs[1].resultDigest ? "consistent" : "drift";
  const orderedRuns = runs.toSorted((left, right) =>
    left.runId.localeCompare(right.runId),
  );
  const evidence = replayEvidence === "consistent" ? runs[0] : null;
  const edges = evidence
    ? resolveAssociations(
        bodyResult.bodies,
        evidence.result.detections,
        policy,
        manifest.pose.keypointThreshold,
      )
    : [];
  const byDetection = new Map(
    evidence?.result.detections.map((item) => [item.detectionKey, item]) || [],
  );
  const repositoryRows = edges.map((edge) => {
    const detection = byDetection.get(edge.detectionKey);
    return deepFreeze({
      bodyId: edge.bodyId,
      coordinateSpace: "normalized_image",
      jointSchema: "coco17",
      keypoints: detection.keypoints.map(({ confidence, joint, x, y }) => ({
        confidence,
        joint,
        x,
        y,
      })),
      modelDigest: `sha256:${manifest.pose.artifactDigest}`,
      modelFamily: manifest.provider.providerId,
      modelName: manifest.pose.modelId,
      modelVersion: manifest.pose.modelVersionId,
      producerReceiptId: "receipt_cimmich_body_pose_evidence_v1",
      provider: manifest.provider.providerId,
      sourceArtifactDigest: `sha256:${evidence.resultDigest}`,
      sourceSchemaVersion: bodyPoseResultSchemaVersion,
      state: "valid",
      topologyId: "coco17.v1",
    });
  });
  const envelope = deepFreeze({
    binding: {
      bodyResultDigest: bodyResult.resultDigest,
      policyDigest: bodyPoseDigest(policy),
      poseConfigDigest: manifest.poseConfigDigest,
      qualityPolicy: {
        keypointThreshold: manifest.pose.keypointThreshold,
        minimumReliableKeypoints: bodyPoseMinimumReliableKeypoints,
      },
      resultDigests: orderedRuns.map((run) => run.resultDigest),
    },
    counts: {
      bodyCount: bodyResult.bodies.length,
      poseDetectionCount: evidence?.result.detections.length || 0,
      qualityRejectedPoseCount:
        evidence?.result.detections.filter(
          (detection) =>
            reliableKeypointCount(detection, manifest.pose.keypointThreshold) <
            bodyPoseMinimumReliableKeypoints,
        ).length || 0,
      supportedPoseCount: repositoryRows.length,
      unmatchedBodyCount: bodyResult.bodies.length - repositoryRows.length,
      unmatchedPoseCount:
        (evidence?.result.detections.length || 0) - repositoryRows.length,
    },
    edges,
    replayEvidence,
    runs: orderedRuns.map(({ resultDigest, runId }) => ({
      resultDigest,
      runId,
    })),
  });
  validatedEnvelopes.add(envelope);
  projectedEvidence.set(envelope, deepFreeze(repositoryRows));
  return envelope;
};

const requireEnvelope = (value) => {
  if (!value || typeof value !== "object" || !validatedEnvelopes.has(value))
    throw typedError("An exact validated Body-pose envelope is required");
  return value;
};

export const createBodyPoseReceipt = (value) => {
  const envelope = requireEnvelope(value);
  const core = {
    authority: {
      activation: "none",
      automaticIdentityAuthority: "none",
      recommendation: "none",
      training: "none",
    },
    binding: envelope.binding,
    boundary: {
      databaseWrites: "none",
      externalNetworkPolicy: "forbidden",
      externalNetworkProof: "not_performed",
      identityWrites: "none",
      immichWrites: "none",
      licenceRightsInference: "none",
      mediaWrites: "none",
      providerExecutionProof: "none",
      sourceMedia: "local-read-only",
    },
    counts: envelope.counts,
    decision: {
      reasons:
        envelope.replayEvidence === "consistent" ? [] : ["RESULT_REPLAY_DRIFT"],
      status:
        envelope.replayEvidence === "consistent"
          ? "pose_evidence_validated"
          : "pose_replay_drift",
    },
    replay: { evidence: envelope.replayEvidence, packetCount: 2 },
    schemaVersion: bodyPoseReceiptSchemaVersion,
  };
  return deepFreeze({ ...core, receiptDigest: bodyPoseDigest(core) });
};

export const projectValidatedBodyPoseForRepository = (value) => {
  const envelope = requireEnvelope(value);
  if (envelope.replayEvidence !== "consistent")
    throw typedError("Body-pose repository projection requires exact replay");
  return deepFreeze({
    items: projectedEvidence.get(envelope),
    schemaVersion: bodyPoseRepositoryProjectionSchemaVersion,
  });
};
