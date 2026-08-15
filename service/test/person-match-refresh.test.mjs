import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { personMatchRefreshContract } from "../src/person-match-refresh.mjs";
import { selectPersonMistagRefreshOutcome } from "../src/person-mistag-refresh.mjs";

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
  assert.match(source, /FROM reference_bucket bucket/);
  assert.match(
    source,
    /JOIN LATERAL \(\s*SELECT DISTINCT ON \(event\.face_id\)/,
  );
  assert.match(source, /claim\.person_id = bucket\.person_id/);
  assert.match(source, /cimmich_person_match_refresh_physical_identity/);
  assert.match(source, /cimmich_person_match_refresh_target_accepted_asset/);
  assert.doesNotMatch(
    source,
    /JOIN current_matchable_physical_face accepted_face/,
  );
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

test("Person refresh probes its exact Head and mistag lanes before optional scoring", async () => {
  const source = await readFile(
    new URL("../src/person-match-refresh-repository.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /head\.person_id = \$\{id\}/);
  assert.match(source, /head\.bucket_kind = 'head'/);
  assert.match(source, /item\.audit_kind = 'accepted_contradiction'/);
  assert.match(source, /item\.review_state = 'open'/);
  assert.match(source, /item\.assigned_person_id = \$\{id\}/);
  assert.match(source, /item\.suggested_person_id = \$\{id\}/);
  assert.ok(
    source.indexOf("const scope = await scopes(personId)") <
      source.indexOf("await rescanHeads"),
  );
  assert.match(source, /scope\.headCount\s+\? await rescanHeads/);
  assert.match(
    source,
    /scope\.mistagCount\s+\? await mistagRefresher\.refresh/,
  );
});

test("bounded mistag refresh preserves current reasons or resolves the row", () => {
  assert.deepEqual(
    selectPersonMistagRefreshOutcome({
      alternative_person_id: "person-kostas",
      alternative_reference_asset_id: "asset-reference",
      alternative_score: 0.61,
      assigned_person_id: "person-meg",
      assigned_score: 0.2,
      comparison_score: 0.18,
      evidence_route: "own_cluster_outlier",
    }),
    {
      comparisonScore: 0.2,
      evidenceRoute: "cross_person_match",
      margin: 0.41,
      referenceAssetId: "asset-reference",
      score: 0.61,
      suggestedPersonId: "person-kostas",
    },
  );
  assert.deepEqual(
    selectPersonMistagRefreshOutcome({
      alternative_score: 0.3,
      assigned_person_id: "person-meg",
      assigned_score: 0.2,
      comparison_score: 0.18,
      evidence_route: "own_cluster_outlier",
      own_reference_asset_id: "asset-own",
      own_score: 0.12,
    }),
    {
      comparisonScore: 0.18,
      evidenceRoute: "own_cluster_outlier",
      margin: 0.06,
      referenceAssetId: "asset-own",
      score: 0.12,
      suggestedPersonId: "person-meg",
    },
  );
  assert.equal(
    selectPersonMistagRefreshOutcome({
      alternative_score: 0.3,
      assigned_person_id: "person-meg",
      assigned_score: 0.2,
      comparison_score: 0.18,
      evidence_route: "own_cluster_outlier",
      own_score: 0.25,
    }),
    null,
  );
});

test("bounded mistag refresh excludes aliases, same-photo people, and derivatives", async () => {
  const source = await readFile(
    new URL("../src/person-mistag-refresh.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /gallery\.physical_face_id <> lane\.physical_face_id/);
  assert.match(source, /accepted_people_by_asset AS MATERIALIZED/);
  assert.match(
    source,
    /same_photo_person\.person_id IS NULL\s+OR gallery\.person_id = lane\.assigned_person_id/,
  );
  assert.match(source, /cimmich_probable_same_photo_derivative/);
  assert.match(source, /item\.assigned_person_id = \$\{id\}/);
  assert.match(source, /item\.suggested_person_id = \$\{id\}/);
  assert.doesNotMatch(source, /INSERT INTO identity_claim/);
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
