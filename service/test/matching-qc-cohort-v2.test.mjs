import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createMatchingQcReceiptV2,
  createMatchingQcReviewPacketV2,
  matchingQcCandidateArtifactV2Digest,
  matchingQcCohortV2Digest,
  matchingQcCohortV2SchemaVersion,
  matchingQcCompletionV2SchemaVersion,
  matchingQcReceiptV2SchemaVersion,
  matchingQcTruthVersionV2Digest,
  validateMatchingQcCompletionV2,
} from "../src/matching-qc-cohort.mjs";
import { recognitionDigest } from "../src/recognition-provider-contract.mjs";

const token = (value) => recognitionDigest(value);
const providerConfigDigest = token("provider-config-v2");
const vectorSpaceId = `vector_space_${token("vector-space-v2")}`;
const serviceRoot = fileURLToPath(new URL("../", import.meta.url));

const decision = (key, candidateToken) => ({
  candidateToken,
  firstResultDigest: token(`${key}:result`),
  secondResultDigest: token(`${key}:result`),
});

const row = ({ key, baseline, candidate, truth, truthState = "resolved" }) => {
  const candidates = [token(`${key}:candidate:a`), token(`${key}:candidate:b`)];
  return {
    baseline: decision(`${key}:baseline`, candidates[baseline]),
    candidate: decision(`${key}:candidate`, candidates[candidate]),
    eligibleCandidateTokens: candidates,
    queryToken: token(`${key}:query`),
    truth: {
      candidateToken:
        truth === "outside" ? token(`${key}:truth:outside`) : candidates[truth],
      state: truthState,
    },
  };
};

const buildCohort = () => {
  const calibrationRows = [
    row({ key: "calibration-a", baseline: 0, candidate: 0, truth: 0 }),
    row({ key: "calibration-b", baseline: 1, candidate: 1, truth: 1 }),
  ];
  const holdoutRows = [
    row({
      baseline: 0,
      candidate: 1,
      key: "holdout-neutral",
      truth: "outside",
      truthState: "resolved_outside_candidate_set",
    }),
    row({
      baseline: 0,
      candidate: 1,
      key: "holdout-group-conflict",
      truth: 0,
    }),
  ];
  const referenceTokens = {
    calibration: [token("calibration-reference")],
    holdout: [token("holdout-reference")],
  };
  const candidatePolicy = {
    policyId: "bucket-policy-v2",
    providerConfigDigest,
    vectorSpaceId,
  };
  const cohortDigest = matchingQcCohortV2Digest({
    calibrationRows,
    holdoutRows,
    referenceTokens,
  });
  const truthVersionDigest = matchingQcTruthVersionV2Digest({
    calibrationRows,
    holdoutRows,
  });
  return {
    authority: "human_review",
    baseline: {
      policyId: "prime-baseline-v2",
      providerConfigDigest,
      vectorSpaceId,
    },
    calibration: { rows: calibrationRows },
    candidate: {
      ...candidatePolicy,
      artifactDigest: matchingQcCandidateArtifactV2Digest({
        calibrationRows,
        candidate: candidatePolicy,
        holdoutRows,
      }),
    },
    experiment: {
      cohortDigest,
      experimentId: "neutral-and-conflict-v2",
      providerConfigDigest,
      truthVersionDigest,
      vectorSpaceId,
    },
    gate: {
      maximumConfirmedModelRegressions: 0,
      minimumConfirmedNetGain: 1,
      minimumHoldoutQueries: 2,
      requireCompleteQc: true,
    },
    holdout: { rows: holdoutRows },
    protocol: {
      calibrationFrozenBeforeHoldout: true,
      holdoutAccess: "selected_candidate_once",
    },
    referenceTokens,
    schemaVersion: matchingQcCohortV2SchemaVersion,
  };
};

const completion = (packet, overrides = new Map()) => ({
  items: packet.reviewItems.map((item) => ({
    disposition: overrides.get(item.queryToken) || item.allowedDispositions[0],
    queryToken: item.queryToken,
    reviewEvidenceDigest: token(`visual-review:${item.queryToken}`),
    reviewItemDigest: item.reviewItemDigest,
  })),
  packetDigest: packet.packetDigest,
  schemaVersion: matchingQcCompletionV2SchemaVersion,
});

test("V2 distinguishes a resolved wrong-to-wrong swap from a model regression", () => {
  const packet = createMatchingQcReviewPacketV2(buildCohort());
  const neutral = packet.reviewItems.find(
    (item) => item.truthState === "resolved_outside_candidate_set",
  );
  assert.deepEqual(neutral.allowedDispositions, [
    "confirmed_model_neutral",
    "ambiguous_group_tag",
    "historical_tag_error",
    "metadata_context_conflict",
    "unreviewed",
    "visually_unresolvable",
  ]);
  const conflict = packet.reviewItems.find(
    (item) => item.truthState === "resolved",
  );
  const receipt = createMatchingQcReceiptV2(
    validateMatchingQcCompletionV2({
      completion: completion(
        packet,
        new Map([[conflict.queryToken, "ambiguous_group_tag"]]),
      ),
      packet,
    }),
  );
  assert.equal(receipt.schemaVersion, matchingQcReceiptV2SchemaVersion);
  assert.equal(receipt.metrics.holdout.qc.confirmedModelNeutral, 1);
  assert.equal(receipt.metrics.holdout.qc.ambiguousGroupTag, 1);
  assert.equal(receipt.metrics.holdout.qc.confirmedModelRegression, 0);
  assert.equal(receipt.metrics.holdout.confirmedNetGain, 0);
  assert.equal(receipt.decision.status, "rejected");
  assert.deepEqual(receipt.decision.reasons, [
    "CONFIRMED_NET_GAIN_GATE_FAILED",
  ]);
  assert.equal(receipt.boundary.visualReviewEvidenceBinding, "digest_bound");
  assert.equal(receipt.authority.recommendation, "none");
  assert.equal(receipt.authority.activation, "none");
});

