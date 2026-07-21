import assert from "node:assert/strict";
import test from "node:test";

import { createCimmichRepository } from "../src/repository.mjs";

const repositoryWithTransaction = (handler) => {
  const sql = async (...args) => handler(...args);
  sql.begin = async (run) => run(sql);
  return createCimmichRepository(sql, new Map(), {
    currentRank: () => 1,
  });
};

test("Not-this-person replay re-proves a current valid visible Face before returning identifiers", async () => {
  let replayQuery = "";
  const repository = repositoryWithTransaction(async (strings) => {
    const query = strings.join("?");
    if (query.includes("rejected.identity_claim_id AS rejected_claim_id")) {
      replayQuery = query;
      return [
        {
          actor_id: "operator-one",
          face_id: "face-visible",
          note: "Wrong person",
          person_id: "person-visible",
          rejected_claim_id: "claim-rejected",
          subject_id: "claim-original",
        },
      ];
    }
    return [];
  });

  const replay = await repository.rejectAcceptedIdentity({
    actorId: "operator-one",
    claimId: "claim-original",
    commandId: "identity.reject.replay.001",
    note: "Wrong person",
  });

  assert.equal(replay.replayed, true);
  assert.equal(replay.faceId, "face-visible");
  assert.match(
    replayQuery,
    /JOIN face_observation replay_face[\s\S]*replay_face\.state = 'valid'/,
  );
  assert.match(
    replayQuery,
    /JOIN asset replay_asset[\s\S]*replay_asset\.state = 'active'/,
  );
  assert.match(
    replayQuery,
    /cimmich_visibility_asset_rank\(replay_asset\.asset_id\) <=/,
  );
});

test("Not-this-person replay with an occupied hidden command returns no identifiers", async () => {
  const repository = repositoryWithTransaction(async (strings) => {
    const query = strings.join("?");
    if (query.includes("SELECT 1 AS occupied FROM decision")) {
      return [{ occupied: 1 }];
    }
    return [];
  });

  await assert.rejects(
    repository.rejectAcceptedIdentity({
      actorId: "operator-one",
      claimId: "claim-hidden",
      commandId: "identity.reject.hidden.001",
      note: "Wrong person",
    }),
    (error) =>
      error.code === "IDENTITY_CORRECTION_NOT_VISIBLE" &&
      error.faceId === undefined &&
      error.personId === undefined,
  );
});

test("identity correction Undo replay re-proves a current valid visible Face", async () => {
  let replayQuery = "";
  const repository = repositoryWithTransaction(async (strings) => {
    const query = strings.join("?");
    if (query.includes("restored.identity_claim_id AS restored_claim_id")) {
      replayQuery = query;
      return [
        {
          actor_id: "operator-one",
          face_id: "face-visible",
          originalDecisionId: "decision-original",
          person_id: "person-visible",
          restored_claim_id: "claim-restored",
          subject_id: "claim-original",
          supersedes_decision_id: "decision-original",
        },
      ];
    }
    return [];
  });

  const replay = await repository.undoIdentityCorrection({
    actorId: "operator-one",
    commandId: "identity.undo.replay.001",
    decisionId: "decision-original",
  });

  assert.equal(replay.replayed, true);
  assert.equal(replay.faceId, "face-visible");
  assert.match(
    replayQuery,
    /JOIN face_observation replay_face[\s\S]*replay_face\.state = 'valid'/,
  );
  assert.match(
    replayQuery,
    /JOIN asset replay_asset[\s\S]*replay_asset\.state = 'active'/,
  );
  assert.match(
    replayQuery,
    /cimmich_visibility_asset_rank\(replay_asset\.asset_id\) <=/,
  );
});

test("identity correction Undo replay with an occupied hidden command returns no identifiers", async () => {
  const repository = repositoryWithTransaction(async (strings) => {
    const query = strings.join("?");
    if (query.includes("SELECT 1 AS occupied FROM decision")) {
      return [{ occupied: 1 }];
    }
    return [];
  });

  await assert.rejects(
    repository.undoIdentityCorrection({
      actorId: "operator-one",
      commandId: "identity.undo.hidden.001",
      decisionId: "decision-hidden",
    }),
    (error) =>
      error.code === "IDENTITY_CORRECTION_NOT_VISIBLE" &&
      error.faceId === undefined &&
      error.personId === undefined,
  );
});

test("recent correction discovery accepts current Immich UUID scope and exposes only visible eligible corrections", async () => {
  let discoveryQuery = "";
  const repository = repositoryWithTransaction(async (strings) => {
    const query = strings.join("?");
    if (query.includes("FROM immich_asset_projection projection")) {
      return [
        {
          asset_id: "asset-visible",
          source_asset_id: "11111111-1111-4111-8111-111111111111",
        },
      ];
    }
    if (query.includes("FROM decision correction")) {
      discoveryQuery = query;
      return [
        {
          claim_id: "claim-rejected",
          created_at: new Date("2026-07-19T04:00:00.000Z"),
          decided_at: new Date("2026-07-19T04:00:00.000Z"),
          decision_id: "decision-reject",
          face_id: "face-visible",
          person_id: "person-visible",
          person_name: "Visible Person",
          source_asset_id: "11111111-1111-4111-8111-111111111111",
          state: "rejected",
          supersedes_claim_id: "claim-original",
          supersedes_decision_id: null,
          undo_eligible: true,
        },
      ];
    }
    return [];
  });

  const result = await repository.discoverIdentityCorrections({
    limit: 5,
    sourceAssetId: "11111111-1111-4111-8111-111111111111",
    undoEligible: true,
  });

  assert.equal(result.schemaVersion, "cimmich.identity-correction-history.v1");
  assert.deepEqual(result.scope, {
    kind: "asset",
    sourceAssetId: "11111111-1111-4111-8111-111111111111",
  });
  assert.deepEqual(result.items[0], {
    action: "reject",
    claimId: "claim-rejected",
    createdAt: "2026-07-19T04:00:00.000Z",
    decidedAt: "2026-07-19T04:00:00.000Z",
    decisionId: "decision-reject",
    faceId: "face-visible",
    personId: "person-visible",
    personName: "Visible Person",
    reasonCode: "not_this_person",
    sourceAssetId: "11111111-1111-4111-8111-111111111111",
    state: "rejected",
    supersedesClaimId: "claim-original",
    supersedesDecisionId: null,
    undo: { decisionId: "decision-reject", eligible: true },
  });
  assert.match(
    discoveryQuery,
    /JOIN face_observation face[\s\S]*face\.state = 'valid'/,
  );
  assert.match(
    discoveryQuery,
    /JOIN asset ON asset\.asset_id = face\.asset_id AND asset\.state = 'active'/,
  );
  assert.match(
    discoveryQuery,
    /cimmich_visibility_asset_rank\(asset\.asset_id\) <=/,
  );
  assert.match(
    discoveryQuery,
    /NOT EXISTS \([\s\S]*competing\.state = 'accepted'/,
  );
});

test("recent correction discovery requires exactly one bounded scope", async () => {
  const repository = repositoryWithTransaction(async () => []);

  await assert.rejects(
    repository.discoverIdentityCorrections({}),
    (error) => error.code === "IDENTITY_CORRECTION_SCOPE_INVALID",
  );
  await assert.rejects(
    repository.discoverIdentityCorrections({
      personId: "person-one",
      sourceAssetId: "asset-one",
    }),
    (error) => error.code === "IDENTITY_CORRECTION_SCOPE_INVALID",
  );
});
