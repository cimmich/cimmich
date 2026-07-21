import {
  bodyPoseDigest,
  createBodyPoseReceipt,
  projectValidatedBodyPoseForRepository,
} from "./body-pose-provider-contract.mjs";
import { consumeCurrentBodyPoseProjection } from "./body-pose-current-projection.mjs";

export const bodyPoseEvidenceRepositoryVersion =
  "cimmich.body-pose-evidence-repository.v1";

const typedError = (message, code, statusCode = 409) =>
  Object.assign(new Error(message), { code, statusCode });

const sameJson = (left, right) =>
  bodyPoseDigest(left) === bodyPoseDigest(right);

const storedMatches = (row, item) =>
  row.body_id === item.bodyId &&
  row.coordinate_space === item.coordinateSpace &&
  row.joint_schema === item.jointSchema &&
  row.topology_id === item.topologyId &&
  sameJson(row.keypoints, item.keypoints) &&
  row.provider === item.provider &&
  row.model_family === item.modelFamily &&
  row.model_name === item.modelName &&
  row.model_version === item.modelVersion &&
  row.model_digest === item.modelDigest &&
  row.source_schema_version === item.sourceSchemaVersion &&
  row.source_artifact_digest === item.sourceArtifactDigest &&
  row.state === item.state;

export const createBodyPoseEvidenceRepository = (sql, { presentationRank }) => {
  if (typeof sql !== "function" || typeof presentationRank !== "function") {
    throw new TypeError(
      "Body-pose repository requires SQL and visibility rank",
    );
  }

  const commit = async ({ current, validation }) => {
    const currentBinding = consumeCurrentBodyPoseProjection(current);
    const contractReceipt = createBodyPoseReceipt(validation);
    const projected = projectValidatedBodyPoseForRepository(validation);
    if (contractReceipt.binding.bodyResultDigest !== current.bodyResultDigest) {
      throw typedError(
        "Body-pose evidence belongs to another Body result",
        "BODY_POSE_EVIDENCE_BINDING_CONFLICT",
      );
    }
    const visibleRank = presentationRank();
    if (
      !Number.isSafeInteger(visibleRank) ||
      visibleRank < 0 ||
      visibleRank > 2
    ) {
      throw typedError(
        "Body-pose visibility rank is invalid",
        "BODY_POSE_EVIDENCE_INPUT_INVALID",
        400,
      );
    }

    return sql.begin(async (tx) => {
      const currentRows = await tx`
        SELECT current_result.body_id
        FROM current_body_detection_result_observation current_result
        JOIN body_observation body ON body.body_id = current_result.body_id
          AND body.asset_id = current_result.asset_id AND body.state = 'valid'
        WHERE current_result.asset_id = ${currentBinding.assetId}
          AND current_result.detector_config_digest = ${current.detectorConfigDigest}
          AND current_result.input_revision = ${current.inputRevision}
          AND current_result.result_digest = ${current.bodyResultDigest}
          AND cimmich_visibility_asset_rank(current_result.asset_id) <= ${visibleRank}
        ORDER BY current_result.observation_order
        FOR SHARE
      `;
      const currentBodyIds = currentRows.map((row) => row.body_id);
      if (
        currentBodyIds.length !== current.bodyCount ||
        projected.items.some((item) => !currentBodyIds.includes(item.bodyId))
      ) {
        throw typedError(
          "Current Body evidence changed before pose persistence",
          "BODY_POSE_EVIDENCE_STALE",
        );
      }

      let changed = 0;
      for (const item of projected.items) {
        const existing = await tx`
          SELECT body_id, coordinate_space, joint_schema, topology_id,
            keypoints, provider, model_family, model_name, model_version,
            model_digest, source_schema_version, source_artifact_digest, state
          FROM body_pose_evidence
          WHERE body_id = ${item.bodyId}
          FOR SHARE
        `;
        if (existing.length > 1) {
          throw typedError(
            "Body-pose evidence is ambiguous",
            "BODY_POSE_EVIDENCE_REPOSITORY_CONFLICT",
          );
        }
        if (existing.length === 1) {
          if (!storedMatches(existing[0], item)) {
            throw typedError(
              "Existing Body-pose evidence conflicts with validated replay",
              "BODY_POSE_EVIDENCE_REPLAY_CONFLICT",
            );
          }
          continue;
        }
        await tx`
          INSERT INTO body_pose_evidence (
            body_id, coordinate_space, joint_schema, topology_id, keypoints,
            provider, model_family, model_name, model_version, model_digest,
            source_schema_version, source_artifact_digest, state,
            producer_receipt_id, privacy_class
          ) VALUES (
            ${item.bodyId}, ${item.coordinateSpace}, ${item.jointSchema},
            ${item.topologyId}, ${tx.json(item.keypoints)}, ${item.provider},
            ${item.modelFamily}, ${item.modelName}, ${item.modelVersion},
            ${item.modelDigest}, ${item.sourceSchemaVersion},
            ${item.sourceArtifactDigest}, 'valid',
            'receipt_cimmich_body_pose_evidence_v1', 'private'
          )
        `;
        changed += 1;
      }

      return Object.freeze({
        activationAuthority: "none",
        automaticIdentityAuthority: "none",
        bodyCount: current.bodyCount,
        changed: changed > 0,
        persistedPoseCount: projected.items.length,
        replayedPoseCount: projected.items.length - changed,
        repositoryWrites: changed > 0 ? "pose_evidence_only" : "none",
        schemaVersion: bodyPoseEvidenceRepositoryVersion,
        unavailablePoseCount: current.bodyCount - projected.items.length,
      });
    });
  };

  return Object.freeze({ commit });
};
