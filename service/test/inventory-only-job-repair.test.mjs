import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("inventory-only repair is fail-closed, auditable and non-destructive", async () => {
  const source = await readFile(
    resolve(import.meta.dirname, "../src/inventory-only-job-repair.mjs"),
    "utf8",
  );

  assert.match(source, /inventory-only-v1/);
  assert.match(source, /"0"\.repeat\(64\)/);
  assert.match(source, /attempt_count = 0/);
  assert.match(source, /checkpoint_stage = 'queued'/);
  assert.match(source, /result_receipt_id IS NULL/);
  assert.match(source, /INVENTORY_JOB_DISABLED/);
  assert.match(source, /INSERT INTO media_job_event/);
  assert.match(source, /"inventory_job_disabled"/);
  assert.doesNotMatch(source, /\bDELETE\b/i);
});
