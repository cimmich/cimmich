import assert from "node:assert/strict";
import test from "node:test";
import {
  createPersonEvidenceCoverageStore,
  personEvidenceCoverageSchemaVersion,
} from "../src/person-evidence-coverage.mjs";

const projectionRow = {
  body_asset_count: 7,
  body_observation_count: 8,
  body_only_asset_count: 2,
  body_without_pose_count: 3,
  candidate_face_count: 4,
  contexts: [
    {
      assetCount: 5,
      displayName: "Bluewater",
      entityId: "place-bluewater",
      entityKind: "place",
    },
    {
      assetCount: 3,
      displayName: "Summer trip",
      entityId: "event-summer",
      entityKind: "event",
    },
  ],
  dated_asset_count: 11,
  display_name: "Maya Chen",
  face_asset_count: 9,
  face_observation_count: 12,
  first_capture_time: "2018-01-03T00:00:00.000Z",
  future_date_count: 1,
  head_asset_count: 1,
  head_observation_count: 1,
  head_reference_count: 1,
  last_capture_time: "2025-07-09T00:00:00.000Z",
  low_quality_reference_count: 2,
  person_id: "person-maya",
  pose_observation_count: 5,
  presence_asset_count: 2,
  presence_observation_count: 2,
  prime_reference_count: 3,
  secondary_reference_count: 6,
  source_suggestions: [
    {
      boxH: 0.3,
      boxW: 0.2,
      boxX: 0.4,
      boxY: 0.2,
      bucketKind: "prime",
      captureTime: "2024-05-01T00:00:00.000Z",
      faceId: "face-maya",
      filename: "maya.jpg",
      qualityScore: 0.91,
      sourceAssetId: "source-maya",
    },
  ],
  total_asset_count: 11,
  years: [
    { assetCount: 4, year: 2024 },
    { assetCount: 7, year: 2025 },
  ],
};

test("Person evidence coverage projects accepted evidence without mutation authority", async () => {
  const statements = [];
  const sql = async (strings) => {
    statements.push(strings.join("?"));
    return [projectionRow];
  };
  const store = createPersonEvidenceCoverageStore(sql, {
    presentationRank: () => 2,
    requireVisibleSubject: async (personId) => ({
      person_id: personId,
      subject_kind: "person",
    }),
  });

  const result = await store.read({ personId: "person-maya" });

  assert.equal(result.schemaVersion, personEvidenceCoverageSchemaVersion);
  assert.deepEqual(result.person, {
    displayName: "Maya Chen",
    personId: "person-maya",
  });
  assert.deepEqual(result.assets, {
    body: 7,
    bodyOnly: 2,
    dated: 11,
    face: 9,
    head: 1,
    presence: 2,
    total: 11,
  });
  assert.deepEqual(result.observations, {
    body: 8,
    face: 12,
    head: 1,
    pose: 5,
    presence: 2,
  });
  assert.deepEqual(result.context.places, [
    {
      assetCount: 5,
      displayName: "Bluewater",
      entityId: "place-bluewater",
    },
  ]);
  assert.equal(result.sourceSuggestions[0].qualityScore, 0.91);
  assert.deepEqual(result.authority, {
    automaticIdentityAuthority: "none",
    inference: "none",
    repositoryWrites: "none",
    sourceMutation: "none",
  });
  assert.equal(statements.length, 1);
  assert.match(statements[0], /current_face_identity/);
  assert.match(statements[0], /current_body_tag/);
  assert.match(statements[0], /body_pose_evidence/);
  assert.match(statements[0], /cimmich_visibility_asset_rank/);
  assert.match(statements[0], /cimmich_visibility_context_entity_rank/);
  assert.match(statements[0], /LIMIT 6/);
});

test("Person evidence coverage rejects Pets before the projection query", async () => {
  const store = createPersonEvidenceCoverageStore(
    async () => {
      throw new Error("SQL must not run");
    },
    {
      presentationRank: () => 0,
      requireVisibleSubject: async () => ({ subject_kind: "pet" }),
    },
  );

  await assert.rejects(
    store.read({ personId: "pet-juniper" }),
    (error) =>
      error.code === "PERSON_EVIDENCE_COVERAGE_KIND_INVALID" &&
      error.statusCode === 400,
  );
});
