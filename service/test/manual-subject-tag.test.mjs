import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanManualSubjectTagRegion,
  normalizeManualFaceMatchingTransition,
  normalizeManualSubjectTagAttach,
  normalizeManualSubjectTagReplace,
} from "../src/manual-subject-tag.mjs";

const digest = "a".repeat(64);

test("typed manual Face attach is exact and preserves normalized human geometry", () => {
  assert.deepEqual(
    normalizeManualSubjectTagAttach({
      actorId: "local-user",
      assetId: "asset-one",
      commandId: "manual.face.0001",
      region: { h: 0.4, w: 0.3, x: 0.1, y: 0.2 },
      subjectId: "person-one",
      subjectKind: "person",
      tagType: "face",
    }).region,
    { h: 0.4, w: 0.3, x: 0.1, y: 0.2 },
  );
  assert.throws(
    () => cleanManualSubjectTagRegion({ h: 0.4, w: 0.8, x: 0.3, y: 0.2 }),
    (error) => error.code === "MANUAL_SUBJECT_TAG_REGION_INVALID",
  );
});

test("manual Head is a first-class bounded observation for Person and Pet", () => {
  for (const subjectKind of ["person", "pet"]) {
    const normalized = normalizeManualSubjectTagAttach({
      actorId: "local-user",
      assetId: "asset-one",
      commandId: `manual.head.${subjectKind}`,
      region: { h: 0.2, w: 0.18, x: 0.3, y: 0.1 },
      subjectId: `${subjectKind}-one`,
      subjectKind,
      tagType: "head",
    });
    assert.equal(normalized.tagType, "head");
    assert.equal(normalized.subjectKind, subjectKind);
    assert.deepEqual(normalized.region, {
      h: 0.2,
      w: 0.18,
      x: 0.3,
      y: 0.1,
    });
  }
});

test("replacement input binds the route tag and expected current decision", () => {
  const normalized = normalizeManualSubjectTagReplace({
    actorId: "local-user",
    commandId: "manual.replace.0001",
    expectedDecisionId: "decision-current",
    region: { h: 0.4, w: 0.3, x: 0.1, y: 0.2 },
    subjectId: "pet-one",
    subjectKind: "pet",
    tagId: "head-tag-one",
    tagType: "body",
  });
  assert.equal(normalized.expectedDecisionId, "decision-current");
  assert.equal(normalized.tagId, "head-tag-one");
  assert.equal(normalized.tagType, "body");
  assert.throws(
    () => normalizeManualSubjectTagReplace({ ...normalized, extra: true }),
    (error) => error.code === "MANUAL_SUBJECT_TAG_INPUT_INVALID",
  );
});

test("caller-asserted provider space and tier cannot grant eligibility", () => {
  assert.throws(
    () =>
      normalizeManualFaceMatchingTransition({
        actorId: "local-worker",
        commandId: "manual.match.0001",
        configDigest: digest,
        embeddingId: "embedding-one",
        evidenceDigest: digest,
        evidenceTier: "secondary",
        modelFamily: "sface",
        modelVersion: "1.0",
        operationId: "operation-one",
        providerId: "opencv-local",
        reason: null,
        state: "eligible_for_evaluation",
        vectorDigest: digest,
        vectorSpaceId: "sface.2021dec",
      }),
    (error) => error.code === "MANUAL_FACE_RECOGNITION_EVIDENCE_REQUIRED",
  );
});

test("matching abstention is closed and eligible evidence cannot be incomplete", () => {
  const base = {
    actorId: "local-worker",
    commandId: "manual.match.0002",
    configDigest: digest,
    embeddingId: null,
    evidenceDigest: null,
    evidenceTier: null,
    modelFamily: "sface",
    modelVersion: "1.0",
    operationId: "operation-one",
    providerId: "opencv-local",
    reason: "invalid_face",
    state: "abstained",
    vectorDigest: null,
    vectorSpaceId: "sface.2021dec",
  };
  assert.equal(
    normalizeManualFaceMatchingTransition(base).reason,
    "invalid_face",
  );
  assert.throws(
    () =>
      normalizeManualFaceMatchingTransition({ ...base, reason: "free form" }),
    (error) => error.code === "MANUAL_SUBJECT_TAG_INPUT_INVALID",
  );
  assert.throws(
    () =>
      normalizeManualFaceMatchingTransition({
        ...base,
        reason: null,
        state: "eligible_for_evaluation",
      }),
    (error) => error.code === "MANUAL_FACE_RECOGNITION_EVIDENCE_REQUIRED",
  );
});
