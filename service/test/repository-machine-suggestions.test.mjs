import assert from "node:assert/strict";
import test from "node:test";
import { createCimmichRepository } from "../src/repository.mjs";

const matchingProvider = Object.freeze({
  configDigest: "a".repeat(64),
  modelFamily: "synthetic-recognizer",
  modelVersion: "cimmich-target-centric-v2",
  providerId: "synthetic-local-provider",
  vectorSpaceId: "vector-space-synthetic-v1",
});

test("machine review fails closed before SQL without a configured provider", async () => {
  let calls = 0;
  const repository = createCimmichRepository(async () => {
    calls += 1;
    return [];
  });
  assert.deepEqual(await repository.machineSuggestions({ limit: 24 }), []);
  assert.equal(calls, 0);
});

test("matching status requires one policy-bound active passed SourcePack", async () => {
  let statement = "";
  const repository = createCimmichRepository(
    async (strings) => {
      statement = strings.join("?");
      return [
        {
          active_passed: 1,
          active_ready: 1,
          awaiting_review: 0,
          margin_floor: 0.08,
          score_floor: 0.52,
        },
      ];
    },
    new Map(),
    null,
    { matchingProvider },
  );
  const status = await repository.faceMatchingStatus();
  assert.equal(status.state, "ready");
  assert.equal(status.review.enabled, true);
  assert.equal(status.review.scoreFloor, 0.52);
  assert.match(statement, /evaluation_summary->'matcherPolicy'/);
  assert.match(statement, /evaluation_status = 'passed'/);
  assert.equal(status.automaticIdentityAuthority, "none");
});

