import assert from "node:assert/strict";
import postgres from "postgres";
import {
  completeAssetSourceRead,
  createAssetSourceRevisionRepository,
} from "../src/asset-source-revision.mjs";
import { enqueueExistingFaceRecognitionPipeline } from "../src/existing-face-recognition-pipeline.mjs";
import { recognitionManifestFixture } from "../test/fixtures/recognition-manifest.mjs";

const sql = postgres(process.env.DATABASE_URL, { max: 2, prepare: true });

try {
  const sources = createAssetSourceRevisionRepository(sql, {
    presentationRank: () => 1,
  });
  const prepared = await sources.prepare({
    assetId: "asset_service_fixture",
    sourceAccess: "operator_local_read_only",
    sourceBindingDigest: "9".repeat(64),
  });
  const sourceRead = completeAssetSourceRead({
    bytes: Buffer.from("disposable operator-local source-access proof"),
    prepared,
  });
  const created = await enqueueExistingFaceRecognitionPipeline(sql, {
    faceIds: ["face_new_person_fixture"],
    manifest: recognitionManifestFixture,
    presentationRank: () => 1,
    sourceRead,
  });
  assert.equal(created.sourceAccess, "operator_local_read_only");
  const replay = await enqueueExistingFaceRecognitionPipeline(sql, {
    faceIds: ["face_new_person_fixture"],
    manifest: recognitionManifestFixture,
    presentationRank: () => 1,
    sourceRead,
  });
  assert.equal(replay.sourceAccess, "operator_local_read_only");
  assert.equal(replay.pipelineRunId, created.pipelineRunId);
  process.stdout.write(
    `${JSON.stringify({
      replayStable: true,
      schemaVersion:
        "cimmich.existing-face-recognition-source-access-acceptance.v1",
      sourceAccess: replay.sourceAccess,
    })}\n`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
