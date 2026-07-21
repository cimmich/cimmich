import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeGeometryCorrection,
  normalizeObservationCorrectionUndo,
  normalizeObservationRegion,
  normalizeObservationRejection,
  observationCorrectionSchemaVersion,
} from "../src/observation-correction.mjs";

const base = {
  actorId: "operator-one",
  commandId: "correction.command.0001",
  expectedDecisionId: null,
  expectedRevision: 1,
};

test("geometry correction accepts only exact normalized revision-bound input", () => {
  assert.deepEqual(
    normalizeGeometryCorrection(
      { ...base, region: { h: 0.3, w: 0.2, x: 0.1, y: 0.2 } },
      "face",
      "face-one",
    ),
    {
      ...base,
      kind: "face",
      observationId: "face-one",
      region: { h: 0.3, w: 0.2, x: 0.1, y: 0.2 },
    },
  );
  assert.equal(
    observationCorrectionSchemaVersion,
    "cimmich.detailed-observation-correction.v1",
  );
  assert.throws(
    () =>
      normalizeGeometryCorrection(
        {
          ...base,
          extra: true,
          region: { h: 0.3, w: 0.2, x: 0.1, y: 0.2 },
        },
        "face",
        "face-one",
      ),
    (error) => error.code === "OBSERVATION_CORRECTION_INPUT_INVALID",
  );
});

test("regions reject scalar, overflow, zero area and non-finite values", () => {
  for (const region of [
    null,
    { h: 0.2, w: 0.3, x: 0.8, y: 0.1 },
    { h: 0.2, w: 0, x: 0.1, y: 0.1 },
    { h: 0.2, w: Number.NaN, x: 0.1, y: 0.1 },
  ]) {
    assert.throws(() => normalizeObservationRegion(region));
  }
});

test("Face and Body rejection remain explicit revision-bound commands", () => {
  assert.equal(
    normalizeObservationRejection(base, "face", "face-one").kind,
    "face",
  );
  assert.equal(
    normalizeObservationRejection(base, "body", "body-one").kind,
    "body",
  );
  assert.throws(() => normalizeObservationRejection(base, "head", "head-one"));
});

test("Undo accepts only actor and command while the decision is route-bound", () => {
  assert.deepEqual(
    normalizeObservationCorrectionUndo(
      { actorId: "operator-one", commandId: "correction.undo.0001" },
      "decision-one",
    ),
    {
      actorId: "operator-one",
      commandId: "correction.undo.0001",
      decisionId: "decision-one",
    },
  );
});
