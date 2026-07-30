import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const operatorPath = resolve(
  import.meta.dirname,
  "../bin/run-existing-face-recognition-backlog.mjs",
);

test("existing-Face backlog is triage ordered and boundedly parallel", async () => {
  const source = await readFile(operatorPath, "utf8");

  assert.match(
    source,
    /JOIN media_asset_triage triage ON triage\.asset_id = face\.asset_id/,
  );
  assert.match(
    source,
    /EXISTS \([\s\S]*FROM immich_asset_projection projection[\s\S]*projection\.cimmich_asset_id = face\.asset_id/,
  );
  assert.doesNotMatch(
    source,
    /JOIN immich_asset_projection projection[\s\S]*ON projection\.cimmich_asset_id = face\.asset_id/,
  );
  assert.match(
    source,
    /ORDER BY projection\.last_seen_at DESC, projection\.immich_asset_id[\s\S]*LIMIT 1/,
  );
  assert.match(
    source,
    /active_pipeline\.state = 'recognition_pending'[\s\S]*active_job\.state = 'processing'[\s\S]*active_job\.lease_expires_at > now\(\)/,
  );
  assert.match(source, /triage\.priority_tier <= \$\{priorityTierMax\}/);
  assert.match(
    source,
    /detector_observation\.face_id = face\.face_id[\s\S]*detector_result\.detector_config_digest =[\s\S]*\$\{detectorConfigDigest\}/,
  );
  assert.match(
    source,
    /detectorConfigDigestFilter: detectorConfigDigest \|\| null/,
  );
  assert.match(
    source,
    /ORDER BY priority_tier,[\s\S]*accepted_person_count DESC,[\s\S]*accepted_association_count DESC,[\s\S]*human_observation_count DESC/,
  );
  // The asset bound and the availability totals both live inside the one
  // statement: the frontier is materialized once, only faces of the first
  // limitAssets triage-ranked assets are transferred, and the receipt numbers
  // still describe the whole eligible frontier.
  assert.match(source, /eligible AS MATERIALIZED/);
  assert.match(source, /LIMIT \$\{limitAssets\}/);
  assert.match(
    source,
    /count\(\*\)::int AS faces_available,[\s\S]*count\(DISTINCT asset_id\)::int AS assets_available/,
  );
  assert.doesNotMatch(source, /\.slice\(0, limitAssets\)/);
  assert.match(
    source,
    /optionalArgument\("workers"\)[\s\S]*"workers",[\s\S]*1,[\s\S]*8,[\s\S]*1/,
  );
  assert.match(
    source,
    /Array\.from\(\{ length: workerCount \}, \(\) =>[\s\S]*residentProcess: true/,
  );
  assert.match(
    source,
    /await access\(path, mode\)[\s\S]*Recognition backlog \$\{label\} is unavailable/,
  );
  assert.match(source, /expectedJobId: pipeline\.recognitionJobId/);
  assert.match(source, /retryableRecognitionErrors/);
  assert.match(source, /LOCAL_EXISTING_FACE_RECOGNITION_FAILED/);
  assert.match(
    source,
    /let executionAttempt = 1;[\s\S]*executionAttempt <= 3;[\s\S]*executionAttempt \+= 1/,
  );
  assert.match(source, /result\.state !== "pending"/);
  assert.match(source, /summary\.retriedJobs \+= 1/);
  assert.match(
    source,
    /Promise\.allSettled\([\s\S]*recognizers\.map\(\(recognizer\) => recognizer\.close\(\)\)/,
  );
  assert.match(source, /const settledWorkers = await Promise\.allSettled/);
  assert.match(source, /summary\.workerFailures = settledWorkers/);
  assert.match(source, /"bounded_run_complete_with_failures"/);
  assert.match(source, /process\.exitCode = 1/);
});
