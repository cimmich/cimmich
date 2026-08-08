import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (name) =>
  readFile(new URL(`../src/${name}`, import.meta.url), "utf8");

test("known-Person classification is versioned, separated and never identity authority", async () => {
  const [classifier, possiblePeople, previews, projection] = await Promise.all([
    readSource("possible-people-classifier.mjs"),
    readSource("possible-people.mjs"),
    readSource("known-person-cluster-previews.mjs"),
    readSource("possible-people-projection.mjs"),
  ]);

  assert.match(classifier, /knownPersonScoreFloor: 0\.55/);
  assert.match(classifier, /knownPersonMarginFloor: 0\.1/);
  assert.match(classifier, /runnerPersonId/);
  assert.match(classifier, /referenceFaceId/);
  assert.match(classifier, /\$\{classificationVersion\}::text/);
  assert.match(classifier, /\$\{referenceNeighbourLimit\}::int/);
  assert.match(classifier, /\$\{knownPersonScoreFloor\}::float8/);
  assert.match(classifier, /\$\{knownPersonMarginFloor\}::float8/);
  assert.match(classifier, /rejectedPersonIds/);
  assert.doesNotMatch(classifier, /INSERT INTO identity_claim/);
  assert.doesNotMatch(classifier, /state\s*=\s*'accepted'/);

  assert.match(projection, /cluster\.suggested_person_id IS NULL/);
  assert.match(projection, /cluster\.suggested_person_id = \$\{/);
  assert.match(projection, /known-person-cluster-suggestions\.v2/);
  assert.match(previews, /previewLimit = 7/);
  assert.match(previews, /DISTINCT ON \(member\.cluster_id, face\.asset_id\)/);
  assert.match(previews, /face\.box_x::float8/);
  assert.match(previews, /representative_rank/);

  assert.match(possiblePeople, /action === "not_suggested_person"/);
  assert.match(possiblePeople, /action === "ungroup"/);
  assert.match(possiblePeople, /possible_person_group_rejected/);
  assert.match(possiblePeople, /status = 'split'/);
  assert.match(possiblePeople, /possible_person_known_match_rejected/);
  assert.match(possiblePeople, /'automatic_acceptance', 'false'/);
  assert.match(
    possiblePeople,
    /member\.face_id, \$\{selectedPersonId\}.*'candidate'/s,
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
