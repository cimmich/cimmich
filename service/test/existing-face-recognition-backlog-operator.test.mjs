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
    /ORDER BY triage\.priority_tier,[\s\S]*triage\.accepted_person_count DESC,[\s\S]*triage\.accepted_association_count DESC,[\s\S]*triage\.human_observation_count DESC/,
  );
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
});
