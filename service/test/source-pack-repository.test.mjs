import assert from "node:assert/strict";
import test from "node:test";
import { loadSourcePackFaces } from "../src/source-pack-repository.mjs";

test("SourcePack inventory follows the canonical observation for each accepted physical Face", async () => {
  let query = "";
  const sql = async (strings) => {
    query = strings.join("?");
    return [
      {
        asset_id: "asset_detector",
        blocked_prime: false,
        capture_contexts: [],
        capture_time: "2025-01-01T00:00:00Z",
        condition_features: {},
        config_digest: "config",
        current_bucket_kind: null,
        decision_actor_kind: null,
        detection: 0.91,
        dimension: 3,
        embedding: "[1,0,0]",
        face_id: "face_detector_canonical",
        face_modifiers: [],
        face_pixel_height: 120,
        face_pixel_width: 100,
        gallery_permission: "allowed",
        identity_claim_id: "claim_xmp_alias",
        identity_origin: "trusted_import",
        identity_state: "accepted",
        manual_evidence_tier: null,
        max_other_prime_similarity: 0.2,
        model_family: "face",
        model_version: "v1",
        observation_origin: "detector",
        person_id: "person",
        person_needs_sort: false,
        pinned_prime: false,
        quality: 0.9,
        quality_source: "detector_geometry_proxy",
        source_instance_suffix: "",
        user_pinned_lq: false,
        user_pinned_secondary: false,
        vector_digest: "vector",
      },
    ];
  };

  const faces = await loadSourcePackFaces(sql);

  assert.match(query, /WITH accepted_physical_identity AS MATERIALIZED/);
  assert.match(query, /FROM accepted_physical_identity cfi/);
  assert.match(query, /WHERE identity\.state = 'accepted'/);
  assert.match(
    query,
    /JOIN face_observation fo ON fo\.face_id = cfi\.canonical_face_id/,
  );
  assert.match(query, /manual_evidence\.face_id = cfi\.claim_face_id/);
  assert.match(query, /gallery_state AS MATERIALIZED/);
  assert.match(query, /gallery\.physical_face_id = cfi\.physical_face_id/);
  assert.equal(faces.length, 1);
  assert.equal(faces[0].faceId, "face_detector_canonical");
  assert.equal(faces[0].assetId, "asset_detector");
  assert.equal(faces[0].quality, 0.9);
  assert.equal(faces[0].qualitySource, "detector_geometry_proxy");
  assert.equal(faces[0].sourceTierHint, "prime");
});
