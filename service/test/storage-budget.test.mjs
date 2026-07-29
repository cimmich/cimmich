import assert from "node:assert/strict";
import test from "node:test";
import { evaluateStorageBudget } from "../src/storage-budget.mjs";

test("storage budget is ready only after working space and reserve both fit", () => {
  assert.deepEqual(
    evaluateStorageBudget({
      availableBytes: 300n,
      requiredWorkingBytes: 100n,
      reserveBytes: 200n,
    }),
    {
      availableBytes: "300",
      contractVersion: "cimmich.storage-budget-preflight.v1",
      deficitBytes: "0",
      ready: true,
      requiredWorkingBytes: "100",
      reserveBytes: "200",
      status: "READY",
      thresholdBytes: "300",
    },
  );
});

test("storage budget fails closed with the exact deficit", () => {
  const result = evaluateStorageBudget({
    availableBytes: "299",
    requiredWorkingBytes: "100",
    reserveBytes: "200",
  });
  assert.equal(result.ready, false);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.deficitBytes, "1");
});

test("storage budget rejects negative or non-integral inputs", () => {
  assert.throws(
    () =>
      evaluateStorageBudget({
        availableBytes: -1,
        requiredWorkingBytes: 0,
        reserveBytes: 0,
      }),
    /non-negative integer/,
  );
  assert.throws(
    () =>
      evaluateStorageBudget({
        availableBytes: 1.5,
        requiredWorkingBytes: 0,
        reserveBytes: 0,
      }),
    /non-negative integer/,
  );
});
