import assert from "node:assert/strict";
import test from "node:test";
import { dedupeAssetFaces, identityQcFields } from "../src/repository.mjs";
import {
  isLowQualityEvidence,
  lowQualityReasons,
} from "../src/low-quality-policy.mjs";

test("identity QC keeps the ordinary blank import tier quiet", () => {
  assert.deepEqual(
    identityQcFields({
      detection_confidence: 0.92,
      face_pixel_height: 240,
      face_pixel_width: 180,
      nearby_face_count: 0,
      quality_measurements: { quality_score: 0.9 },
      source_instance_suffix: "blank",
    }).qc_flags,
    [],
  );
});

test("manual Face provenance keeps absent detector confidence truthful and quiet", () => {
  assert.deepEqual(
    identityQcFields({
      detection_confidence: null,
      face_pixel_height: 240,
      face_pixel_width: 180,
      nearby_face_count: 0,
      quality_measurements: { quality_score: 0.9 },
      source_instance_suffix: "",
    }).qc_flags,
    [],
  );
});

test("identity QC surfaces visible and import risks without changing identity", () => {
  assert.deepEqual(
    identityQcFields({
      detection_confidence: 0.64,
      face_pixel_height: 76,
      face_pixel_width: 54,
      nearby_face_count: 2,
      quality_measurements: { quality_score: 0.51 },
      source_instance_suffix: "11",
    }).qc_flags,
    [
      "tiny_face",
      "low_detection_confidence",
      "low_quality",
      "nearby_face",
      "ambiguous_import_suffix",
    ],
  );
});

test("asset evidence keeps accepted identity geometry over an overlapping unassigned detection", () => {
  const faces = dedupeAssetFaces([
    {
      box_h: 0.2,
      box_w: 0.2,
      box_x: 0.1,
      box_y: 0.1,
      detection_confidence: 0.99,
      face_id: "candidate",
    },
    {
      box_h: 0.2,
      box_w: 0.2,
      box_x: 0.105,
      box_y: 0.105,
      detection_confidence: 0.8,
      face_id: "accepted",
      identity_claim_id: "claim",
      person_id: "person",
    },
  ]);
  assert.deepEqual(
    faces.map((face) => face.face_id),
    ["accepted"],
  );
});

test("asset evidence removes a centre-aligned machine face nested inside accepted geometry", () => {
  const faces = dedupeAssetFaces([
    {
      box_h: 0.0851851852,
      box_w: 0.05,
      box_x: 0.4763888889,
      box_y: 0.2574074074,
      candidate_person_id: "person",
      detection_confidence: 0.8726,
      face_id: "nested_candidate",
    },
    {
      box_h: 0.1018518519,
      box_w: 0.0680555556,
      box_x: 0.4652777778,
      box_y: 0.2425925926,
      detection_confidence: 0.793506,
      face_id: "accepted",
      identity_claim_id: "claim",
      person_id: "person",
    },
  ]);
  assert.deepEqual(
    faces.map((face) => face.face_id),
    ["accepted"],
  );
});

test("asset evidence retains nearby faces whose centres and boxes are distinct", () => {
  const faces = dedupeAssetFaces([
    {
      box_h: 0.085,
      box_w: 0.05,
      box_x: 0.4,
      box_y: 0.25,
      detection_confidence: 0.9,
      face_id: "nearby_unknown",
    },
    {
      box_h: 0.1,
      box_w: 0.068,
      box_x: 0.465,
      box_y: 0.24,
      detection_confidence: 0.8,
      face_id: "accepted",
      identity_claim_id: "claim",
      person_id: "person",
    },
  ]);
  assert.deepEqual(
    faces.map((face) => face.face_id),
    ["nearby_unknown", "accepted"],
  );
});

test("LQ separates tiny or jointly degraded faces from ordinary Secondary evidence", () => {
  assert.deepEqual(
    lowQualityReasons({
      detection: 0.9,
      facePixelHeight: 50,
      facePixelWidth: 34,
      quality: 0.9,
    }),
    ["tiny_face"],
  );
  assert.deepEqual(
    lowQualityReasons({
      detection: 0.7,
      facePixelHeight: 160,
      facePixelWidth: 120,
      quality: 0.6,
    }),
    ["noisy_or_uncertain"],
  );
  assert.equal(
    isLowQualityEvidence({
      detection: 0.7,
      facePixelHeight: 160,
      facePixelWidth: 120,
      quality: 0.9,
    }),
    false,
  );
});
