import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { matcherPolicyMargin } from "../src/source-pack-evaluator.mjs";

test("one tuned margin definition governs every marginFloor gate", async () => {
  // The open-set review gate tunes marginFloor against
  // greatest(0, winner_score - coalesce(runner_up_score, -1)).
  assert.ok(Math.abs(matcherPolicyMargin(0.8, 0.6) - 0.2) < 1e-12);
  assert.equal(matcherPolicyMargin(0.5, null), 1.5);
  assert.equal(matcherPolicyMargin(0.5, undefined), 1.5);
  assert.equal(matcherPolicyMargin(0.2, 0.4), 0);

  const evaluator = await readFile(
    new URL("../src/source-pack-evaluator.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    evaluator,
    /greatest\(0, score - coalesce\(runner_up_score, -1\)\)/,
  );

  // Head rescan computes its margin through the shared definition instead of
  // reporting the bare score for an unopposed winner.
  const repository = await readFile(
    new URL("../src/repository.mjs", import.meta.url),
    "utf8",
  );
  assert.match(repository, /matcherPolicyMargin\(score, runnerUpScore\)/);

  // Machine suggestions gate on the same definition instead of a divergent
  // coalesce(lead_margin, 1) sentinel.
  assert.doesNotMatch(repository, /coalesce\(lead\.lead_margin, 1\)/);
  assert.match(
    repository,
    /greatest\(0, prime_score - coalesce\(lead\(prime_score\) OVER/,
  );

  // The identity audit stores and gates the same margin.
  const audit = await readFile(
    new URL("../src/identity-audit.mjs", import.meta.url),
    "utf8",
  );
  assert.match(audit, /greatest\(0, score - coalesce\(next_score, -1\)\)/);
  assert.doesNotMatch(audit, /\sscore - coalesce\(next_score, -1\) >=/);
});
