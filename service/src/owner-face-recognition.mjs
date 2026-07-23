import { createHash } from "node:crypto";
import {
  completeAssetSourceRead,
  createAssetSourceRevisionRepository,
} from "./asset-source-revision.mjs";
import { enqueueExistingFaceRecognitionPipeline } from "./existing-face-recognition-pipeline.mjs";
import {
  recognitionDigest,
  validateRecognitionProviderManifest,
} from "./recognition-provider-contract.mjs";

export const ownerFaceRecognitionVersion = "cimmich.owner-face-recognition.v1";

const typedError = (code, message, statusCode = 409) =>
  Object.assign(new Error(message), { code, statusCode });

const mediaAssetId = (value) =>
  value?.asset?.immichAssetId || value?.asset?.assetId || null;

export const immichAssetSourceBindingDigest = ({
  assetId,
  companionInputRevision,
  sourceAssetId,
}) =>
  recognitionDigest({
    assetId,
    companionInputRevision,
    schemaVersion: "cimmich.existing-face-recognition-companion-binding.v1",
    sourceAssetId,
  });

const loadProjection = async (sql, { assetId, sourceId }) => {
  const [row] = await sql`
    SELECT projection.cimmich_asset_id AS asset_id,
      projection.immich_asset_id AS source_asset_id,
      projection.input_revision AS companion_input_revision,
      projection.source_id
    FROM immich_asset_projection projection
    JOIN asset ON asset.asset_id = projection.cimmich_asset_id
      AND asset.state = 'active'
    WHERE projection.cimmich_asset_id = ${assetId}
      AND projection.source_id = ${sourceId}
      AND projection.state = 'active'
  `;
  if (!row) {
    throw typedError(
      "OWNER_FACE_RECOGNITION_SOURCE_UNAVAILABLE",
      "The current Immich asset projection is unavailable",
      404,
    );
  }
  return row;
};

const assertCompanionProjection = (row, projected) => {
  if (
    mediaAssetId(projected) !== row.source_asset_id ||
    projected?.asset?.inputRevision !== row.companion_input_revision
  ) {
    throw typedError(
      "OWNER_FACE_RECOGNITION_SOURCE_STALE",
      "The Immich source changed after inventory admission",
    );
  }
};

export const createCurrentImmichAssetReader = ({
  companion,
  sourceId = "immich-primary",
  sql,
}) => {
  if (!companion || !sql) {
    throw new TypeError(
      "Current Immich asset reader requires companion and SQL",
    );
  }
  const current = async (assetId) => {
    const projection = await loadProjection(sql, { assetId, sourceId });
    const upstream = await companion.getAsset({
      assetId: projection.source_asset_id,
    });
    assertCompanionProjection(projection, upstream);
    const sourceBindingDigest = immichAssetSourceBindingDigest({
      assetId,
      companionInputRevision: projection.companion_input_revision,
      sourceAssetId: projection.source_asset_id,
    });
    const [revision] = await sql`
      SELECT revision.input_revision, revision.source_content_digest
      FROM asset_source_revision_head head
      JOIN asset_source_revision revision ON revision.revision_id = head.revision_id
      WHERE head.asset_id = ${assetId}
        AND head.source_access = 'immich_api_read_only'
        AND head.source_binding_digest = ${sourceBindingDigest}
    `;
    if (!revision) {
      throw typedError(
        "OWNER_FACE_RECOGNITION_SOURCE_STALE",
        "The validated Cimmich source revision is unavailable",
      );
    }
    return { projection, revision };
  };
  return Object.freeze({
    async getAsset({ assetId }) {
      const { revision } = await current(assetId);
      return { asset: { assetId, inputRevision: revision.input_revision } };
    },
    async readAssetImage({ assetId }) {
      const { projection, revision } = await current(assetId);
      const media = await companion.readAssetImage({
        assetId: projection.source_asset_id,
      });
      assertCompanionProjection(projection, media);
      const contentDigest = createHash("sha256")
        .update(media.bytes)
        .digest("hex");
      if (contentDigest !== revision.source_content_digest) {
        throw typedError(
          "OWNER_FACE_RECOGNITION_SOURCE_STALE",
          "The Immich source bytes changed after validation",
        );
      }
      return {
        asset: { assetId, inputRevision: revision.input_revision },
        bytes: media.bytes,
        contentDigest,
        sourceAccess: "immich-api-read-only",
      };
    },
  });
};

