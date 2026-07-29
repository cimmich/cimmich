import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("pose ingest is resident and cannot invoke matching or identity linkage", async () => {
  const source = await readFile(
    new URL("../bin/run-body-pose-backlog.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /createUltralyticsYoloPoseDetector/);
  assert.match(source, /automaticIdentityWrites: 0/);
  assert.match(source, /matcherInvocations: 0/);
  assert.match(source, /argument\("priority-tier-min", "0"\)/);
  assert.match(source, /SELECT \* FROM media_asset_triage/);
  assert.match(source, /JOIN triage_projection triage/);
  assert.match(
    source,
    /triage\.priority_tier BETWEEN\s+\$\{priorityTierMin\} AND \$\{priorityTierMax\}/,
  );
  assert.match(source, /recent_pose_asset AS MATERIALIZED/);
  assert.match(source, /triage_projection AS MATERIALIZED/);
  assert.match(source, /argument\("detector-results-since"\)/);
  assert.match(source, /result\.created_at >= \$\{detectorResultsSince\}/);
  assert.match(source, /argument\("priority-tier-max", "1"\)/);
  assert.match(source, /FROM current_body_detection_result_observation/);
  assert.match(source, /FROM body_detection_result result/);
  assert.doesNotMatch(source, /identity-audit/);
  assert.doesNotMatch(source, /face-body-linker/);
  assert.doesNotMatch(source, /source-pack/i);
});
