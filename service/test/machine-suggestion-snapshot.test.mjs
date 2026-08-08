import assert from "node:assert/strict";
import test from "node:test";

import { createMachineSuggestionSnapshot } from "../src/machine-suggestion-snapshot.mjs";

test("explicit invalidation never serves a stale machine-suggestion result", async () => {
  const snapshot = createMachineSuggestionSnapshot();
  let loadCount = 0;
  const read = () =>
    snapshot.read({
      load: async () => [{ revision: ++loadCount }],
      project: (rows) => rows,
      visibleRank: 2,
    });

  assert.deepEqual(await read(), [{ revision: 1 }]);
  snapshot.invalidate();
  assert.deepEqual(await read(), [{ revision: 2 }]);
  assert.equal(loadCount, 2);
});
