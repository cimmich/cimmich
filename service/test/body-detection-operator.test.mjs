import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Body operator stays within the source-revision visibility contract", async () => {
  const source = await readFile(
    new URL("../bin/body-detection-operator.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /const presentationRank = \(\) => 2/);
  assert.doesNotMatch(source, /cimmich_visibility_asset_rank\([^)]*\) <= 3/);
  assert.doesNotMatch(source, /face-body-linker-repository/);
  assert.doesNotMatch(source, /applyFaceBodyLinks/);
  assert.match(source, /matcherInvocations: 0/);
  assert.match(source, /GROUP BY projection\.immich_asset_id/);
  assert.match(source, /NOT EXISTS \(\s+SELECT 1\s+FROM body_pose_evidence/);
});

test("Body operator tolerates a missing optional credential file at boot", async () => {
  const source = await readFile(
    new URL("../bin/body-detection-operator.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /if \(error\?\.code !== "ENOENT"\) throw error/);
});
