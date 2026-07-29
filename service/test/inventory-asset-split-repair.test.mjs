import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("inventory split repair is run-scoped, empty-duplicate only, and fail closed", async () => {
  const source = await readFile(
    new URL("../src/inventory-asset-split-repair.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /state = 'completed'/);
  assert.match(source, /generated_in_run = 1/);
  assert.match(source, /preexisting_assets = 1/);
  assert.match(source, /verification = 'byte_verified'/);
  assert.match(source, /found derived evidence on a duplicate asset/);
  assert.match(source, /job\.state <> 'pending'/);
  assert.match(source, /checkpoint_stage <> 'queued'/);
  assert.match(source, /state = 'paused'/);
  assert.match(source, /state = 'superseded'/);
  assert.match(source, /state = 'tombstoned'/);
  assert.match(source, /event_kind, producer_receipt_id/);
});
