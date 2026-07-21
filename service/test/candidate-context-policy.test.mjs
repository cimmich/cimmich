import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateSurvivesSamePhotoPrior,
  samePhotoAcceptedCandidateFloor,
} from "../src/candidate-context-policy.mjs";

test("same-photo accepted identity suppresses an ordinary candidate", () => {
  assert.equal(
    candidateSurvivesSamePhotoPrior({
      samePhotoAccepted: true,
      score: 0.457784,
    }),
    false,
  );
});

test("same-photo context is a prior rather than a hard identity ban", () => {
  assert.equal(
    candidateSurvivesSamePhotoPrior({
      samePhotoAccepted: true,
      score: samePhotoAcceptedCandidateFloor,
    }),
    true,
  );
});

test("candidate strength is unchanged when the Person is absent from the photo", () => {
  assert.equal(
    candidateSurvivesSamePhotoPrior({
      samePhotoAccepted: false,
      score: 0.2,
    }),
    true,
  );
});
