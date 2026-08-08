import assert from "node:assert/strict";
import test from "node:test";

import { createIdentityAudit } from "../src/identity-audit.mjs";
import { createCimmichRepository } from "../src/repository.mjs";

const repositoryWithTransaction = (handler, options = {}) => {
  const sql = async (...args) => handler(...args);
  sql.begin = async (run) => {
    const tx = async (...args) => handler(...args);
    tx.json = (value) => value;
    return run(tx);
  };
  return createCimmichRepository(sql, new Map(), null, options);
};

test("bulk candidate accept returns after the durable write while Prime maintenance continues", async () => {
  let candidateLockScoped = false;
  let maintenanceStarted = false;
  let releaseMaintenance;
  const maintenanceGate = new Promise((resolve) => {
    releaseMaintenance = resolve;
  });
  const repository = repositoryWithTransaction(async (strings, ...values) => {
    const query = strings.join("?");
    if (query.includes("FROM person")) {
      return [{ display_name: "Someone", person_id: "person-batch" }];
    }
    if (query.includes("JOIN source_pack pack")) {
      candidateLockScoped = query.includes("FOR UPDATE OF claim");
      return [
        {
          evidence_refs: {},
          face_id: "face-batch",
          identity_claim_id: values[0],
          person_id: "person-batch",
          state: "candidate",
        },
      ];
    }
    if (
      query.includes("WHERE face_id =") &&
      query.includes("state = 'accepted'")
    ) {
      return [];
    }
    if (query.includes("SET state = 'accepted'")) {
      return [
        {
          face_id: "face-batch",
          identity_claim_id: "claim-batch",
          person_id: "person-batch",
          state: "accepted",
        },
      ];
    }
    if (query.includes("slug = 'holding'")) {
      maintenanceStarted = true;
      await maintenanceGate;
      return [{ holding: true }];
    }
    if (query.includes("retired_buckets")) return [];
    return [];
  });

  let responseSettled = false;
  const response = repository
    .bulkAcceptPersonCandidates({
      actorId: "local-operator",
      claimIds: ["claim-batch"],
      personId: "person-batch",
    })
    .then((result) => {
      responseSettled = true;
      return result;
    });

  await new Promise((resolve) => setImmediate(resolve));
  const returnedBeforeMaintenance = responseSettled;
  releaseMaintenance();
  const result = await response;

  assert.equal(maintenanceStarted, true);
  assert.equal(candidateLockScoped, true);
  assert.equal(returnedBeforeMaintenance, true);
  assert.equal(result.acceptedCount, 1);
  assert.equal(result.maintenancePending, true);
});

test("bulk candidate reject records one decision per claim inside one transaction", async () => {
  const statements = [];
  const repository = repositoryWithTransaction(async (strings, ...values) => {
    const query = strings.join("?");
    statements.push({ query, values });
    if (query.includes("FROM person")) {
      return [{ display_name: "Someone", person_id: "person-1" }];
    }
    if (query.includes("SELECT identity_claim_id, face_id, person_id, state")) {
      const claimId = values[0];
      return [
        {
          face_id: `face-${claimId}`,
          identity_claim_id: claimId,
          person_id: "person-1",
          state: "candidate",
        },
      ];
    }
    if (query.includes("SET state = 'rejected'")) {
      return [{ face_id: `face-${values[1]}`, identity_claim_id: values[1] }];
    }
    return [];
  });

  const result = await repository.bulkRejectPersonCandidates({
    actorId: "local-operator",
    claimIds: ["claim-a", "claim-b"],
    personId: "person-1",
  });

  assert.equal(result.changed, true);
  assert.equal(result.personId, "person-1");
  assert.equal(result.rejectedCount, 2);
  assert.deepEqual(
    result.rejected.map((item) => item.claimId),
    ["claim-a", "claim-b"],
  );
  for (const item of result.rejected) {
    assert.match(item.decisionId, /^decision_/);
  }
  const decisionInserts = statements.filter(({ query }) =>
    query.includes("person_candidate_bulk_reject"),
  );
  assert.equal(decisionInserts.length, 2);
});

test("bulk candidate reject fails whole selection on a stale claim", async () => {
  const repository = repositoryWithTransaction(async (strings, ...values) => {
    const query = strings.join("?");
    if (query.includes("FROM person")) {
      return [{ display_name: "Someone", person_id: "person-1" }];
    }
    if (query.includes("SELECT identity_claim_id, face_id, person_id, state")) {
      return [
        {
          face_id: "face-1",
          identity_claim_id: values[0],
          person_id: "person-1",
          state: "rejected",
        },
      ];
    }
    return [];
  });

  await assert.rejects(
    repository.bulkRejectPersonCandidates({
      actorId: "local-operator",
      claimIds: ["claim-stale"],
      personId: "person-1",
    }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.deepEqual(error.details, { claimId: "claim-stale" });
      return true;
    },
  );
});

