import assert from "node:assert/strict";
import test from "node:test";
import {
  compileFaceLocalMeasurements,
  faceLocalMeasurementVersion,
} from "../src/face-local-measurement.mjs";

const observation = (overrides = {}) => ({
  contamination: {
    centerIntrusion: false,
    maximumOverlap: 0,
    nearbyFaceCount: 0,
  },
  cropDigests: {
    face: "face_crop_digest_1234567890",
    tight: "tight_crop_digest_1234567890",
  },
  faceId: "face_alpha",
  geometry: {
    boundaryTruncated: false,
    facePixelHeight: 128,
    facePixelWidth: 112,
  },
  photometrics: { dynamicRange: 0.7, lumaMedian: 0.45, sharpness: 0.82 },
  pose: { calibrated: true, pitchDegrees: 2, rollDegrees: 1, yawDegrees: 5 },
  quality: { calibrated: true, score: 0.88, threshold: 0.7 },
  targetSelection: {
    confidence: 0.98,
    expectedLandmarkCount: 478,
    landmarkCount: 478,
    state: "selected",
  },
  visibility: {
    regions: { eyes: 0.95, forehead: 0.9, jaw: 0.88, mouth: 0.96, nose: 0.97 },
    state: "measured",
  },
  ...overrides,
});

const packet = (observations) => ({
  observations,
  provider: {
    configDigest: "provider_config_digest_1234567890",
    cropPolicyVersion: "target-local-multicrop-v1",
    measurementVersion: faceLocalMeasurementVersion,
    model: "face-landmarker",
    modelVersion: "v1",
    name: "fixture-provider",
  },
});

test("landmarks alone do not claim face completeness", () => {
  const [measurement] = compileFaceLocalMeasurements(
    packet([observation({ visibility: { state: "unmeasured" } })]),
  );
  assert.equal(measurement.state, "measured");
  assert.equal(measurement.completeness, "unknown");
  assert.equal(measurement.visibleIdentityFraction, null);
  assert.equal(measurement.primeEligibility, "unknown");
});

test("objective source-boundary truncation marks a face incomplete", () => {
  const [measurement] = compileFaceLocalMeasurements(
    packet([
      observation({
        geometry: {
          boundaryTruncated: true,
          facePixelHeight: 90,
          facePixelWidth: 70,
        },
      }),
    ]),
  );
  assert.equal(measurement.state, "measured");
  assert.equal(measurement.completeness, "incomplete");
  assert.equal(measurement.primeEligibility, "unqualifying");
});

test("explicit region visibility can qualify a clean calibrated Prime source", () => {
  const [measurement] = compileFaceLocalMeasurements(packet([observation()]));
  assert.equal(measurement.completeness, "complete_enough");
  assert.equal(measurement.primeEligibility, "qualifying");
  assert.ok(measurement.visibleIdentityFraction > 0.9);
});

test("partial face visibility remains useful but cannot qualify for Prime", () => {
  const [measurement] = compileFaceLocalMeasurements(
    packet([
      observation({
        visibility: {
          regions: {
            eyes: 0.95,
            forehead: 0.2,
            jaw: 0.3,
            mouth: 0.9,
            nose: 0.92,
          },
          state: "measured",
        },
      }),
    ]),
  );
  assert.equal(measurement.completeness, "incomplete");
  assert.equal(measurement.primeEligibility, "unqualifying");
});

test("one independently blocked region proves incomplete without guessing the others", () => {
  const [measurement] = compileFaceLocalMeasurements(
    packet([
      observation({
        visibility: { regions: { eyes: 0.1 }, state: "partially_measured" },
      }),
    ]),
  );
  assert.equal(measurement.state, "measured");
  assert.equal(measurement.completeness, "incomplete");
  assert.equal(measurement.primeEligibility, "unqualifying");
  assert.equal(measurement.visibleIdentityFraction, null);
});

test("partially measured visible regions cannot claim completeness", () => {
  const [measurement] = compileFaceLocalMeasurements(
    packet([
      observation({
        visibility: {
          regions: { eyes: 0.95, mouth: 0.91 },
          state: "partially_measured",
        },
      }),
    ]),
  );
  assert.equal(measurement.completeness, "unknown");
  assert.equal(measurement.primeEligibility, "unknown");
});

test("uncalibrated pose cannot qualify a source for Prime", () => {
  const [measurement] = compileFaceLocalMeasurements(
    packet([
      observation({
        pose: {
          calibrated: false,
          pitchDegrees: 0,
          rollDegrees: 0,
          yawDegrees: 0,
        },
      }),
    ]),
  );
  assert.equal(measurement.completeness, "complete_enough");
  assert.equal(measurement.primeEligibility, "unknown");
});