test("simultaneous machine review consumers share one best-Prime scoring snapshot", async () => {
  let calls = 0;
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  let statement = "";
  const sql = async (strings) => {
    calls += 1;
    statement = strings.join("?");
    await blocked;
    return [];
  };
  const repository = createCimmichRepository(sql, new Map(), null, {
    conditionConsensusReviewEnabled: false,
    matchingProvider,
  });

  const first = repository.machineSuggestions({ limit: 3 });
  const second = repository.machineSuggestions({ limit: 24 });
  assert.equal(calls, 1);
  assert.match(statement, /individual\.individual_max::float8 AS prime_score/);
  assert.match(statement, /JOIN current_source_pack pack/);
  assert.match(statement, /pack\.evaluation_status = 'passed'/);
  assert.match(statement, /JOIN source_pack_matching_gallery gallery/);
  assert.match(statement, /gallery\.pack_id = query\.pack_id/);
  assert.doesNotMatch(statement, /JOIN current_reference_gallery gallery/);
  assert.match(statement, /NULL::float8 AS prototype_score/);
  assert.doesNotMatch(statement, /secondary_scores AS MATERIALIZED/);
  assert.doesNotMatch(statement, /0\.45 \* individual\.individual_top3/);
  assert.match(statement, /embedding\.config_digest \|\| ':' \|\|/);
  assert.match(statement, /lead_can_suggest/);
  assert.match(statement, /current_asset_source_revision/);
  assert.match(
    statement,
    /job\.result_receipt_id = embedding\.producer_receipt_id/,
  );
  assert.match(statement, /runtime_recognized_at IS NOT NULL/);
  assert.match(statement, /visible_active_assets AS MATERIALIZED/);
  assert.match(statement, /accepted_people_by_asset AS MATERIALIZED/);
  assert.match(statement, /query_frontier AS MATERIALIZED/);
  assert.match(
    statement,
    /CROSS JOIN LATERAL \(\s+SELECT current_embedding\.embedding/,
  );
  assert.match(
    statement,
    /current_embedding\.embedding_id = frontier\.embedding_id[\s\S]+OFFSET 0/,
  );
  assert.match(
    statement,
    /LEFT JOIN accepted_people_by_asset same_photo_person/,
  );
  assert.doesNotMatch(
    statement,
    /runtime\.runtime_recognized_at IS NOT NULL\s+OR NOT EXISTS/,
  );
  assert.match(statement, /overlap\.intersection/);

  release();
  assert.deepEqual(await first, []);
  assert.deepEqual(await second, []);
  assert.deepEqual(await repository.machineSuggestions({ limit: 24 }), []);
  assert.equal(calls, 1);
});

test("machine suggestion limits truncate one stable ranked projection shared with summary", async () => {
  let scoringCalls = 0;
  let summaryCalls = 0;
  let scoringValues = [];
  const candidateRow = (index) => ({
    asset_id: `asset-${index}`,
    box_h: 0.2,
    box_w: 0.2,
    box_x: 0.1,
    box_y: 0.1,
    candidate_rank: 1,
    can_suggest: true,
    capture_time: null,
    detection_confidence: 0.9 - index * 0.01,
    display_name: `Person ${index}`,
    face_id: `face-${index}`,
    height: 1000,
    individual_top3: 0.8,
    lead_can_suggest: true,
    lead_margin: 0.2,
    media_kind: "image",
    person_id: `person-${index}`,
    prime_score: 0.9 - index * 0.01,
    prototype_score: null,
    quality_measurements: { quality_score: 0.9 - index * 0.01 },
    quality_score: 0.9 - index * 0.01,
    raw_prime_score: 0.9 - index * 0.01,
    secondary_score: null,
    width: 1000,
  });
  const rows = [1, 2, 3, 4].map(candidateRow);
  const sql = async (strings, ...values) => {
    const statement = strings.join("?");
    if (statement.includes("WITH face_contexts AS MATERIALIZED")) {
      scoringCalls += 1;
      scoringValues = values;
      return rows;
    }
    if (statement.includes("FROM asset WHERE state = 'active'")) {
      summaryCalls += 1;
      return [
        {
          accepted_presence: 0,
          assets: 4,
          body_observations: 0,
          candidate_signals: 0,
          face_observations: 4,
          people: 4,
          user_decisions: 0,
        },
      ];
    }
    throw new Error(`Unexpected repository query: ${statement.slice(0, 120)}`);
  };
  const repository = createCimmichRepository(sql, new Map(), null, {
    conditionConsensusReviewEnabled: false,
    matchingProvider,
  });

  const small = await repository.machineSuggestions({ limit: 3 });
  const large = await repository.machineSuggestions({ limit: 24 });
  const summary = await repository.summary();

  assert.deepEqual(
    small.map((item) => item.face_id),
    large.slice(0, 3).map((item) => item.face_id),
  );
  assert.equal(large.length, 4);
  assert.equal(summary.suggestions_ready, large.length);
  assert.equal(scoringCalls, 1);
  assert.equal(summaryCalls, 1);
  assert.ok(scoringValues.includes(48));
  assert.ok(scoringValues.includes(16));
  assert.ok(!scoringValues.includes(6));
});

test("machine review applies exact SourcePack condition consensus without accepting identity", async () => {
  const rows = [
    {
      asset_id: "asset-1",
      box_h: 0.1,
      box_w: 0.1,
      box_x: 0.2,
      box_y: 0.2,
      candidate_rank: 1,
      can_suggest: true,
      capture_time: null,
      config_digest: "a".repeat(64),
      detection_confidence: 0.9,
      display_name: "Candidate One",
      face_id: "face-1",
      height: 1000,
      individual_top3: 0.72,
      lead_can_suggest: true,
      lead_margin: 0.03,
      media_kind: "image",
      person_id: "person-1",
      prime_score: 0.73,
      prototype_score: null,
      quality_measurements: { quality_score: 0.4 },
      quality_score: 0.4,
      raw_prime_score: 0.73,
      secondary_score: null,
      width: 1000,
    },
    {
      asset_id: "asset-1",
      box_h: 0.1,
      box_w: 0.1,
      box_x: 0.2,
      box_y: 0.2,
      candidate_rank: 2,
      can_suggest: true,
      capture_time: null,
      config_digest: "a".repeat(64),
      detection_confidence: 0.9,
      display_name: "Candidate Two",
      face_id: "face-1",
      height: 1000,
      individual_top3: 0.7,
      lead_can_suggest: true,
      lead_margin: null,
      media_kind: "image",
      person_id: "person-2",
      prime_score: 0.7,
      prototype_score: null,
      quality_measurements: { quality_score: 0.4 },
      quality_score: 0.4,
      raw_prime_score: 0.7,
      secondary_score: null,
      width: 1000,
    },
  ];
  const sql = async (strings) => {
    const statement = strings.join("?");
    if (statement.includes("WITH face_contexts AS MATERIALIZED")) return rows;
    throw new Error(`Unexpected repository query: ${statement.slice(0, 120)}`);
  };
  const candidateEnvelope = { state: "available" };
  const result = {
    changed: true,
    reason: "INDEPENDENT_CONDITION_CONSENSUS",
    resultDigest: "b".repeat(64),
    schemaVersion: "cimmich.provider-condition-consensus-router.v1",
  };
  const repository = createCimmichRepository(sql, new Map(), null, {
    conditionConsensusReviewEnabled: true,
    matchingProvider,
    visualCandidateSets: {
      load: async (input) => {
        assert.deepEqual(input, {
          faceId: "face-1",
          limit: 3,
          providerConfigDigest: "a".repeat(64),
          visualFloor: 0,
        });
        return candidateEnvelope;
      },
      projectConditionReviewSuggestion: (received) => {
        assert.equal(received, result);
        return {
          candidates: [],
          faceId: "face-1",
          personId: "person-2",
        };
      },
      routeProviderConditionConsensus: async ({
        candidateEnvelope: received,
      }) => {
        assert.equal(received, candidateEnvelope);
        return result;
      },
    },
  });

  const [suggestion] = await repository.machineSuggestions({ limit: 1 });
  assert.deepEqual(
    suggestion.candidates.map(({ person_id: personId }) => personId),
    ["person-2", "person-1"],
  );
  assert.equal(suggestion.review_reason, "independent_condition_consensus");
  assert.deepEqual(suggestion.condition_consensus, {
    applied: true,
    reason: "INDEPENDENT_CONDITION_CONSENSUS",
    result_digest: "b".repeat(64),
    schema_version: "cimmich.provider-condition-consensus-router.v1",
  });
  assert.equal("provider_config_digest" in suggestion, false);
});

test("machine review appends one all-trusted rank four without changing Prime top three", async () => {
  const rows = [
    ["person-1", "Prime One", 0.61],
    ["person-2", "Prime Two", 0.6],
    ["person-3", "Prime Three", 0.59],
  ].map(([personId, displayName, score], index) => ({
    asset_id: "asset-1",
    box_h: 0.1,
    box_w: 0.1,
    box_x: 0.2,
    box_y: 0.2,
    candidate_rank: index + 1,
    can_suggest: true,
    capture_time: null,
    config_digest: "a".repeat(64),
    detection_confidence: 0.7,
    display_name: displayName,
    face_id: "face-1",
    height: 1000,
    individual_top3: score,
    lead_can_suggest: true,
    lead_margin: index === 0 ? 0.01 : null,
    media_kind: "image",
    person_id: personId,
    prime_score: score,
    prototype_score: null,
    quality_measurements: { frontal_score: 0.2, quality_score: 0.35 },
    quality_score: 0.35,
    raw_prime_score: score,
    secondary_score: null,
    width: 1000,
  }));
  const sql = async (strings) => {
    const statement = strings.join("?");
    if (statement.includes("WITH face_contexts AS MATERIALIZED")) return rows;
    throw new Error(`Unexpected repository query: ${statement.slice(0, 120)}`);
  };
  const candidateEnvelope = { state: "available" };
  const shortlistResult = {
    changed: true,
    reason: "ALL_TRUSTED_REVIEW_SHORTLIST_ADDITION",
    resultDigest: "b".repeat(64),
    schemaVersion: "cimmich.all-trusted-shortlist-router.v1",
  };
  const repository = createCimmichRepository(sql, new Map(), null, {
    allTrustedShortlistReviewEnabled: true,
    conditionConsensusReviewEnabled: true,
    matchingProvider,
    visualCandidateSets: {
      load: async (input) => {
        assert.deepEqual(input, {
          faceId: "face-1",
          limit: 64,
          providerConfigDigest: "a".repeat(64),
          visualFloor: 0,
        });
        return candidateEnvelope;
      },
      projectAllTrustedShortlistSuggestion: (received) => {
        assert.equal(received, shortlistResult);
        return {
          candidatePrimeScore: 0.55,
          displayName: "Scout Four",
          faceId: "face-1",
          personId: "person-4",
          scoutScore: 0.72,
        };
      },
      routeAllTrustedShortlist: async ({ candidateEnvelope: received }) => {
        assert.equal(received, candidateEnvelope);
        return shortlistResult;
      },
    },
  });

  const [suggestion] = await repository.machineSuggestions({ limit: 1 });
  assert.deepEqual(
    suggestion.candidates.slice(0, 3).map((candidate) => ({
      personId: candidate.person_id,
      rank: candidate.rank,
      score: candidate.prime_score,
    })),
    [
      { personId: "person-1", rank: 1, score: 0.61 },
      { personId: "person-2", rank: 2, score: 0.6 },
      { personId: "person-3", rank: 3, score: 0.59 },
    ],
  );
  assert.deepEqual(suggestion.candidates[3], {
    display_name: "Scout Four",
    person_id: "person-4",
    prime_score: 0.55,
    prime_top3_score: null,
    prototype_score: null,
    rank: 4,
    raw_prime_score: 0.55,
    scout_score: 0.72,
    score_kind: "all_trusted_same_space_max",
    secondary_score: null,
  });
  assert.equal(suggestion.review_reason, "all_trusted_rank_four");
  assert.deepEqual(suggestion.all_trusted_shortlist, {
    applied: true,
    authority: "review_only",
    reason: "ALL_TRUSTED_REVIEW_SHORTLIST_ADDITION",
    schema_version: "cimmich.all-trusted-shortlist-router.v1",
  });
  assert.equal(suggestion.condition_consensus, undefined);
});

test("all-trusted fan-out is face-hard-only and capped at one four-statement route", async () => {
  const rows = [];
  for (let faceIndex = 0; faceIndex < 80; faceIndex += 1) {
    const hard = faceIndex < 20;
    for (let rank = 1; rank <= 3; rank += 1) {
      rows.push({
        asset_id: `asset-${faceIndex}`,
        box_h: hard ? 0.02 : 0.1,
        box_w: hard ? 0.02 : 0.1,
        box_x: 0.1,
        box_y: 0.1,
        candidate_rank: rank,
        can_suggest: true,
        capture_time: null,
        config_digest: "a".repeat(64),
        detection_confidence: 0.8,
        display_name: `Candidate ${rank}`,
        face_id: `face-${faceIndex}`,
        height: 1000,
        individual_top3: 0.8 - rank * 0.01,
        lead_can_suggest: true,
        lead_margin: rank === 1 ? 0.1 : null,
        media_kind: "image",
        person_id: `person-${rank}`,
        prime_score: 0.8 - rank * 0.01,
        prototype_score: null,
        quality_measurements: hard
          ? { frontal_score: 0.2, quality_score: 0.35 }
          : { frontal_score: 0.8, quality_score: 0.8 },
        quality_score: hard ? 0.35 : 0.8,
        raw_prime_score: 0.8 - rank * 0.01,
        secondary_score: null,
        width: 1000,
      });
    }
  }
  let scoringCalls = 0;
  let loadCalls = 0;
  let routeCalls = 0;
  let active = 0;
  let maxActive = 0;
  const boundedWork = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
  };
  const sql = async (strings) => {
    const statement = strings.join("?");
    if (statement.includes("WITH face_contexts AS MATERIALIZED")) {
      scoringCalls += 1;
      return rows;
    }
    throw new Error(`Unexpected repository query: ${statement.slice(0, 120)}`);
  };
  const repository = createCimmichRepository(sql, new Map(), null, {
    allTrustedShortlistReviewEnabled: true,
    conditionConsensusReviewEnabled: false,
    matchingProvider,
    visualCandidateSets: {
      load: async () => {
        loadCalls += 1;
        await boundedWork();
        return { state: "available" };
      },
      routeAllTrustedShortlist: async () => {
        routeCalls += 1;
        await boundedWork();
        return { changed: false };
      },
    },
  });

  const suggestions = await repository.machineSuggestions({ limit: 80 });
  assert.equal(suggestions.length, 80);
  assert.equal(scoringCalls, 1);
  assert.equal(loadCalls, 1);
  assert.equal(routeCalls, 1);
  assert.equal(maxActive, 1);
  assert.equal(
    suggestions.some((suggestion) => suggestion.candidates.length !== 3),
    false,
  );
});

