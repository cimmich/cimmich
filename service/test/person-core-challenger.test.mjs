import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluatePersonCoreChallengerHoldout,
  selectPersonCoreChallenger,
} from "../src/person-core-challenger.mjs";

const outcome = (
  queryFaceId,
  truthPersonId,
  robustWinnerPersonId,
  primeMargin,
  truthRobustScore,
) => ({
  primeMargin,
  queryFaceId,
  robustCorrect: robustWinnerPersonId === truthPersonId,
  robustWinnerPersonId,
  truthPersonId,
  truthRobustScore,
});

const common = {
  baselineCoreFaceIds: ["face_a", "face_b"],
  baselinePackId: "sourcepack_baseline",
  candidateCoreFaceIds: ["face_a", "face_c"],
  candidatePackId: "sourcepack_candidate",
  cohortDigest: "a".repeat(64),
  targetPersonId: "person_spencer",
};

test("margin-only calibration may nominate a candidate but a neutral holdout retains baseline", () => {
  const baseline = [
    outcome("q1", "person_spencer", "person_spencer", 0.08, 0.7),
    outcome("q2", "person_other", "person_other", 0.12, 0.8),
  ];
  const calibrationCandidate = [
    outcome("q1", "person_spencer", "person_spencer", 0.09, 0.71),
    outcome("q2", "person_other", "person_other", 0.12, 0.8),
  ];
  const selection = selectPersonCoreChallenger({
    ...common,
    baselineRows: baseline,
    candidateRows: calibrationCandidate,
  });
  assert.equal(selection.selection, "selected_for_holdout");

  const result = evaluatePersonCoreChallengerHoldout(selection, {
    baselineRows: baseline,
    candidateRows: baseline,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.recommendation, "retain_baseline");
  assert.equal(result.holdout.correctDelta, 0);
  assert.equal(result.authority.activation, "none");
});

test("an independently held-out rescue without regressions reaches human review only", () => {
  const calibrationBaseline = [
    outcome("q1", "person_spencer", "person_other", 0.01, 0.49),
    outcome("q2", "person_other", "person_other", 0.12, 0.8),
  ];
  const calibrationCandidate = [
    outcome("q1", "person_spencer", "person_spencer", 0.03, 0.54),
    outcome("q2", "person_other", "person_other", 0.12, 0.8),
  ];
  const selection = selectPersonCoreChallenger({
    ...common,
    baselineRows: calibrationBaseline,
    candidateRows: calibrationCandidate,
  });
  const result = evaluatePersonCoreChallengerHoldout(selection, {
    baselineRows: [
      outcome("h1", "person_spencer", "person_other", 0.01, 0.48),
      outcome("h2", "person_other", "person_other", 0.1, 0.76),
    ],
    candidateRows: [
      outcome("h1", "person_spencer", "person_spencer", 0.025, 0.53),
      outcome("h2", "person_other", "person_other", 0.1, 0.76),
    ],
  });
  assert.equal(result.status, "passed");
  assert.equal(result.recommendation, "eligible_for_human_review");
  assert.equal(result.holdout.rescues, 1);
  assert.equal(result.holdout.falseFlips, 0);
  assert.equal(result.authority.automaticIdentityAuthority, "none");
});

test("a calibration false flip rejects the challenger before holdout", () => {
  const selection = selectPersonCoreChallenger({
    ...common,
    baselineRows: [
      outcome("q1", "person_spencer", "person_spencer", 0.08, 0.7),
      outcome("q2", "person_other", "person_other", 0.12, 0.8),
    ],
    candidateRows: [
      outcome("q1", "person_spencer", "person_spencer", 0.09, 0.72),
      outcome("q2", "person_other", "person_spencer", 0.01, 0.4),
    ],
  });
  assert.equal(selection.selection, "retain_baseline");
  assert.equal(selection.calibration.falseFlips, 1);
  assert.throws(
    () =>
      evaluatePersonCoreChallengerHoldout(selection, {
        baselineRows: [],
        candidateRows: [],
      }),
    /calibration-selected candidate/,
  );
});

test("cohort drift and copied selection receipts fail closed", () => {
  assert.throws(
    () =>
      selectPersonCoreChallenger({
        ...common,
        baselineRows: [
          outcome("q1", "person_spencer", "person_spencer", 0.08, 0.7),
        ],
        candidateRows: [
          outcome("q2", "person_spencer", "person_spencer", 0.09, 0.72),
        ],
      }),
    /cohorts differ/,
  );
  const selection = selectPersonCoreChallenger({
    ...common,
    baselineRows: [
      outcome("q1", "person_spencer", "person_spencer", 0.08, 0.7),
    ],
    candidateRows: [
      outcome("q1", "person_spencer", "person_spencer", 0.09, 0.72),
    ],
  });
  assert.throws(
    () =>
      evaluatePersonCoreChallengerHoldout(
        { ...selection, candidatePackId: "sourcepack_substituted" },
        {
          baselineRows: [
            outcome("h1", "person_spencer", "person_spencer", 0.08, 0.7),
          ],
          candidateRows: [
            outcome("h1", "person_spencer", "person_spencer", 0.09, 0.72),
          ],
        },
      ),
    /digest does not match/,
  );
});