export const createOwnerFaceRecognitionScheduler = ({
  companion,
  manifest,
  presentationRank,
  sourceId = "immich-primary",
  sql,
}) => {
  if (
    !companion ||
    !manifest ||
    !sql ||
    typeof presentationRank !== "function"
  ) {
    throw new TypeError(
      "Owner Face recognition scheduler requires companion, manifest, visibility and SQL",
    );
  }
  const validatedManifest = validateRecognitionProviderManifest(manifest);
  const sourceRepository = createAssetSourceRevisionRepository(sql, {
    presentationRank,
  });
  let historicalEmbeddingRepairPromise = null;
  const repairHistoricalEmbeddings = async () => {
    if (!historicalEmbeddingRepairPromise) {
      historicalEmbeddingRepairPromise = sql`
        UPDATE face_embedding embedding
        SET state = 'superseded'
        WHERE embedding.state = 'active'
          AND embedding.model_family =
            ${validatedManifest.recognitionSpace.modelFamily}
          AND embedding.model_version =
            ${validatedManifest.recognitionSpace.modelVersion}
          AND embedding.config_digest =
            ${validatedManifest.recognitionSpaceConfigDigest}
          AND EXISTS (
            SELECT 1
            FROM media_pipeline_run_observation observation
            JOIN media_pipeline_run pipeline
              ON pipeline.pipeline_run_id = observation.pipeline_run_id
              AND pipeline.run_kind = 'existing_observation_set'
              AND pipeline.recognizer_config_digest =
                embedding.config_digest
              AND pipeline.recognizer_provider_config_digest =
                ${validatedManifest.providerConfigDigest}
              AND pipeline.vector_space_id =
                ${validatedManifest.vectorSpaceId}
              AND pipeline.state = 'recognized'
            JOIN media_job recognition_job
              ON recognition_job.job_id = pipeline.recognition_job_id
              AND recognition_job.state = 'completed'
            JOIN current_asset_source_revision revision
              ON revision.revision_id = pipeline.source_revision_id
              AND revision.asset_id = pipeline.asset_id
              AND revision.input_revision = pipeline.input_revision
              AND revision.source_content_digest =
                pipeline.source_content_digest
            WHERE observation.face_id = embedding.face_id
              AND recognition_job.result_receipt_id <>
                embedding.producer_receipt_id
              AND NOT EXISTS (
                SELECT 1
                FROM face_embedding runtime_embedding
                WHERE runtime_embedding.face_id = embedding.face_id
                  AND runtime_embedding.producer_receipt_id =
                    recognition_job.result_receipt_id
              )
          )
      `;
    }
    try {
      await historicalEmbeddingRepairPromise;
    } catch (error) {
      historicalEmbeddingRepairPromise = null;
      throw error;
    }
  };
  return Object.freeze({
    async enqueueNext() {
      const visibleRank = presentationRank();
      await repairHistoricalEmbeddings();
      const rows = await sql`
        WITH missing AS MATERIALIZED (
          SELECT face.face_id, face.asset_id,
            projection.immich_asset_id AS source_asset_id,
            projection.input_revision AS companion_input_revision,
            projection.source_id,
            row_number() OVER (
              PARTITION BY face.asset_id ORDER BY face.face_id
            ) AS asset_face_order,
            min(face.asset_id) OVER () AS first_asset_id
          FROM current_face_identity identity
          JOIN person ON person.person_id = identity.person_id
            AND person.status = 'active'
          JOIN face_observation face ON face.face_id = identity.face_id
            AND face.state = 'valid'
          JOIN asset ON asset.asset_id = face.asset_id AND asset.state = 'active'
          JOIN immich_asset_projection projection
            ON projection.cimmich_asset_id = asset.asset_id
            AND projection.source_id = ${sourceId}
            AND projection.state = 'active'
          WHERE identity.state = 'accepted'
            AND cimmich_visibility_asset_rank(asset.asset_id) <= ${visibleRank}
            AND cimmich_visibility_subject_rank(
              person.subject_kind, identity.person_id
            ) <= ${visibleRank}
            AND NOT EXISTS (
              SELECT 1
              FROM media_pipeline_run_observation observation
              JOIN media_pipeline_run pipeline
                ON pipeline.pipeline_run_id = observation.pipeline_run_id
                AND pipeline.asset_id = face.asset_id
                AND pipeline.recognizer_config_digest =
                  ${validatedManifest.recognitionSpaceConfigDigest}
                AND pipeline.recognizer_provider_config_digest =
                  ${validatedManifest.providerConfigDigest}
                AND pipeline.vector_space_id =
                  ${validatedManifest.vectorSpaceId}
                AND pipeline.state = 'recognized'
              JOIN media_job recognition_job
                ON recognition_job.job_id = pipeline.recognition_job_id
                AND recognition_job.state = 'completed'
              JOIN current_asset_source_revision revision
                ON revision.revision_id = pipeline.source_revision_id
                AND revision.asset_id = pipeline.asset_id
                AND revision.input_revision = pipeline.input_revision
                AND revision.source_content_digest =
                  pipeline.source_content_digest
              WHERE observation.face_id = face.face_id
            )
          ORDER BY face.asset_id, face.face_id
        )
        SELECT face_id, asset_id, source_asset_id, companion_input_revision,
          source_id
        FROM missing
        WHERE asset_id = first_asset_id AND asset_face_order <= 32
        ORDER BY face_id
      `;
      if (!rows.length) {
        return {
          schemaVersion: ownerFaceRecognitionVersion,
          state: "idle",
        };
      }
      const first = rows[0];
      if (
        rows.some(
          (row) =>
            row.asset_id !== first.asset_id ||
            row.source_asset_id !== first.source_asset_id ||
            row.companion_input_revision !== first.companion_input_revision,
        )
      ) {
        throw typedError(
          "OWNER_FACE_RECOGNITION_SOURCE_CONFLICT",
          "Accepted Faces cross current Immich source projections",
        );
      }
      const projected = await companion.getAsset({
        assetId: first.source_asset_id,
      });
      assertCompanionProjection(first, projected);
      const media = await companion.readAssetImage({
        assetId: first.source_asset_id,
      });
      assertCompanionProjection(first, media);
      const sourceBindingDigest = immichAssetSourceBindingDigest({
        assetId: first.asset_id,
        companionInputRevision: first.companion_input_revision,
        sourceAssetId: first.source_asset_id,
      });
      const prepared = await sourceRepository.prepare({
        assetId: first.asset_id,
        sourceAccess: "immich_api_read_only",
        sourceBindingDigest,
      });
      const sourceRead = completeAssetSourceRead({
        bytes: media.bytes,
        prepared,
      });
      const pipeline = await enqueueExistingFaceRecognitionPipeline(sql, {
        faceIds: rows.map((row) => row.face_id),
        manifest: validatedManifest,
        presentationRank,
        sourceRead,
      });
      return {
        pipelineRunId: pipeline.pipelineRunId,
        schemaVersion: ownerFaceRecognitionVersion,
        state: pipeline.state === "recognized" ? "recognized" : "enqueued",
      };
    },
  });
};