test("a nearby face entering the target crop causes an honest abstention", () => {
  const [measurement] = compileFaceLocalMeasurements(
    packet([
      observation({
        contamination: {
          centerIntrusion: true,
          maximumOverlap: 0.02,
          nearbyFaceCount: 1,
        },
      }),
    ]),
  );
  assert.equal(measurement.state, "abstained");
  assert.equal(measurement.abstentionReason, "target_contaminated");
  assert.equal(measurement.completeness, "unknown");
});

test("provided target geometry can carry a clean region when landmarks are missing", () => {
  const [measurement] = compileFaceLocalMeasurements(
    packet([
      observation({
        contamination: {
          centerIntrusion: true,
          maximumOverlap: 0.2,
          nearbyFaceCount: 1,
          regions: {
            mouth: {
              centerIntrusion: false,
              maximumOverlap: 0,
              nearbyFaceCount: 0,
            },
          },
        },
        targetSelection: {
          confidence: null,
          expectedLandmarkCount: 68,
          landmarkConfidence: 0.08,
          landmarkCount: 68,
          landmarkState: "missing",
          method: "provided-cimmich-face-observation-box-v1",
          state: "provided",
        },
        visibility: { regions: { mouth: 0.1 }, state: "partially_measured" },
      }),
    ]),
  );
  assert.equal(measurement.state, "measured");
  assert.equal(measurement.completeness, "incomplete");
  assert.equal(measurement.primeEligibility, "unqualifying");
});

test("provided target geometry cannot launder a contaminated region", () => {
  const [measurement] = compileFaceLocalMeasurements(
    packet([
      observation({
        contamination: {
          centerIntrusion: false,
          maximumOverlap: 0,
          nearbyFaceCount: 1,
          regions: {
            mouth: {
              centerIntrusion: true,
              maximumOverlap: 0.02,
              nearbyFaceCount: 1,
            },
          },
        },
        targetSelection: {
          method: "provided-cimmich-face-observation-box-v1",
          state: "provided",
        },
        visibility: { regions: { mouth: 0.1 }, state: "partially_measured" },
      }),
    ]),
  );
  assert.equal(measurement.state, "abstained");
  assert.equal(measurement.abstentionReason, "target_contaminated");
  assert.equal(measurement.completeness, "unknown");
});

test("each measured region falls back independently when scoped contamination is absent", () => {
  const [measurement] = compileFaceLocalMeasurements(
    packet([
      observation({
        contamination: {
          centerIntrusion: true,
          maximumOverlap: 0.2,
          nearbyFaceCount: 1,
          regions: {
            mouth: {
              centerIntrusion: false,
              maximumOverlap: 0,
              nearbyFaceCount: 0,
            },
          },
        },
        targetSelection: {
          method: "provided-cimmich-face-observation-box-v1",
          state: "provided",
        },
        visibility: {
          regions: { eyes: 0.9, mouth: 0.1 },
          state: "partially_measured",
        },
      }),
    ]),
  );
  assert.equal(measurement.state, "abstained");
  assert.equal(measurement.abstentionReason, "target_contaminated");
});

test("measurement identity is deterministic and carries no identity decision", () => {
  const first = compileFaceLocalMeasurements(packet([observation()]));
  const second = compileFaceLocalMeasurements(
    packet([structuredClone(observation())]),
  );
  assert.deepEqual(first, second);
  assert.equal("personId" in first[0], false);
  assert.equal("decision" in first[0], false);
});

test("incomplete measured visibility fails closed", () => {
  assert.throws(
    () =>
      compileFaceLocalMeasurements(
        packet([
          observation({
            visibility: { regions: { eyes: 0.9 }, state: "measured" },
          }),
        ]),
      ),
    /all five face regions/,
  );
});

test("partial visibility state rejects empty or complete region sets", () => {
  assert.throws(
    () =>
      compileFaceLocalMeasurements(
        packet([
          observation({
            visibility: { regions: {}, state: "partially_measured" },
          }),
        ]),
      ),
    /between one and four/,
  );
  assert.throws(
    () =>
      compileFaceLocalMeasurements(
        packet([
          observation({
            visibility: {
              regions: observation().visibility.regions,
              state: "partially_measured",
            },
          }),
        ]),
      ),
    /between one and four/,
  );
});
