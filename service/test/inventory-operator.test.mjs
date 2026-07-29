import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("inventory operator consumes the persisted companion credential", async () => {
  const source = await readFile(
    resolve(import.meta.dirname, "../bin/sync-immich-inventory.mjs"),
    "utf8",
  );

  assert.match(source, /createImmichCompanionManager/);
  assert.match(source, /createHashLinkedAssetResolver/);
  assert.match(source, /resolveCimmichAssetId/);
  assert.match(
    source,
    /credentialFile: process\.env\.CIMMICH_IMMICH_CREDENTIAL_FILE \|\| ""/,
  );
  assert.match(source, /reuseVerifiedFingerprints: true/);
  assert.match(source, /verifySourceBytes: true/);
  assert.match(source, /value\("enqueue-jobs", "false"\)/);
  assert.match(source, /enqueueJobs === "true"/);
  assert.match(source, /: null/);
  assert.doesNotMatch(source, /createImmichCompanion\(\{/);
});
