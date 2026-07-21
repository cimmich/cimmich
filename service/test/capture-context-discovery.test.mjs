import assert from "node:assert/strict";
import test from "node:test";
import {
  captureContextDiscoveryVersion,
  classifyCaptureContextPair,
} from "../src/capture-context-discovery.mjs";

test("time proximity alone cannot manufacture a capture context", () => {
  assert.equal(
    classifyCaptureContextPair({
      timeDeltaSeconds: 1,
      perceptualSimilarity: 0.25,
    }),
    null,
  );
});

test("rapid burst requires temporal, visual and continuity evidence", () => {
  const candidate = classifyCaptureContextPair({
    filenameSequenceDelta: 1,
    perceptualSimilarity: 0.9,
    sameDevice: true,
    timeDeltaSeconds: 2,
  });
  assert.equal(candidate.contextKind, "rapid_burst");
  assert.equal(candidate.independenceDisposition, "shared-capture-context");
  assert.equal(candidate.providerVersion, captureContextDiscoveryVersion);
  assert.equal(candidate.confidence > 0.9, true);
});

test("same moment admits complementary frames without counting coappearance as identity", () => {
  const candidate = classifyCaptureContextPair({
    acceptedCoappearanceCount: 4,
    filenameSequenceDelta: 5,
    perceptualSimilarity: 0.91,
    timeDeltaSeconds: 44,
  });
  assert.equal(candidate.contextKind, "same_moment");
  assert.equal(candidate.evidence.acceptedCoappearanceCount, 4);
  assert.equal("personId" in candidate, false);
});

test("coappearance and filename continuity cannot overcome weak visual evidence", () => {
  assert.equal(
    classifyCaptureContextPair({
      acceptedCoappearanceCount: 8,
      filenameSequenceDelta: 1,
      perceptualSimilarity: 0.4,
      sameDevice: true,
      timeDeltaSeconds: 20,
    }),
    null,
  );
});

test("duplicate exports collapse independence without pretending to be a burst", () => {
  const candidate = classifyCaptureContextPair({
    exactDuplicate: true,
    timeDeltaSeconds: 86400,
  });
  assert.equal(candidate.contextKind, "sequence");
  assert.equal(candidate.independenceDisposition, "same-source-observation");
  assert.equal(candidate.confidence, 1);
});