test("V2 conflict override is human-review-only and evidence-digest-bound", () => {
  const packet = createMatchingQcReviewPacketV2(buildCohort());
  const neutral = packet.reviewItems.find(
    (item) => item.truthState === "resolved_outside_candidate_set",
  );
  const invalidDisposition = completion(packet);
  invalidDisposition.items.find(
    (item) => item.queryToken === neutral.queryToken,
  ).disposition = "confirmed_model_rescue";
  assert.throws(
    () =>
      validateMatchingQcCompletionV2({
        completion: invalidDisposition,
        packet,
      }),
    (error) => error.code === "MATCHING_QC_INPUT_INVALID",
  );

  const missingEvidence = completion(packet);
  delete missingEvidence.items[0].reviewEvidenceDigest;
  assert.throws(
    () =>
      validateMatchingQcCompletionV2({ completion: missingEvidence, packet }),
    (error) => error.code === "MATCHING_QC_INPUT_INVALID",
  );
});

test("V2 exact envelope and minimized receipt remain copy-safe and public-safe", () => {
  const packet = createMatchingQcReviewPacketV2(buildCohort());
  const envelope = validateMatchingQcCompletionV2({
    completion: completion(packet),
    packet,
  });
  assert.throws(
    () => createMatchingQcReceiptV2(Object.freeze({ ...envelope })),
    (error) => error.code === "MATCHING_QC_INPUT_INVALID",
  );
  const serialized = JSON.stringify(createMatchingQcReceiptV2(envelope));
  assert.doesNotMatch(
    serialized,
    /filename|filepath|personId|personName|subjectId|credential|https?:\/\//i,
  );
});

test("V2 derives leakage against each fold rather than the other fold", () => {
  const base = buildCohort();
  const calibrationQuery = base.calibration.rows[0].queryToken;
  const holdoutQuery = base.holdout.rows[0].queryToken;
  const withReferences = (referenceTokens) => ({
    ...base,
    experiment: {
      ...base.experiment,
      cohortDigest: matchingQcCohortV2Digest({
        calibrationRows: base.calibration.rows,
        holdoutRows: base.holdout.rows,
        referenceTokens,
      }),
    },
    referenceTokens,
  });

  const crossFold = createMatchingQcReviewPacketV2(
    withReferences({
      calibration: [holdoutQuery],
      holdout: [calibrationQuery],
    }),
  );
  const crossFoldReceipt = createMatchingQcReceiptV2(
    validateMatchingQcCompletionV2({
      completion: completion(crossFold),
      packet: crossFold,
    }),
  );
  assert.doesNotMatch(
    crossFoldReceipt.decision.reasons.join(","),
    /QUERY_REFERENCE_LEAKAGE/,
  );

  const sameFold = createMatchingQcReviewPacketV2(
    withReferences({
      calibration: [calibrationQuery],
      holdout: [holdoutQuery],
    }),
  );
  const sameFoldReceipt = createMatchingQcReceiptV2(
    validateMatchingQcCompletionV2({
      completion: completion(sameFold),
      packet: sameFold,
    }),
  );
  assert.match(
    sameFoldReceipt.decision.reasons.join(","),
    /QUERY_REFERENCE_LEAKAGE/,
  );
});

test("the bounded CLI prepares and evaluates V2 without echoing invalid input", () => {
  const prepared = spawnSync(
    process.execPath,
    ["bin/evaluate-matching-qc-cohort.mjs"],
    {
      cwd: serviceRoot,
      encoding: "utf8",
      input: JSON.stringify({ action: "prepare", cohort: buildCohort() }),
    },
  );
  assert.equal(prepared.status, 0, prepared.stderr);
  const packet = JSON.parse(prepared.stdout);
  const evaluated = spawnSync(
    process.execPath,
    ["bin/evaluate-matching-qc-cohort.mjs"],
    {
      cwd: serviceRoot,
      encoding: "utf8",
      input: JSON.stringify({
        action: "evaluate",
        completion: completion(packet),
        packet,
      }),
    },
  );
  assert.equal(evaluated.status, 0, evaluated.stderr);
  assert.equal(
    JSON.parse(evaluated.stdout).schemaVersion,
    matchingQcReceiptV2SchemaVersion,
  );

  const invalid = spawnSync(
    process.execPath,
    ["bin/evaluate-matching-qc-cohort.mjs"],
    {
      cwd: serviceRoot,
      encoding: "utf8",
      input: JSON.stringify({
        action: "prepare",
        cohort: { ...buildCohort(), privatePath: "/private/example" },
      }),
    },
  );
  assert.equal(invalid.status, 1);
  assert.equal(
    invalid.stderr.trim(),
    JSON.stringify({ error: { code: "MATCHING_QC_INPUT_INVALID" } }),
  );
  assert.doesNotMatch(invalid.stderr, /private\/example/);
});
