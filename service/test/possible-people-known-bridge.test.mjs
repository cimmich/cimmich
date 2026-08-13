import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizePossiblePeoplePreviewClusterIds,
  possiblePeoplePreviewBatchLimit,
} from "../src/possible-people-projection.mjs";

const readSource = (name) =>
  readFile(new URL(`../src/${name}`, import.meta.url), "utf8");

test("known-Person classification is versioned, separated and never identity authority", async () => {
  const [classifier, possiblePeople, previews, projection] = await Promise.all([
    readSource("possible-people-classifier.mjs"),
    readSource("possible-people.mjs"),
    readSource("known-person-cluster-previews.mjs"),
    readSource("possible-people-projection.mjs"),
  ]);

  assert.match(classifier, /known-person-v3-production-source-pack/);
  assert.match(classifier, /matcherPolicyVersion: "cimmich-best-prime-v1"/);
  assert.match(classifier, /scorer: "best_individual_prime"/);
  assert.match(classifier, /FROM current_source_pack pack/);
  assert.match(classifier, /FROM source_pack_reference reference/);
  assert.match(classifier, /reference\.pack_id = \$\{pack\.pack_id\}/);
  assert.match(classifier, /reference\.bucket_kind = 'prime'/);
  assert.match(classifier, /reference\.reference_kind = 'face'/);
  assert.match(classifier, /reference\.routing_state = 'eligible'/);
  assert.doesNotMatch(classifier, /ARRAY\['prime','secondary','lq','head'\]/);
  assert.match(classifier, /clusterConsensusFloor: 0\.5/);
  assert.match(classifier, /clusterMinimumVotes: 2/);
  assert.match(classifier, /clusterSampleLimit: 12/);
  assert.match(classifier, /distributed_member_consensus/);
  assert.match(classifier, /ntile\(\$\{clusterSampleLimit\}\)/);
  assert.match(classifier, /vote\.eligible_people = 1/);
  assert.match(classifier, /runnerPersonId/);
  assert.match(classifier, /referenceFaceId/);
  assert.match(classifier, /\$\{classificationVersion\}::text/);
  assert.match(classifier, /\$\{referenceNeighbourLimit\}::int/);
  assert.match(classifier, /\$\{knownPersonScoreFloor\}::float8/);
  assert.match(classifier, /\$\{knownPersonMarginFloor\}::float8/);
  assert.match(classifier, /'sourcePackId', \$\{pack\.pack_id\}::text/);
  assert.match(classifier, /classificationBinding/);
  assert.match(classifier, /rejectedPersonIds/);
  assert.doesNotMatch(classifier, /INSERT INTO identity_claim/);
  assert.doesNotMatch(classifier, /state\s*=\s*'accepted'/);

  assert.match(projection, /cluster\.suggested_person_id IS NULL/);
  assert.match(projection, /cluster\.suggested_person_id = \$\{/);
  assert.match(projection, /known-person-cluster-suggestions\.v2/);
  assert.match(projection, /possible-person-previews\.v1/);
  assert.match(projection, /readKnownPersonClusterPreviews/);
  assert.match(previews, /previewLimit = 7/);
  assert.match(previews, /DISTINCT ON \(member\.cluster_id, face\.asset_id\)/);
  assert.match(previews, /face\.box_x::float8/);
  assert.match(previews, /representative_rank/);

  assert.match(possiblePeople, /action === "not_suggested_person"/);
  assert.match(possiblePeople, /action === "ungroup"/);
  assert.match(possiblePeople, /possible_person_group_rejected/);
  assert.match(possiblePeople, /status = 'split'/);
  assert.match(possiblePeople, /possible_person_known_match_rejected/);
  assert.match(possiblePeople, /'cluster_id', \$\{cluster\.cluster_id\}::text/);
  assert.match(
    possiblePeople,
    /'policy_version', \$\{algorithmVersion\}::text/,
  );
  assert.match(
    possiblePeople,
    /'run_id', \$\{cluster\.possible_person_run_id\}::text/,
  );
  assert.match(possiblePeople, /'automatic_acceptance', 'false'/);
  assert.match(possiblePeople, /collision_asset_count/);
  assert.match(possiblePeople, /collision_face_count/);
  assert.match(possiblePeople, /accepted_face\.asset_id = face\.asset_id/);
  assert.match(
    possiblePeople,
    /member\.face_id, \$\{selectedPersonId\}.*'candidate'/s,
  );
});

test("generic Possible people previews are unique and bounded to one visible page", () => {
  assert.equal(possiblePeoplePreviewBatchLimit, 20);
  assert.deepEqual(
    normalizePossiblePeoplePreviewClusterIds([
      "cluster_a",
      "cluster_a",
      "cluster_b",
    ]),
    ["cluster_a", "cluster_b"],
  );
  assert.throws(
    () => normalizePossiblePeoplePreviewClusterIds([]),
    (error) =>
      error.statusCode === 400 &&
      error.code === "POSSIBLE_PEOPLE_PREVIEW_INPUT_INVALID",
  );
  assert.throws(
    () =>
      normalizePossiblePeoplePreviewClusterIds(
        Array.from({ length: 21 }, (_, index) => `cluster_${index}`),
      ),
    (error) =>
      error.statusCode === 400 &&
      error.code === "POSSIBLE_PEOPLE_PREVIEW_INPUT_INVALID",
  );
});

test("schema 124 records classification separately from the recurrence graph", async () => {
  const migration = await readFile(
    new URL(
      "../../migrations/0124_possible_people_known_person_bridge_v1.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /classification_state/);
  assert.match(migration, /suggested_person_id/);
  assert.match(migration, /suggestion_evidence jsonb/);
  assert.match(
    migration,
    /command_kind IN \('classify','refresh','resolve','undo'\)/,
  );
  assert.doesNotMatch(migration, /UPDATE identity_claim/);
});