test("incomplete quality evidence causes zero shortlist fan-out", async () => {
  const rows = [1, 2, 3].map((rank) => ({
    asset_id: "asset-incomplete",
    box_h: 0.02,
    box_w: 0.02,
    box_x: 0.1,
    box_y: 0.1,
    candidate_rank: rank,
    can_suggest: true,
    capture_time: null,
    config_digest: "a".repeat(64),
    detection_confidence: 0.8,
    display_name: `Candidate ${rank}`,
    face_id: "face-incomplete",
    height: 1000,
    individual_top3: 0.8 - rank * 0.01,
    lead_can_suggest: true,
    lead_margin: rank === 1 ? 0.1 : null,
    media_kind: "image",
    person_id: `person-${rank}`,
    prime_score: 0.8 - rank * 0.01,
    prototype_score: null,
    quality_measurements: { frontal_score: null, quality_score: null },
    quality_score: 0,
    raw_prime_score: 0.8 - rank * 0.01,
    secondary_score: null,
    width: 1000,
  }));
  let loadCalls = 0;
  const sql = async (strings) => {
    if (strings.join("?").includes("WITH face_contexts AS MATERIALIZED")) {
      return rows;
    }
    throw new Error("Unexpected repository query");
  };
  const repository = createCimmichRepository(sql, new Map(), null, {
    allTrustedShortlistReviewEnabled: true,
    conditionConsensusReviewEnabled: false,
    matchingProvider,
    visualCandidateSets: {
      load: async () => {
        loadCalls += 1;
        return { state: "available" };
      },
      routeAllTrustedShortlist: async () => ({ changed: false }),
    },
  });
  const suggestions = await repository.machineSuggestions({ limit: 1 });
  assert.equal(suggestions.length, 1);
  assert.equal(loadCalls, 0);
});

