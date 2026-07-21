import {
  bodyDetectionDigest,
  bodyDetectionResultSchemaVersion,
  projectValidatedBodyResultForRepository,
  validateBodyDetectionResult,
  validateBodyDetectorManifest,
} from "./body-detector-contract.mjs";
import { deriveRepositoryBodyAssetToken } from "./body-detection-result-repository.mjs";

export const bodyPoseCurrentProjectionSchemaVersion =
  "cimmich.body-pose-current-projection.v1";
export const bodyPoseCurrentProjectionReceiptSchemaVersion =
  "cimmich.body-pose-current-projection-receipt.v1";

const privateIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const currentEnvelopes = new WeakSet();
const currentBindings = new WeakMap();
const currentProofBySource = new Map([
  ["immich_inventory", "current_inventory_revision"],
  ["immich_api_read_only", "current_at_last_validated_read"],
  ["operator_local_read_only", "current_at_last_validated_read"],
]);

const typedError = (
  message,
  code = "BODY_POSE_CURRENT_INPUT_INVALID",
  statusCode = 400,
) => Object.assign(new Error(message), { code, statusCode });

const requiredPrivateId = (value, label) => {
  if (typeof value !== "string" || !privateIdPattern.test(value)) {
    throw typedError(`${label} is invalid`);
  }
  return value;
};

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const finiteNumber = (value, label) => {
  const number = Number(value);
  if (!Number.isFinite(number)) throw typedError(`${label} is invalid`);
  return number;
};

const headBoxFrom = (row) => {
  const values = [
    row.head_box_x,
    row.head_box_y,
    row.head_box_w,
    row.head_box_h,
  ];
  if (values.every((value) => value == null)) return undefined;
  if (values.some((value) => value == null)) {
    throw typedError(
      "Current Body head geometry is incomplete",
      "BODY_POSE_CURRENT_DRIFT",
      409,
    );
  }
  return {
    h: finiteNumber(row.head_box_h, "headBox.h"),
    w: finiteNumber(row.head_box_w, "headBox.w"),
    x: finiteNumber(row.head_box_x, "headBox.x"),
    y: finiteNumber(row.head_box_y, "headBox.y"),
  };
};

const assertUniformRows = (rows) => {
  const first = rows[0];
  const commonKeys = [
    "asset_id",
    "asset_token",
    "body_count",
    "detection_result_id",
    "detector_config_digest",
    "input_revision",
    "result_digest",
    "source_kind",
    "source_content_digest",
    "current_proof",
  ];
  if (
    rows.some((row) => commonKeys.some((key) => row[key] !== first[key])) ||
    rows.some((row, index) => Number(row.observation_order) !== index)
  ) {
    throw typedError(
      "Current Body result lineage is inconsistent",
      "BODY_POSE_CURRENT_DRIFT",
      409,
    );
  }
};

const issueEnvelope = ({
  assetId,
  currentProof,
  currentSourceKind,
  validation,
}) => {
  const projected = projectValidatedBodyResultForRepository(validation);
  const core = {
    assetId,
    bodyCount: projected.bodies.length,
    bodyResultDigest: projected.resultDigest,
    detectorConfigDigest: projected.detectorConfigDigest,
    inputRevision: projected.inputRevision,
    proof: currentProof,
    schemaVersion: bodyPoseCurrentProjectionSchemaVersion,
    sourceKind: currentSourceKind,
  };
  const envelope = deepFreeze({
    ...core,
    projectionDigest: bodyDetectionDigest(core),
  });
  currentBindings.set(envelope, deepFreeze({ assetId, validation }));
  currentEnvelopes.add(envelope);
  return envelope;
};

export const consumeCurrentBodyPoseProjection = (value) => {
  if (!currentEnvelopes.has(value) || !currentBindings.has(value)) {
    throw typedError(
      "An exact current Body projection envelope is required",
      "BODY_POSE_CURRENT_ENVELOPE_INVALID",
    );
  }
  return currentBindings.get(value);
};

export const createBodyPoseCurrentProjectionReceipt = (value) => {
  consumeCurrentBodyPoseProjection(value);
  const core = {
    authority: {
      automaticIdentityAuthority: "none",
      databaseWrite: "none",
      persistence: "none",
      recommendation: "none",
    },
    bodyCount: value.bodyCount,
    bodyResultDigest: value.bodyResultDigest,
    detectorConfigDigest: value.detectorConfigDigest,
    projectionDigest: value.projectionDigest,
    proof: value.proof,
    schemaVersion: bodyPoseCurrentProjectionReceiptSchemaVersion,
    sourceKind: value.sourceKind,
  };
  return deepFreeze({ ...core, receiptDigest: bodyDetectionDigest(core) });
};

