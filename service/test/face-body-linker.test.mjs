import assert from "node:assert/strict";
import test from "node:test";
import {
  linkAssetFacesToBodies,
  projectAssetFaceBodyLinks,
} from "../src/face-body-linker.mjs";
import {
  bodyDetectionResultSchemaVersion,
  bodyDetectorSchemaVersion,
  deriveBodyDetectorConfigDigest,
  projectValidatedBodyResultToLinker,
  validateBodyDetectionResult,
} from "../src/body-detector-contract.mjs";

const face = (faceId, personId, boxX, boxY, boxW = 0.16, boxH = 0.18) => ({
  boxH,
  boxW,
  boxX,
  boxY,
  faceId,
  identityClaimId: `claim_${faceId}`,
  personId,
});
const body = (bodyId, boxX, boxY, boxW, boxH) => ({
  bodyId,
  boxH,
  boxW,
  boxX,
  boxY,
});

const detectorManifest = () => {
  const value = {
    detector: {
      artifactDigest: "a".repeat(64),
      modelId: "synthetic-body-detector",
      modelVersionId: "v1",
      scoreThreshold: 0.5,
    },
    execution: {
      device: "cpu",
      network: "forbidden",
      runtimeId: "synthetic-runtime",
      threads: 1,
    },
    licensing: { code: "declared", model: "unknown", trainingData: "unknown" },
    preprocessing: {
      colorSpace: "rgb",
      coordinateSpace: "normalized_image",
      inputHeight: 640,
      inputWidth: 640,
      resizeMode: "letterbox",
    },
    privacy: { externalUpload: "none", sourceMedia: "local-read-only" },
    provider: { providerId: "synthetic-provider", versionId: "v1" },
    resources: { maxMemoryMiB: 1024, maxRuntimeMs: 30_000 },
    schemaVersion: bodyDetectorSchemaVersion,
  };
  return {
    ...value,
    detectorConfigDigest: deriveBodyDetectorConfigDigest(value),
  };
};

const detectedBodies = (manifest, bodies, state = "bodies_detected") =>
  validateBodyDetectionResult(
    {
      assetToken: "b".repeat(64),
      bodies,
      detectorConfigDigest: manifest.detectorConfigDigest,
      inputRevision: "c".repeat(64),
      schemaVersion: bodyDetectionResultSchemaVersion,
      sourceContentDigest: "d".repeat(64),
      state,
    },
    manifest,
  );

test("global assignment links a group even when the broad middle body contains every face", () => {
  const result = linkAssetFacesToBodies({
    assetId: "group",
    bodies: [
      body("left_body", 0.0, 0.12, 0.31, 0.88),
      body("middle_body", 0.15, 0.03, 0.66, 0.97),
      body("right_body", 0.52, 0.0, 0.48, 1.0),
    ],
    faces: [
      face("left_face", "left_person", 0.11, 0.28),
      face("middle_face", "middle_person", 0.35, 0.14),
      face("right_face", "right_person", 0.71, 0.22),
    ],
  });
  assert.deepEqual(
    result.accepted.map((link) => [link.faceId, link.bodyId]),
    [
      ["left_face", "left_body"],
      ["middle_face", "middle_body"],
      ["right_face", "right_body"],
    ],
  );
  assert.equal(result.abstained.length, 0);
});

test("symmetric body ownership abstains instead of inventing a link", () => {
  const result = linkAssetFacesToBodies({
    assetId: "ambiguous",
    bodies: [
      body("body_a", 0.2, 0.05, 0.5, 0.9),
      body("body_b", 0.2, 0.05, 0.5, 0.9),
    ],
    faces: [face("face_a", "person_a", 0.37, 0.13)],
  });
  assert.equal(result.accepted.length, 0);
  assert.equal(result.abstained.length, 1);
  assert.equal(result.abstained[0].reason, "ambiguous_assignment");
});

test("display geometry links a body to an unresolved face without inventing Person ownership", () => {
  const [projected] = projectAssetFaceBodyLinks({
    assetId: "candidate_display",
    bodies: [body("body_a", 0.2, 0.05, 0.5, 0.9)],
    faces: [
      {
        ...face("face_a", undefined, 0.37, 0.13),
        identityClaimId: undefined,
      },
    ],
  });

  assert.equal(projected.faceLinkId, "face_a");
  assert.equal(projected.faceLinkState, "geometry");
  assert.equal(projected.personId, undefined);
  assert.ok(projected.faceLinkConfidence > 0);
});

test("display geometry preserves accepted and standalone Body ownership", () => {
  const projected = projectAssetFaceBodyLinks({
    assetId: "fixed_display",
    bodies: [
      {
        ...body("accepted_body", 0.2, 0.05, 0.5, 0.9),
        personId: "person_a",
        supportingFaceId: "accepted_face",
      },
      {
        ...body("standalone_body", 0.2, 0.05, 0.5, 0.9),
        personId: "person_b",
      },
    ],
    faces: [
      face("accepted_face", "person_a", 0.37, 0.13),
      face("other_face", undefined, 0.37, 0.13),
    ],
  });

  assert.equal(projected[0].faceLinkId, "accepted_face");
  assert.equal(projected[0].faceLinkState, "accepted_identity");
  assert.equal(projected[1].personId, "person_b");
  assert.equal(projected[1].faceLinkId, "other_face");
  assert.equal(projected[1].faceLinkState, "geometry");
  assert.ok(projected[1].faceLinkConfidence > 0);
});

