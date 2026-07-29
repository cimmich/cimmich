import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("exact recognition claim recovers only its own expired pipeline lease", async () => {
  const source = await readFile(
    new URL(
      "../../migrations/0097_exact_recognition_expired_lease_recovery_v1.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /job\.job_id = p_job_id/);
  assert.match(source, /job\.lease_expires_at < now\(\)/);
  assert.match(source, /pipeline\.state = 'recognition_pending'/);
  assert.match(source, /pipeline\.run_kind = 'existing_observation_set'/);
  assert.match(source, /job\.attempt_count >= job\.max_attempts/);
  assert.match(source, /'WORKER_LEASE_EXPIRED'/);
  assert.match(source, /'lease_expired'/);
  assert.match(source, /job\.operation = 'recognize_existing_faces'/);
});