export const createBodyPoseCurrentProjectionRepository = (
  sql,
  { presentationRank },
) => {
  if (typeof sql !== "function" || typeof presentationRank !== "function") {
    throw new TypeError(
      "Current Body projection requires SQL and visibility rank",
    );
  }

  return Object.freeze({
    async load({ assetId: assetIdInput, detectorManifest }) {
      const assetId = requiredPrivateId(assetIdInput, "assetId");
      const manifest = validateBodyDetectorManifest(detectorManifest);
      const visibleRank = presentationRank();
      if (
        !Number.isSafeInteger(visibleRank) ||
        visibleRank < 0 ||
        visibleRank > 2
      ) {
        throw typedError("presentation rank is invalid");
      }
      const rows = await sql`
        SELECT current_result.detection_result_id, current_result.asset_id,
          current_result.asset_token, current_result.detector_config_digest,
          current_result.input_revision, current_result.source_content_digest,
          current_result.result_digest, current_result.source_kind,
          current_result.current_proof, base.body_count,
          current_result.body_id, current_result.observation_order,
          current_result.observation_key, current_result.detector_confidence,
          current_result.quality_digest, body.box_x, body.box_y, body.box_w,
          body.box_h, body.head_box_x, body.head_box_y, body.head_box_w,
          body.head_box_h, body.quality_measurements
        FROM current_body_detection_result_observation current_result
        JOIN body_detection_result base
          ON base.detection_result_id = current_result.detection_result_id
        JOIN body_observation body ON body.body_id = current_result.body_id
          AND body.asset_id = current_result.asset_id AND body.state = 'valid'
        WHERE current_result.asset_id = ${assetId}
          AND current_result.detector_config_digest = ${manifest.detectorConfigDigest}
          AND cimmich_visibility_asset_rank(current_result.asset_id) <= ${visibleRank}
        ORDER BY current_result.observation_order
      `;
      if (!rows.length) {
        throw typedError(
          "No visible current Body result exists for this detector configuration",
          "BODY_POSE_CURRENT_UNAVAILABLE",
          404,
        );
      }
      if (rows.length > 1000) {
        throw typedError(
          "Current Body result exceeds its absolute cap",
          "BODY_POSE_CURRENT_DRIFT",
          409,
        );
      }
      assertUniformRows(rows);
      const first = rows[0];
      if (currentProofBySource.get(first.source_kind) !== first.current_proof) {
        throw typedError(
          "Current Body source proof is invalid",
          "BODY_POSE_CURRENT_DRIFT",
          409,
        );
      }
      if (Number(first.body_count) !== rows.length) {
        throw typedError(
          "Current Body result count is inconsistent",
          "BODY_POSE_CURRENT_DRIFT",
          409,
        );
      }
      const expectedAssetToken = deriveRepositoryBodyAssetToken({
        assetId,
        detectorConfigDigest: manifest.detectorConfigDigest,
        inputRevision: first.input_revision,
      });
      if (first.asset_token !== expectedAssetToken) {
        throw typedError(
          "Current Body result crosses its asset binding",
          "BODY_POSE_CURRENT_DRIFT",
          409,
        );
      }
      const validation = validateBodyDetectionResult(
        {
          assetToken: first.asset_token,
          bodies: rows.map((row) => ({
            box: {
              h: finiteNumber(row.box_h, "box.h"),
              w: finiteNumber(row.box_w, "box.w"),
              x: finiteNumber(row.box_x, "box.x"),
              y: finiteNumber(row.box_y, "box.y"),
            },
            confidence: finiteNumber(row.detector_confidence, "confidence"),
            ...(headBoxFrom(row) ? { headBox: headBoxFrom(row) } : {}),
            quality: row.quality_measurements || {},
          })),
          detectorConfigDigest: first.detector_config_digest,
          inputRevision: first.input_revision,
          schemaVersion: bodyDetectionResultSchemaVersion,
          sourceContentDigest: first.source_content_digest,
          state: "bodies_detected",
        },
        manifest,
      );
      const projected = projectValidatedBodyResultForRepository(validation);
      if (
        projected.resultDigest !== first.result_digest ||
        projected.bodies.some(
          (body, index) =>
            body.bodyId !== rows[index].body_id ||
            body.observationKey !== rows[index].observation_key ||
            body.qualityDigest !== rows[index].quality_digest,
        )
      ) {
        throw typedError(
          "Current Body result digest lineage is inconsistent",
          "BODY_POSE_CURRENT_DRIFT",
          409,
        );
      }
      return issueEnvelope({
        assetId,
        currentProof: first.current_proof,
        currentSourceKind: first.source_kind,
        validation,
      });
    },
  });
};