test("bulk candidate reject validates actor, shape and bounds like bulk accept", async () => {
  const repository = repositoryWithTransaction(async () => []);

  await assert.rejects(
    repository.bulkRejectPersonCandidates({
      claimIds: ["claim-a"],
      personId: "person-1",
    }),
    /Missing Cimmich actor/,
  );
  await assert.rejects(
    repository.bulkRejectPersonCandidates({
      actorId: "local-operator",
      claimIds: "claim-a",
      personId: "person-1",
    }),
    /claimIds must be an array/,
  );
  await assert.rejects(
    repository.bulkRejectPersonCandidates({
      actorId: "local-operator",
      claimIds: [],
      personId: "person-1",
    }),
    /Select at least one candidate/,
  );
  await assert.rejects(
    repository.bulkRejectPersonCandidates({
      actorId: "local-operator",
      claimIds: Array.from({ length: 101 }, (_, index) => `claim-${index}`),
      personId: "person-1",
    }),
    /no more than 100/,
  );
});

test("identity audit batch dismiss reports per-item states in one request", async () => {
  let runResolutions = 0;
  const sql = async (strings, ...values) => {
    const query = strings.join("?");
    if (query.includes("SET review_state = 'dismissed'")) {
      const faceId = values.find(
        (value) => typeof value === "string" && value.startsWith("face-"),
      );
      return faceId === "face-open" ? [{ face_id: faceId }] : [];
    }
    if (query.includes("WHERE state = 'completed'")) {
      runResolutions += 1;
      return [{ audit_run_id: "identity-audit.current" }];
    }
    return [];
  };
  sql.begin = (callback) => callback(sql);
  const audit = createIdentityAudit(sql);

  const result = await audit.dismissBatch({
    actorId: "local-operator",
    items: [
      { faceId: "face-open", kind: "untagged_match" },
      { faceId: "face-already-closed", kind: "accepted_contradiction" },
    ],
  });

  assert.equal(result.changed, true);
  assert.equal(result.dismissedCount, 1);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].state, "dismissed");
  assert.equal(result.items[1].state, "unchanged");
  assert.equal(result.schemaVersion, "cimmich.identity-audit.v2");
  // The whole batch targets one run resolved once, so a run completing
  // mid-batch can never split the batch across two runs.
  assert.equal(runResolutions, 1);
});

test("identity audit batch dismiss validates shape and bounds", async () => {
  const audit = createIdentityAudit(async () => []);

  await assert.rejects(
    audit.dismissBatch({ actorId: "local-operator", items: [] }),
    /Identity audit decision is incomplete/,
  );
  await assert.rejects(
    audit.dismissBatch({
      actorId: "local-operator",
      items: Array.from({ length: 101 }, (_, index) => ({
        faceId: `face-${index}`,
        kind: "untagged_match",
      })),
    }),
    /no more than 100/,
  );
});

test("batch face reassignment reports partial failures and reuses a created Person", async () => {
  const repository = repositoryWithTransaction(async () => []);
  const calls = [];
  repository.reassignFaceIdentity = async (input) => {
    calls.push(input);
    if (input.faceId === "face-broken") {
      throw Object.assign(
        new Error("Visible current Face observation not found"),
        {
          code: "FACE_OBSERVATION_NOT_FOUND",
          statusCode: 404,
        },
      );
    }
    return {
      changed: true,
      createdPerson: Boolean(input.newPersonName),
      faceId: input.faceId,
      personId: input.newPersonName ? "person-created" : input.personId,
      state: "accepted",
    };
  };

  const result = await repository.bulkReassignFaceIdentities({
    actorId: "local-operator",
    items: [
      { faceId: "face-1", newPersonName: "New Person" },
      { faceId: "face-2", newPersonName: "new person" },
      { faceId: "face-broken", personId: "person-9" },
      { faceId: "face-3", personId: "person-5" },
    ],
  });

  assert.equal(result.assignedCount, 3);
  assert.equal(result.failureCount, 1);
  assert.equal(result.changed, true);
  assert.equal(result.failures[0].faceId, "face-broken");
  assert.equal(result.failures[0].statusCode, 404);
  assert.equal(result.failures[0].code, "FACE_OBSERVATION_NOT_FOUND");
  // The second same-new-name item must reuse the Person the first one created
  // instead of racing a duplicate CREATE.
  assert.equal(calls[1].personId, "person-created");
  assert.equal(Object.hasOwn(calls[1], "newPersonName"), false);
});

test("batch face reassignment validates shape, bounds and duplicate faces", async () => {
  const repository = repositoryWithTransaction(async () => []);

  await assert.rejects(
    repository.bulkReassignFaceIdentities({ items: [{ faceId: "face-1" }] }),
    /Missing Cimmich actor/,
  );
  await assert.rejects(
    repository.bulkReassignFaceIdentities({
      actorId: "local-operator",
      items: "face-1",
    }),
    /items must be an array/,
  );
  await assert.rejects(
    repository.bulkReassignFaceIdentities({
      actorId: "local-operator",
      items: [],
    }),
    /Select at least one Face/,
  );
  await assert.rejects(
    repository.bulkReassignFaceIdentities({
      actorId: "local-operator",
      items: Array.from({ length: 101 }, (_, index) => ({
        faceId: `face-${index}`,
        personId: "person-1",
      })),
    }),
    /no more than 100/,
  );
  await assert.rejects(
    repository.bulkReassignFaceIdentities({
      actorId: "local-operator",
      items: [
        { faceId: "face-1", personId: "person-1" },
        { faceId: "face-1", personId: "person-2" },
      ],
    }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.deepEqual(error.details, { faceId: "face-1" });
      return true;
    },
  );
});
