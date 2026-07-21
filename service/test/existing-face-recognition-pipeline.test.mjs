import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  completeAssetSourceRead,
  createAssetSourceRevisionRepository,
} from "../src/asset-source-revision.mjs";
import {
  enqueueExistingFaceRecognitionPipeline,
  existingFaceObservationSetDigest,
  existingFaceRecognitionPipelineVersion,
} from "../src/existing-face-recognition-pipeline.mjs";
import { recognitionManifestFixture as manifest } from "./fixtures/recognition-manifest.mjs";

const digest = (character) => character.repeat(64);

const harness = ({
  sourceAccess = "immich_api_read_only",
  visible = true,
} = {}) => {
  const statements = [];
  let revision = null;
  let pipeline = null;
  const sql = async (strings, ...values) => {
    const statement = strings.join("?");
    statements.push({ statement, values });
    if (statement.includes("LEFT JOIN asset_source_revision_head")) {
      return visible ? [{ asset_id: "asset-one", revision_id: revision }] : [];
    }
    if (statement.includes("SELECT asset_id FROM asset")) {
      return visible ? [{ asset_id: "asset-one" }] : [];
    }
    if (
      statement.includes("SELECT revision_id FROM asset_source_revision_head")
    ) {
      return revision ? [{ revision_id: revision }] : [];
    }
    if (statement.includes("INSERT INTO asset_source_revision (")) {
      revision = values[0];
      return [];
    }
    if (statement.includes("FROM asset_source_revision WHERE revision_id")) {
      return [
        {
          asset_id: "asset-one",
          byte_length: 12,
          input_revision:
            values[0] === revision ? sourceRead.inputRevision : null,
          source_access: sourceAccess,
          source_binding_digest: digest("a"),
          source_content_digest: sourceRead.sourceContentDigest,
        },
      ];
    }
    if (statement.includes("INSERT INTO asset_source_revision_head")) return [];
    if (statement.includes("FROM face_observation")) {
      return [
        {
          asset_id: "asset-one",
          box_h: 0.4,
          box_w: 0.3,
          box_x: 0.1,
          box_y: 0.2,
          face_id: "face-one",
          observation_origin: "detector",
        },
      ];
    }
    if (
      statement.includes("FROM media_pipeline_run") &&
      statement.includes("work_key")
    ) {
      return pipeline ? [pipeline] : [];
    }
    if (statement.includes("SELECT * FROM enqueue_media_job")) {
      return [
        {
          asset_id: "asset-one",
          attempt_count: 0,
          checkpoint_digest: null,
          checkpoint_payload: {},
          checkpoint_revision: 0,
          checkpoint_stage: "queued",
          completed_at: null,
          config_digest: manifest.providerConfigDigest,
          input_revision: sourceRead.inputRevision,
          job_id: "job-one",
          last_error_code: null,
          lease_expires_at: null,
          lease_owner: null,
          max_attempts: 3,
          operation: "recognize_existing_faces",
          requested_at: new Date(0),
          result_digest: null,
          result_receipt_id: null,
          started_at: null,
          state: "queued",
          tool_version: "fixture",
          work_key: "job-work-one",
        },
      ];
    }
    if (statement.includes("INSERT INTO media_pipeline_run (")) {
      pipeline = {
        asset_id: "asset-one",
        input_revision: sourceRead.inputRevision,
        observation_set_digest: values.at(-1),
        pipeline_run_id: values[0],
        recognition_job_id: "job-one",
        recognizer_config_digest: manifest.providerConfigDigest,
        recognizer_provider_config_digest: manifest.providerConfigDigest,
        run_kind: "existing_observation_set",
        source_access: sourceAccess,
        source_revision_id: sourceRead.revisionId,
        state: "recognition_pending",
        vector_space_id: manifest.vectorSpaceId,
      };
      return [pipeline];
    }
    return [];
  };
  sql.begin = async (callback) => callback(sql);
  sql.json = (value) => value;
  let sourceRead;
  return {
    async source() {
      const repository = createAssetSourceRevisionRepository(sql, {
        presentationRank: () => 0,
      });
      const prepared = await repository.prepare({
        assetId: "asset-one",
        sourceAccess,
        sourceBindingDigest: digest("a"),
      });
      sourceRead = completeAssetSourceRead({
        bytes: Buffer.from("source bytes"),
        prepared,
      });
      return sourceRead;
    },
    sql,
    statements,
  };
};

