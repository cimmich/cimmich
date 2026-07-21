import assert from "node:assert/strict";
import test from "node:test";

import { createCimmichRepository } from "../src/repository.mjs";

test("Summary People count is structurally scoped to Person rows and never Pets", async () => {
  let summaryQuery = "";
  const sql = async (strings) => {
    const query = strings.join("?");
    if (query.includes("AS assets") && query.includes("AS people")) {
      summaryQuery = query;
      return [
        {
          accepted_presence: 0,
          assets: 50,
          body_observations: 0,
          candidate_signals: 0,
          face_observations: 0,
          people: 7,
          user_decisions: 0,
        },
      ];
    }
    return [];
  };
  const repository = createCimmichRepository(sql);
  const summary = await repository.summary();
  assert.equal(summary.people, 7);
  assert.match(
    summaryQuery,
    /FROM current_person\s+WHERE status = 'active' AND subject_kind = 'person'/,
  );
});
