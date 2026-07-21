import assert from "node:assert/strict";
import test from "node:test";
import {
  rebuildWorkerReceipt,
  validateRebuildWorkerOptions,
} from "../src/source-pack-rebuild-worker.mjs";

const valid = {
  configDigest: "config_a",
  cutoff: "2026-07-16T00:00:00Z",
  modelFamily: "face-model",
  modelVersion: "v1",
  workerId: "worker-a",
};

test("rebuild worker options freeze a bounded deterministic operating envelope", () => {
  const options = validateRebuildWorkerOptions(valid);
  assert.equal(options.cutoff, "2026-07-16T00:00:00.000Z");
  assert.equal(options.batchSize, 500);
  assert.throws(
    () => validateRebuildWorkerOptions({ ...valid, leaseSeconds: 2 }),
    /leaseSeconds/,
  );
  assert.throws(
    () => validateRebuildWorkerOptions({ ...valid, configDigest: "" }),
    /configDigest/,
  );
});

test("rebuild worker receipt carries no activation authority", () => {
  const options = validateRebuildWorkerOptions(valid);
  const receipt = rebuildWorkerReceipt({
    cycles: 1,
    options,
    packs: [{ packId: "pack_a", state: "proposed" }],
    requests: 4,
  });
  assert.equal(receipt.activationAuthority, "none");
  assert.equal(receipt.packs[0].state, "proposed");
  assert.equal(receipt.requests, 4);
});