test("exact operator source and current observation set enqueue recognition-only provenance", async () => {
  const state = harness();
  const sourceRead = await state.source();
  const result = await enqueueExistingFaceRecognitionPipeline(state.sql, {
    faceIds: ["face-one"],
    manifest,
    presentationRank: () => 0,
    sourceRead,
  });
  assert.equal(result.schemaVersion, existingFaceRecognitionPipelineVersion);
  assert.equal(result.state, "recognition_pending");
  assert.equal(result.sourceAccess, "immich_api_read_only");
  const source = state.statements.map((row) => row.statement).join("\n");
  assert.match(source, /run_kind/);
  assert.match(source, /media_pipeline_run_observation/);
  assert.doesNotMatch(source, /INSERT INTO face_detection_result/);
});

test("observation-set digest binds geometry, origin, and canonical order", () => {
  const rows = [
    {
      box_h: 0.4,
      box_w: 0.3,
      box_x: 0.1,
      box_y: 0.2,
      face_id: "face-one",
      observation_order: 0,
      observation_origin: "detector",
    },
  ];
  const frozen = existingFaceObservationSetDigest(rows);
  assert.notEqual(
    existingFaceObservationSetDigest([{ ...rows[0], box_x: 0.11 }]),
    frozen,
  );
  assert.notEqual(
    existingFaceObservationSetDigest([
      { ...rows[0], observation_origin: "manual_user" },
    ]),
    frozen,
  );
  assert.throws(
    () =>
      existingFaceObservationSetDigest([{ ...rows[0], observation_order: 1 }]),
    (error) => error.code === "EXISTING_FACE_PIPELINE_STALE",
  );
});

test("exact configured local provenance can enqueue the same recognition-only pipeline", async () => {
  const state = harness({ sourceAccess: "operator_local_read_only" });
  const sourceRead = await state.source();
  const result = await enqueueExistingFaceRecognitionPipeline(state.sql, {
    faceIds: ["face-one"],
    manifest,
    presentationRank: () => 1,
    sourceRead,
  });
  assert.equal(result.state, "recognition_pending");
  assert.equal(result.sourceAccess, "operator_local_read_only");
  const insert = state.statements.find(({ statement }) =>
    statement.includes("INSERT INTO media_pipeline_run ("),
  );
  assert.ok(insert);
});

test("persisted replay projects source_access from the committed revision", async () => {
  const source = await readFile(
    new URL("../src/existing-face-recognition-pipeline.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /SELECT pipeline\.\*, revision\.source_access/);
  assert.match(source, /source_access: committedSource\.sourceAccess/);
  assert.doesNotMatch(source, /return project\(created\)/);
});

test("operator derives source truth only from the current companion and keeps secrets out of argv", async () => {
  const source = await readFile(
    new URL("../bin/run-existing-face-recognition.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /createImmichCompanion/);
  assert.match(source, /process\.env\.DATABASE_URL/);
  assert.match(source, /JOIN immich_asset_projection projection/);
  assert.match(
    source,
    /projection\.input_revision AS companion_input_revision/,
  );
  assert.doesNotMatch(source, /sourcePath/);
  assert.doesNotMatch(source, /loadConfiguredSourceProvenance/);
  assert.doesNotMatch(source, /operator_local_read_only/);
  assert.doesNotMatch(source, /requiredArgument\("database-url"\)/);
  assert.doesNotMatch(source, /activeRuntimeVectorDigest/);
});

test("worker recomputes frozen observation geometry before provider media execution", async () => {
  const source = await readFile(
    new URL(
      "../src/local-existing-face-recognition-worker.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const digestCheck = source.indexOf(
    "existingFaceObservationSetDigest(observations)",
  );
  const mediaRead = source.indexOf(
    "const media = await companion.readAssetImage",
  );
  assert.ok(digestCheck >= 0);
  assert.ok(mediaRead > digestCheck);
  assert.match(source, /face\.observation_origin/);
  assert.match(source, /observation\.observation_order/);
});

test("copied source envelopes and invisible observations fail before pipeline creation", async () => {
  const state = harness();
  const sourceRead = await state.source();
  await assert.rejects(
    enqueueExistingFaceRecognitionPipeline(state.sql, {
      faceIds: ["face-one"],
      manifest,
      presentationRank: () => 1,
      sourceRead: Object.freeze({ ...sourceRead }),
    }),
    (error) => error.code === "ASSET_SOURCE_REVISION_ENVELOPE_INVALID",
  );
  await assert.rejects(
    enqueueExistingFaceRecognitionPipeline(state.sql, {
      faceIds: ["face-two"],
      manifest,
      presentationRank: () => 1,
      sourceRead,
    }),
    (error) => error.code === "EXISTING_FACE_PIPELINE_STALE",
  );
});
