import assert from "node:assert/strict";
import test from "node:test";
import { createOwnerFaceRecognitionScheduler } from "../src/owner-face-recognition.mjs";
import { recognitionManifestFixture } from "./fixtures/recognition-manifest.mjs";

test("owner recognition does not treat unproven imported embeddings as processed", async () => {
  let statement = "";
  const sql = async (strings) => {
    statement = strings.join("");
    return [];
  };
  const scheduler = createOwnerFaceRecognitionScheduler({
    companion: {},
    manifest: recognitionManifestFixture,
    presentationRank: () => 0,
    sql,
  });
  assert.equal((await scheduler.enqueueNext()).state, "idle");
  assert.match(statement, /JOIN media_pipeline_run pipeline/);
  assert.match(statement, /JOIN current_asset_source_revision revision/);
  assert.match(statement, /pipeline\.state = 'recognized'/);
  assert.match(statement, /recognition_job\.result_receipt_id/);
});
