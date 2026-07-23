import assert from "node:assert/strict";
import test from "node:test";
import { createOwnerFaceRecognitionScheduler } from "../src/owner-face-recognition.mjs";
import { recognitionManifestFixture } from "./fixtures/recognition-manifest.mjs";

test("owner recognition requires one current completed pipeline per imported face", async () => {
  const statements = [];
  const sql = async (strings) => {
    statements.push(strings.join(""));
    return [];
  };
  const scheduler = createOwnerFaceRecognitionScheduler({
    companion: {},
    manifest: recognitionManifestFixture,
    presentationRank: () => 0,
    sql,
  });
  assert.equal((await scheduler.enqueueNext()).state, "idle");
  assert.equal((await scheduler.enqueueNext()).state, "idle");
  const [repair, statement] = statements;
  assert.equal(statements.length, 3);
  assert.match(repair, /UPDATE face_embedding embedding/);
  assert.match(repair, /SET state = 'superseded'/);
  assert.match(repair, /pipeline\.run_kind = 'existing_observation_set'/);
  assert.match(repair, /recognition_job\.result_receipt_id <>/);
  assert.match(statement, /FROM media_pipeline_run_observation observation/);
  assert.match(statement, /JOIN media_pipeline_run pipeline/);
  assert.match(statement, /JOIN current_asset_source_revision revision/);
  assert.match(statement, /pipeline\.state = 'recognized'/);
  assert.match(statement, /recognition_job\.job_id = pipeline\.recognition_job_id/);
  assert.match(
    statement,
    /pipeline\.recognizer_provider_config_digest/,
  );
  assert.doesNotMatch(statement, /embedding\.producer_receipt_id/);
});
