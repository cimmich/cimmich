import {
  bodyDetectionDigest,
  projectValidatedBodyResultForRepository,
} from "./body-detector-contract.mjs";
import {
  commitValidatedAssetSourceRead,
  consumeValidatedAssetSourceRead,
} from "./asset-source-revision.mjs";

export const bodyDetectionResultRepositoryVersion =
  "cimmich.body-detection-result-repository.v1";

const privateIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;

const requiredPrivateId = (value, label) => {
  if (typeof value !== "string" || !privateIdPattern.test(value)) {
    throw Object.assign(new Error(`${label} is invalid`), {
      code: "BODY_DETECTION_RESULT_INPUT_INVALID",
      statusCode: 400,
    });
  }
  return value;
};

export const deriveRepositoryBodyAssetToken = ({
  assetId,
  detectorConfigDigest,
  inputRevision,
}) =>
  bodyDetectionDigest({
    assetId: requiredPrivateId(assetId, "assetId"),
    detectorConfigDigest,
    inputRevision,
    schemaVersion: bodyDetectionResultRepositoryVersion,
  });

const sameNumber = (left, right) =>
  Math.abs(Number(left) - Number(right)) < 1e-12;

export const createBodyDetectionResultRepository = (
  sql,
  { presentationRank },
) => {
  if (typeof sql !== "function" || typeof presentationRank !== "function") {
    throw new TypeError(
      "Body result repository requires SQL and visibility rank",
    );
  }

  const commit = async ({ assetId: assetIdInput, sourceRead, validation }) => {
    const assetId = requiredPrivateId(assetIdInput, "assetId");
    const projected = projectValidatedBodyResultForRepository(validation);
    const sourceBinding = sourceRead
      ? consumeValidatedAssetSourceRead(sourceRead)
      : null;
    if (
      sourceBinding &&
      (sourceBinding.assetId !== assetId ||
        sourceBinding.inputRevision !== projected.inputRevision ||
        sourceBinding.sourceContentDigest !== projected.sourceContentDigest)
    ) {
      throw Object.assign(
        new Error("Body result crosses its validated source read"),
        { code: "BODY_DETECTION_RESULT_SOURCE_CONFLICT", statusCode: 409 },
      );
    }
    const expectedAssetToken = deriveRepositoryBodyAssetToken({
      assetId,
      detectorConfigDigest: projected.detectorConfigDigest,
      inputRevision: projected.inputRevision,
    });
    if (projected.assetToken !== expectedAssetToken) {
      throw Object.assign(new Error("Body result crosses its prepared asset"), {
        code: "BODY_DETECTION_RESULT_ASSET_CONFLICT",
        statusCode: 409,
      });
    }
    const visibleRank = presentationRank();
    if (
      !Number.isSafeInteger(visibleRank) ||
      visibleRank < 0 ||
      visibleRank > 2
    ) {
      throw Object.assign(new Error("Body result visibility rank is invalid"), {
        code: "BODY_DETECTION_RESULT_INPUT_INVALID",
        statusCode: 400,
      });
    }
    const detectionResultId = `body_detection_${bodyDetectionDigest({
      assetId,
      detectorConfigDigest: projected.detectorConfigDigest,
      inputRevision: projected.inputRevision,
    }).slice(0, 40)}`;
    const receiptId = `receipt_body_detection_intake_${projected.resultDigest.slice(0, 32)}`;

    return sql.begin(async (tx) => {
      if (sourceBinding) {
        await commitValidatedAssetSourceRead(tx, {
          presentationRank,
          sourceRead,
        });
      } else {
        const projections = await tx`
          SELECT projection.input_revision
          FROM asset
          JOIN immich_asset_projection projection
            ON projection.cimmich_asset_id = asset.asset_id
            AND projection.state = 'active'
          WHERE asset.asset_id = ${assetId} AND asset.state = 'active'
            AND projection.input_revision = ${projected.inputRevision}
            AND cimmich_visibility_asset_rank(asset.asset_id) <= ${visibleRank}
          FOR SHARE
        `;
        if (projections.length !== 1) {
          throw Object.assign(
            new Error("Body result asset revision is stale or unavailable"),
            { code: "BODY_DETECTION_RESULT_STALE", statusCode: 409 },
          );
        }
      }
      const existing = await tx`
        SELECT detection_result_id, result_digest, body_count,
          source_revision_id
        FROM body_detection_result
        WHERE asset_id = ${assetId}
          AND detector_config_digest = ${projected.detectorConfigDigest}
          AND input_revision = ${projected.inputRevision}
        FOR SHARE
      `;
      if (existing.length > 1) {
        throw Object.assign(new Error("Body result lineage is ambiguous"), {
          code: "BODY_DETECTION_RESULT_REPOSITORY_CONFLICT",
          statusCode: 409,
        });
      }
      if (existing.length === 1) {
        if (
          existing[0].detection_result_id !== detectionResultId ||
          existing[0].result_digest !== projected.resultDigest ||
          Number(existing[0].body_count) !== projected.bodies.length ||
          (sourceBinding
            ? existing[0].source_revision_id !== sourceBinding.revisionId
            : existing[0].source_revision_id != null)
        ) {
          throw Object.assign(new Error("Body result replay conflicts"), {
            code: "BODY_DETECTION_RESULT_REPLAY_CONFLICT",
            statusCode: 409,
          });
        }
        return Object.freeze({
          activationAuthority: "none",
          automaticIdentityAuthority: "none",
          bodyCount: projected.bodies.length,
          changed: false,
          detectionResultId,
          providerExecutionProof: "none",
          replayed: true,
          repositoryWrites: "none",
          resultDigest: projected.resultDigest,
          schemaVersion: bodyDetectionResultRepositoryVersion,
          sourceMediaRead: "none",
          state: projected.state,
        });
      }

      await tx`
        INSERT INTO producer_receipt (
          producer_receipt_id, producer_kind, producer_name, producer_version,
          config_digest, started_at, completed_at, result_digest, privacy_class
        ) VALUES (
          ${receiptId}, 'system', 'cimmich-body-detection-result-intake', 'v1',
          ${projected.detectorConfigDigest}, now(), now(),
          ${projected.resultDigest}, 'private'
        )
      `;
      for (const body of projected.bodies) {
        const rows = await tx`
          SELECT * FROM body_observation WHERE body_id = ${body.bodyId}
        `;
        if (rows.length > 1) {
          throw Object.assign(new Error("Body observation is ambiguous"), {
            code: "BODY_DETECTION_RESULT_REPOSITORY_CONFLICT",
            statusCode: 409,
          });
        }
        if (rows.length === 1) {
          const row = rows[0];
          if (
            row.asset_id !== assetId ||
            !sameNumber(row.box_x, body.box.x) ||
            !sameNumber(row.box_y, body.box.y) ||
            !sameNumber(row.box_w, body.box.w) ||
            !sameNumber(row.box_h, body.box.h) ||
            bodyDetectionDigest(row.quality_measurements || {}) !==
              body.qualityDigest
          ) {
            throw Object.assign(new Error("Stable Body ID conflicts"), {
              code: "BODY_DETECTION_RESULT_REPOSITORY_CONFLICT",
              statusCode: 409,
            });
          }
        } else {
          await tx`
            INSERT INTO body_observation (
              body_id, asset_id, box_x, box_y, box_w, box_h,
              head_box_x, head_box_y, head_box_w, head_box_h,
              quality_measurements, state, producer_receipt_id
            ) VALUES (
              ${body.bodyId}, ${assetId}, ${body.box.x}, ${body.box.y},
              ${body.box.w}, ${body.box.h}, ${body.headBox?.x ?? null},
              ${body.headBox?.y ?? null}, ${body.headBox?.w ?? null},
              ${body.headBox?.h ?? null}, ${tx.json(body.quality)}, 'valid',
              ${receiptId}
            )
          `;
        }
      }
      await tx`
        INSERT INTO body_detection_result (
          detection_result_id, asset_id, asset_token, detector_config_digest,
          input_revision, source_content_digest, outcome, body_count,
          result_digest, producer_receipt_id, source_revision_id
        ) VALUES (
          ${detectionResultId}, ${assetId}, ${projected.assetToken},
          ${projected.detectorConfigDigest}, ${projected.inputRevision},
          ${projected.sourceContentDigest}, ${projected.state},
          ${projected.bodies.length}, ${projected.resultDigest}, ${receiptId},
          ${sourceBinding?.revisionId ?? null}
        )
      `;
      for (const [index, body] of projected.bodies.entries()) {
        await tx`
          INSERT INTO body_detection_result_observation (
            detection_result_id, body_id, observation_order, observation_key,
            detector_confidence, quality_digest
          ) VALUES (
            ${detectionResultId}, ${body.bodyId}, ${index},
            ${body.observationKey}, ${body.confidence}, ${body.qualityDigest}
          )
        `;
      }
      return Object.freeze({
        activationAuthority: "none",
        automaticIdentityAuthority: "none",
        bodyCount: projected.bodies.length,
        changed: true,
        detectionResultId,
        providerExecutionProof: "none",
        replayed: false,
        repositoryWrites: sourceBinding
          ? "source_revision_and_body_result"
          : "body_result_only",
        resultDigest: projected.resultDigest,
        schemaVersion: bodyDetectionResultRepositoryVersion,
        sourceMediaRead: "none",
        state: projected.state,
      });
    });
  };

  return Object.freeze({ commit });
};
