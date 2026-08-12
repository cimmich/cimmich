import assert from "node:assert/strict";
import test from "node:test";
import {
  createPersonEvidenceCoverageStore,
  personEvidenceCoverageSchemaVersion,
  projectPersonEvidenceCoverage,
} from "../src/person-evidence-coverage.mjs";

const projectionRow = {
  appearance_only_asset_count: 2,
  body_asset_count: 7,
  body_hint_observation_count: 2,
  body_observation_count: 8,
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
  co_subjects: [
    {
      assetCount: 6,
      crop: { h: 0.4, w: 0.4, x: 0.3, y: 0.2 },
      displayName: "Noah Chen",
      sourceAssetId: "source-noah",
      subjectId: "person-noah",
      subjectKind: "person",
    },
    {
      assetCount: 4,
      crop: null,
      displayName: "Juniper",
      sourceAssetId: null,
      subjectId: "pet-juniper",
      subjectKind: "pet",
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
  presence_only_asset_count: 1,
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
      sourceKind: "face",
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
    appearanceOnly: 2,
    body: 7,
    dated: 11,
    face: 9,
    head: 1,
    presence: 2,
    presenceOnly: 1,
    total: 11,
  });
  assert.deepEqual(result.observations, {
    body: 8,
    bodyHints: 2,
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
  assert.deepEqual(result.coSubjects, [
    {
      assetCount: 6,
      crop: { h: 0.4, w: 0.4, x: 0.3, y: 0.2 },
      displayName: "Noah Chen",
      sourceAssetId: "source-noah",
      subjectId: "person-noah",
      subjectKind: "person",
    },
    {
      assetCount: 4,
      crop: null,
      displayName: "Juniper",
      sourceAssetId: null,
      subjectId: "pet-juniper",
      subjectKind: "pet",
    },
  ]);
  assert.equal(result.sourceSuggestions[0].qualityScore, 0.91);
  assert.equal(result.sourceSuggestions[0].sourceKind, "face");
  assert.deepEqual(result.sourceSuggestions[0].box, {
    h: 0.3,
    w: 0.2,
    x: 0.4,
    y: 0.2,
  });
  assert.deepEqual(result.authority, {
    automaticIdentityAuthority: "none",
    inference: "none",
    repositoryWrites: "none",
    sourceMutation: "none",
  });
  assert.equal(statements.length, 1);
  assert.match(statements[0], /current_face_identity/);
  assert.match(statements[0], /all_accepted_faces AS MATERIALIZED/);
  assert.match(statements[0], /target_gallery AS MATERIALIZED/);
  assert.match(statements[0], /same_person_detector_faces AS MATERIALIZED/);
  assert.match(statements[0], /body_hint_faces AS MATERIALIZED/);
  assert.match(statements[0], /body_hint\.face_id IS NULL/);
  assert.match(statements[0], /accepted_body_hints AS MATERIALIZED/);
  assert.match(statements[0], /reference_head_faces AS MATERIALIZED/);
  assert.match(statements[0], /accepted_presence_assets AS MATERIALIZED/);
  assert.match(statements[0], /locator\.intended_tag_type = 'body'/);
  assert.match(statements[0], /has_body OR has_body_hint/);
  assert.match(
    statements[0],
    /NOT has_face AND \(has_head OR has_body OR has_body_hint\)/,
  );
  assert.match(statements[0], /has_presence AND NOT has_face AND NOT has_head/);
  assert.match(statements[0], /source_gallery_permission/);
  assert.match(statements[0], /effective_gallery_permission/);
  assert.match(statements[0], /resolution_kind = 'stronger_existing_truth'/);
  assert.match(statements[0], /current_body_tag/);
  assert.match(statements[0], /body_pose_evidence/);
  assert.match(statements[0], /cimmich_visibility_asset_rank/);
  assert.match(statements[0], /cimmich_visibility_context_entity_rank/);
  assert.match(statements[0], /co_subject_assets AS MATERIALIZED/);
  assert.match(statements[0], /cimmich_visibility_subject_rank/);
  assert.match(statements[0], /count\(DISTINCT asset_id\)::int AS asset_count/);
  assert.match(statements[0], /subject\.position <= 6/);
  assert.match(statements[0], /source_assets AS MATERIALIZED/);
  assert.match(statements[0], /'photo'::text AS source_kind/);
  assert.match(
    statements[0],
    /PARTITION BY extract\(year FROM source\.capture_time\)/,
  );
  assert.match(statements[0], /LIMIT 120/);
});

test("Person evidence coverage preserves a full-photo yearly fallback", () => {
  const result = projectPersonEvidenceCoverage({
    ...projectionRow,
    source_suggestions: [
      {
        boxH: null,
        boxW: null,
        boxX: null,
        boxY: null,
        captureTime: "2019-04-03T00:00:00.000Z",
        faceId: null,
        filename: "maya-body.jpg",
        sourceAssetId: "source-body",
        sourceKind: "photo",
      },
    ],
  });

  assert.equal(result.sourceSuggestions[0].faceId, null);
  assert.equal(result.sourceSuggestions[0].box, null);
  assert.equal(result.sourceSuggestions[0].sourceKind, "photo");
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
