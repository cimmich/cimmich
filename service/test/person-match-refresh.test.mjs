import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { personMatchRefreshContract } from "../src/person-match-refresh.mjs";

test("Person matcher refresh is bounded and human-review-only", async () => {
  assert.deepEqual(personMatchRefreshContract, {
    nearestPerReference: 500,
    policyVersion: "cimmich-person-match-refresh-v1",
    schemaVersion: "cimmich.person-match-refresh.v1",
  });
  const source = await readFile(
    new URL("../src/person-match-refresh.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(
    source.indexOf("const pack = await calibratedMatcher(sql)") <
      source.indexOf("await refreshPrime(id)"),
    "Matcher policy must fail fast before Prime maintenance",
  );
  assert.match(source, /FROM source_pack/);
  assert.match(
    source,
    /ORDER BY \(state = 'active'\) DESC, created_at DESC, pack_id DESC/,
  );
  assert.doesNotMatch(source, /FROM current_source_pack/);
  assert.match(source, /refreshPrime\(id\)/);
  assert.match(source, /current_reference_gallery/);
  assert.match(source, /gallery\.bucket_kind = 'prime'/);
  assert.match(source, /cimmich_face_match_eligible/);
  assert.match(source, /attention\.slug = 'sort'/);
  assert.match(source, /target_identity\.person_id = \$\{id\}/);
  assert.doesNotMatch(source, /FROM source_pack_reference gallery/);
  assert.match(source, /JOIN current_face_identity accepted/);
  assert.match(source, /'search_pool', 'unassigned_or_needs_attention'/);
  assert.match(source, /category\.slug IN \('sort', 'holding'\)/);
  assert.match(source, /target_score >= \$\{Number\(pack\.score_floor\)\}/);
  assert.match(source, /margin >= \$\{Number\(pack\.margin_floor\)\}/);
  assert.match(source, /'person_refresh_match', 'candidate'/);
  assert.match(source, /'authority', 'human_review_only'/);
  assert.match(source, /'automatic_identity_acceptance', false/);
  assert.match(source, /acceptedIdentityDelta/);
  assert.match(source, /automaticIdentityWrites: 0/);
});

test("new-Person batches trigger one post-batch matcher refresh without hiding a committed move failure", async () => {
  const source = await readFile(
    new URL("../src/person-match-refresh-repository.mjs", import.meta.url),
    "utf8",
  );
  const batch = source;
  assert.match(batch, /assignment\.createdPerson/);
  assert.match(batch, /await waitForMaintenanceIdle\(maintenanceSql\)/);
  assert.match(batch, /sql: maintenanceSql/);
  assert.doesNotMatch(batch, /requireVisibleSubject,\s+sql,/);
  assert.match(batch, /await refresher\.refresh/);
  assert.match(batch, /matcherRefreshFailures\.push/);
  assert.match(
    batch,
    /return \{ \.\.\.result, matcherRefreshes, matcherRefreshFailures \}/,
  );
});

test("the authenticated Person review route exposes explicit matcher refresh", async () => {
  const source = await readFile(
    new URL("../src/review-routes.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /\/matching\\\/refresh\$/);
  assert.match(source, /requireProjection\("person_review"\)/);
  assert.match(source, /repository\.refreshPersonMatches/);
});