test("standalone Body ownership never manufactures identity on its geometry-linked Face", () => {
  const sourceFace = {
    ...face("unresolved_face", undefined, 0.37, 0.13),
    identityClaimId: undefined,
  };
  const [projected] = projectAssetFaceBodyLinks({
    assetId: "standalone_identity_boundary",
    bodies: [
      {
        ...body("owned_body", 0.2, 0.05, 0.5, 0.9),
        personId: "person_a",
      },
    ],
    faces: [sourceFace],
  });

  assert.equal(projected.personId, "person_a");
  assert.equal(projected.faceLinkId, "unresolved_face");
  assert.equal(projected.faceLinkState, "geometry");
  assert.equal(sourceFace.personId, undefined);
  assert.equal(sourceFace.identityClaimId, undefined);
});

test("implausible lower-body face geometry is ineligible", () => {
  const result = linkAssetFacesToBodies({
    assetId: "bad_geometry",
    bodies: [body("body_a", 0.2, 0.05, 0.5, 0.9)],
    faces: [face("face_a", "person_a", 0.37, 0.72)],
  });
  assert.equal(result.accepted.length, 0);
  assert.equal(result.matchedCount, 0);
});

test("head geometry rejects a face that only falls inside a broad body box", () => {
  const bodyWithHead = {
    ...body("body_a", 0.1, 0.05, 0.8, 0.9),
    headBox: { boxH: 0.18, boxW: 0.18, boxX: 0.16, boxY: 0.1 },
  };
  const result = linkAssetFacesToBodies({
    assetId: "head_gate",
    bodies: [bodyWithHead],
    faces: [face("face_a", "person_a", 0.62, 0.12)],
  });
  assert.equal(result.accepted.length, 0);
  assert.equal(result.matchedCount, 0);
});

test("an over-threshold edge cannot perturb a valid assignment", () => {
  const asset = {
    assetId: "threshold",
    bodies: [body("body_a", 0, 0, 0.8, 1), body("body_b", 0, 0, 0.5, 1)],
    faces: [
      face("face_a", "person_a", 0.35, 0.12, 0.1),
      face("face_b", "person_b", 0.7, 0.12, 0.1),
    ],
  };
  const result = linkAssetFacesToBodies(asset, { maxCost: 0.2, minMargin: 0 });
  assert.deepEqual(
    result.accepted.map((link) => [link.faceId, link.bodyId]),
    [["face_a", "body_a"]],
  );
});

test("input order does not change assignment or confidence", () => {
  const faces = [
    face("face_b", "person_b", 0.62, 0.12),
    face("face_a", "person_a", 0.12, 0.12),
  ];
  const bodies = [
    body("body_b", 0.48, 0, 0.5, 1),
    body("body_a", 0, 0, 0.5, 1),
  ];
  const forward = linkAssetFacesToBodies({ assetId: "order", bodies, faces });
  const reverse = linkAssetFacesToBodies({
    assetId: "order",
    bodies: [...bodies].reverse(),
    faces: [...faces].reverse(),
  });
  assert.deepEqual(forward, reverse);
});

test("invalid policy values fail closed", () => {
  assert.throws(
    () =>
      linkAssetFacesToBodies(
        { assetId: "bad_policy", bodies: [], faces: [] },
        { maxCost: Number.NaN },
      ),
    /maxCost must be a positive finite number/,
  );
  assert.throws(
    () =>
      linkAssetFacesToBodies(
        { assetId: "bad_policy", bodies: [], faces: [] },
        { minMargin: -1 },
      ),
    /minMargin must be a non-negative finite number/,
  );
});

test("validated anonymous body packets integrate without identity authority", () => {
  const manifest = detectorManifest();
  const unique = projectValidatedBodyResultToLinker(
    detectedBodies(manifest, [
      { box: { h: 0.9, w: 0.45, x: 0, y: 0.05 }, confidence: 0.95 },
      { box: { h: 0.9, w: 0.45, x: 0.55, y: 0.05 }, confidence: 0.94 },
    ]),
  );
  const uniqueResult = linkAssetFacesToBodies({
    ...unique,
    faces: [
      face("anonymous_face_a", undefined, 0.13, 0.13),
      face("anonymous_face_b", undefined, 0.68, 0.13),
    ].map((item) => ({
      ...item,
      identityClaimId: undefined,
    })),
  });
  assert.equal(uniqueResult.accepted.length, 2);
  assert.equal(uniqueResult.abstained.length, 0);
  assert.doesNotMatch(
    JSON.stringify(uniqueResult),
    /personId|identityClaimId|person_id|identity_claim/i,
  );

  const ambiguous = projectValidatedBodyResultToLinker(
    detectedBodies(manifest, [
      { box: { h: 0.9, w: 0.5, x: 0.2, y: 0.05 }, confidence: 0.95 },
      { box: { h: 0.9, w: 0.5, x: 0.2, y: 0.05 }, confidence: 0.9 },
    ]),
  );
  const ambiguousResult = linkAssetFacesToBodies({
    ...ambiguous,
    faces: [
      {
        ...face("anonymous_face", undefined, 0.37, 0.13),
        identityClaimId: undefined,
      },
    ],
  });
  assert.equal(ambiguousResult.accepted.length, 0);
  assert.equal(ambiguousResult.abstained.length, 1);
  assert.equal(ambiguousResult.abstained[0].reason, "ambiguous_assignment");

  const noBody = projectValidatedBodyResultToLinker(
    detectedBodies(manifest, [], "no_body"),
  );
  const faces = [
    {
      ...face("independent_face", undefined, 0.2, 0.2),
      identityClaimId: undefined,
    },
  ];
  const facesBefore = structuredClone(faces);
  const noBodyResult = linkAssetFacesToBodies({ ...noBody, faces });
  assert.equal(noBodyResult.accepted.length, 0);
  assert.equal(noBodyResult.unmatchedFaces, 1);
  assert.deepEqual(faces, facesBefore);
});