test("candidate evidence keeps the request-bound visibility rank across async work", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/repository.mjs", import.meta.url), "utf8"),
  );
  const method = source.slice(
    source.indexOf("async machineSuggestions"),
    source.indexOf("async machineSuggestionSummary"),
  );
  assert.match(method, /const visibleRank = presentationRank\(\)/);
  assert.match(method, /presentationRank: \(\) => visibleRank/);
  assert.doesNotMatch(method, /presentationRank: presentationRank/);
  assert.match(method, /allTrustedShortlistBatchLimit/);
  assert.match(method, /set_config\(\s*'statement_timeout'/);
  assert.match(method, /set_config\(\s*'transaction_timeout'/);
});

test("identity-changing commands invalidate the shared machine-suggestion snapshot", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/repository.mjs", import.meta.url), "utf8"),
  );
  const methodBody = (name, nextName) =>
    source.slice(
      source.indexOf(`async ${name}`),
      source.indexOf(`async ${nextName}`),
    );
  for (const [name, nextName] of [
    ["mergePeople", "unmergePeople"],
    ["unmergePeople", "identityCandidates"],
    ["bulkAcceptPersonCandidates", "personAssets"],
    ["movePersonFace", "dismissMachineSuggestion"],
  ]) {
    assert.match(
      methodBody(name, nextName),
      /invalidateMachineSuggestions\(\)/,
      name,
    );
  }
});
