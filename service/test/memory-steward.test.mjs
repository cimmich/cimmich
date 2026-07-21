import assert from "node:assert/strict";
import test from "node:test";
import { createMemorySteward } from "../src/memory-steward.mjs";

const suggestion = {
  candidates: [
    {
      display_name: "Private Name",
      person_id: "person-a",
      prime_score: 0.82,
      rank: 1,
      secondary_score: 0.7,
    },
    {
      display_name: "Another Name",
      person_id: "person-b",
      prime_score: 0.78,
      rank: 2,
      secondary_score: null,
    },
  ],
  detection_confidence: 0.93,
  face_id: "face-one",
  margin: 0.04,
  quality_score: 0.71,
  review_reason: "close_alternatives",
};

test("Memory Steward is local-only and still returns a useful bounded plan", async () => {
  let reads = 0;
  const repository = {
    machineSuggestions: async ({ limit }) => {
      reads += 1;
      assert.equal(limit, 24);
      return [suggestion];
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Memory Steward attempted an outbound request");
  };
  try {
    const steward = createMemorySteward({ repository });
    const plan = await steward.plan();
    assert.equal(plan.mode, "local");
    assert.equal(plan.model, null);
    assert.equal(reads, 1);
    assert.deepEqual(plan.focusFaceIds, ["face-one"]);
    assert.equal(plan.headline, "One useful check, then reassess");
    assert.match(plan.privacy, /makes no outbound request/);
    assert.doesNotMatch(JSON.stringify(plan), /Private Name|Another Name/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Memory Steward healthy-zero remains local and non-authoritative", async () => {
  const steward = createMemorySteward({
    repository: { machineSuggestions: async () => [] },
  });
  const plan = await steward.plan();
  assert.equal(plan.mode, "local");
  assert.deepEqual(plan.focusFaceIds, []);
  assert.match(plan.headline, /No machine review/);
  assert.match(plan.caution, /You decide every identity/);
});
