import assert from "node:assert/strict";

const root = process.env.CIMMICH_ACCEPTANCE_API_URL || "http://127.0.0.1:3101";
const getJson = async (path, init) => {
  const response = await fetch(`${root}${path}`, init);
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return body;
};

const before = await getJson("/v1/review/identity-claims?limit=5");
const summaryBefore = await getJson("/v1/summary");
const peopleForSummary = await getJson("/v1/people?limit=500");
const personAssets = await getJson(
  "/v1/people/person_service_fixture/assets?limit=10",
);
const directPerson = await getJson("/v1/people/person_service_fixture");
assert.equal(before.items.length, 1);
assert.equal(summaryBefore.candidate_signals, 5);
// Legacy/imported candidate claims are evidence, not the machine-review queue.
// This fixture has no corrected-machine projection, so the shared ready set is
// honestly empty even though candidate signals remain present.
assert.equal(summaryBefore.suggestions_ready, 0);
assert.equal(summaryBefore.user_decisions, 0);
assert.equal(summaryBefore.people, peopleForSummary.items.length);
assert.equal(personAssets.items.length, 1);
assert.equal(directPerson.person_id, "person_service_fixture");
assert.deepEqual(personAssets.items[0].association_types, ["face"]);

const closestMatches = await getJson(
  "/v1/faces/face_identity_fixture/matches?limit=5",
);
assert.equal(closestMatches.items.length >= 1, true);
assert.equal(closestMatches.items[0].rank, 1);
assert.equal(closestMatches.items[0].person_id, "person_match_fixture");
assert.equal(closestMatches.items[0].display_name, "Synthetic Closest Match");
assert.equal(closestMatches.items[0].prime_score > 0.97, true);
const currentIdentityComparison = closestMatches.items.find(
  (match) => match.person_id === "person_service_fixture",
);
assert.ok(currentIdentityComparison);
assert.equal(currentIdentityComparison.current_identity, true);
assert.equal(closestMatches.reviewOnly, true);

const candidatePeopleBefore = await getJson("/v1/people?limit=500");
const candidatePersonBefore = candidatePeopleBefore.items.find(
  (person) => person.person_id === "person_candidate_fixture",
);
assert.equal(candidatePersonBefore.candidate_faces, 2);
assert.equal(candidatePersonBefore.accepted_faces, 0);
assert.equal(
  candidatePersonBefore.representative_face_id,
  "face_candidate_high_fixture",
);

const rankedCandidates = await getJson(
  "/v1/people/person_candidate_fixture/candidates?limit=10",
);
assert.deepEqual(
  rankedCandidates.items.map((candidate) => candidate.identity_claim_id),
  ["claim_candidate_high_fixture", "claim_candidate_low_fixture"],
);
assert.deepEqual(
  rankedCandidates.items.map((candidate) => candidate.match_score),
  [1.12, 0.42],
);
assert.deepEqual(
  rankedCandidates.items.map((candidate) => candidate.score_kind),
  ["source_similarity", "source_similarity"],
);
assert.equal(
  rankedCandidates.items.every((candidate) =>
    ["differentiated", "unscored", "zero_margin"].includes(
      candidate.review_priority,
    ),
  ),
  true,
);

const samePhotoPerson = candidatePeopleBefore.items.find(
  (person) => person.person_id === "person_same_photo_fixture",
);
assert.equal(samePhotoPerson.accepted_faces, 1);
assert.equal(samePhotoPerson.candidate_faces, 1);
const samePhotoCandidates = await getJson(
  "/v1/people/person_same_photo_fixture/candidates?limit=10",
);
assert.deepEqual(
  samePhotoCandidates.items.map((candidate) => candidate.identity_claim_id),
  ["claim_same_photo_strong_fixture"],
);
for (const claimId of [
  "claim_same_photo_low_fixture",
  "claim_same_photo_strong_fixture",
]) {
  const rejected = await getJson(
    `/v1/review/identity-claims/${encodeURIComponent(claimId)}/decision`,
    {
      body: JSON.stringify({
        action: "reject",
        note: "Synthetic same-photo context cleanup",
      }),
      headers: {
        "content-type": "application/json",
        "x-cimmich-actor": "synthetic-operator",
      },
      method: "POST",
    },
  );
  assert.equal(rejected.state, "rejected");
}

const mixedPersonBatch = await fetch(
  `${root}/v1/people/person_candidate_fixture/candidates/bulk-accept`,
  {
    body: JSON.stringify({
      claimIds: ["claim_candidate_high_fixture", "claim_service_fixture"],
    }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(mixedPersonBatch.status, 409);
assert.equal(
  (await getJson("/v1/people/person_candidate_fixture/candidates?limit=10"))
    .items.length,
  2,
);

const bulkAccepted = await getJson(
  "/v1/people/person_candidate_fixture/candidates/bulk-accept",
  {
    body: JSON.stringify({
      claimIds: ["claim_candidate_low_fixture", "claim_candidate_high_fixture"],
    }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(bulkAccepted.acceptedCount, 2);
assert.equal(
  (await getJson("/v1/people/person_candidate_fixture/candidates?limit=10"))
    .items.length,
  0,
);
const candidatePersonAfter = (await getJson("/v1/people?limit=500")).items.find(
  (person) => person.person_id === "person_candidate_fixture",
);
assert.equal(candidatePersonAfter.candidate_faces, 0);
assert.equal(candidatePersonAfter.accepted_faces, 2);
assert.equal(candidatePersonAfter.asset_count, 1);

const staleBatch = await fetch(
  `${root}/v1/people/person_candidate_fixture/candidates/bulk-accept`,
  {
    body: JSON.stringify({ claimIds: ["claim_candidate_high_fixture"] }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(staleBatch.status, 409);

const categorySetup = await getJson("/v1/people/person_service_fixture/setup");
const sortCategory = categorySetup.category_catalog.find(
  (category) => category.slug === "sort",
);
const holdingCategory = categorySetup.category_catalog.find(
  (category) => category.slug === "holding",
);
assert.ok(sortCategory);
assert.ok(holdingCategory);
await getJson(
  `/v1/people/person_service_fixture/categories/${encodeURIComponent(sortCategory.category_id)}`,
  {
    body: JSON.stringify({ selected: true }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(
  (await getJson("/v1/review/identity-claims?limit=5")).items.length,
  0,
);
assert.equal((await getJson("/v1/summary")).suggestions_ready, 0);
assert.equal(
  (await getJson("/v1/people?limit=500")).items.find(
    (person) => person.person_id === "person_service_fixture",
  ).needs_sort,
  true,
);
await getJson(
  `/v1/people/person_service_fixture/categories/${encodeURIComponent(holdingCategory.category_id)}`,
  {
    body: JSON.stringify({ selected: true }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
const heldPerson = await getJson("/v1/people/person_service_fixture");
assert.equal(heldPerson.needs_holding, true);
assert.equal(heldPerson.needs_sort, true);
assert.equal(heldPerson.prime_faces, 0);
const heldPersonInList = (await getJson("/v1/people?limit=500")).items.find(
  (person) => person.person_id === "person_service_fixture",
);
assert.equal(heldPersonInList.needs_holding, true);
assert.ok(heldPersonInList.representative_asset_id);
const heldSetup = await getJson("/v1/people/person_service_fixture/setup");
assert.equal(
  heldSetup.categories.some((category) => category.slug === "holding"),
  true,
);
assert.equal(
  heldSetup.categories.some((category) => category.slug === "sort"),
  true,
);
const heldBucketWrite = await fetch(
  `${root}/v1/people/person_service_fixture/identity/faces/face_identity_fixture/bucket`,
  {
    body: JSON.stringify({ bucketKind: "prime" }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(heldBucketWrite.status, 409);
const heldMatchBatch = await getJson(
  "/v1/people/person_service_fixture/identity/matches:batch",
  {
    body: JSON.stringify({
      faceIds: ["face_identity_fixture"],
      limitPerFace: 1,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  },
);
assert.equal(
  heldMatchBatch.schemaVersion,
  "cimmich.person-holding-match-batch.v1",
);
assert.equal(heldMatchBatch.requestedCount, 1);
assert.equal(heldMatchBatch.items[0].faceId, "face_identity_fixture");
assert.equal(
  heldMatchBatch.items[0].matches[0].person_id,
  "person_match_fixture",
);
const heldSortRemoval = await fetch(
  `${root}/v1/people/person_service_fixture/categories/${encodeURIComponent(sortCategory.category_id)}`,
  {
    body: JSON.stringify({ selected: false }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(heldSortRemoval.status, 409);
await getJson(
  `/v1/people/person_service_fixture/categories/${encodeURIComponent(holdingCategory.category_id)}`,
  {
    body: JSON.stringify({ selected: false }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
const releasedPerson = await getJson("/v1/people/person_service_fixture");
assert.equal(releasedPerson.needs_holding, false);
assert.equal(releasedPerson.needs_sort, true);
assert.equal(releasedPerson.prime_faces >= 1, true);
const releasedMatchBatch = await fetch(
  `${root}/v1/people/person_service_fixture/identity/matches:batch`,
  {
    body: JSON.stringify({
      faceIds: ["face_identity_fixture"],
      limitPerFace: 1,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  },
);
assert.equal(releasedMatchBatch.status, 409);
assert.equal((await releasedMatchBatch.json()).code, "PERSON_HOLDING_REQUIRED");
await getJson(
  `/v1/people/person_service_fixture/categories/${encodeURIComponent(sortCategory.category_id)}`,
  {
    body: JSON.stringify({ selected: false }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(
  (await getJson("/v1/review/identity-claims?limit=5")).items.length,
  1,
);

const presenceAssets = await getJson(
  "/v1/people/person_reassign_fixture/assets?limit=10",
);
assert.deepEqual(presenceAssets.items[0].association_types, ["presence"]);
const assetHeadSelection = await getJson(
  "/v1/people/person_reassign_fixture/identity/assets/asset_service_fixture/head",
  {
    body: JSON.stringify({ selected: true }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(assetHeadSelection.changed, true);
assert.deepEqual(
  (await getJson("/v1/people/person_reassign_fixture/assets?limit=10")).items[0]
    .association_types,
  ["head"],
);
await getJson(
  "/v1/people/person_reassign_fixture/identity/assets/asset_service_fixture/head",
  {
    body: JSON.stringify({ selected: false }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.deepEqual(
  (await getJson("/v1/people/person_reassign_fixture/assets?limit=10")).items[0]
    .association_types,
  ["presence"],
);

const claimId = before.items[0].identity_claim_id;
const decision = await getJson(
  `/v1/review/identity-claims/${encodeURIComponent(claimId)}/decision`,
  {
    body: JSON.stringify({
      action: "reject",
      note: "Synthetic local service acceptance",
    }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(decision.changed, true);
assert.equal(decision.state, "rejected");

const after = await getJson("/v1/review/identity-claims?limit=5");
const summaryAfter = await getJson("/v1/summary");
assert.equal(after.items.length, 0);
assert.equal(summaryAfter.candidate_signals, 0);
assert.equal(summaryAfter.suggestions_ready, 0);
assert.equal(summaryAfter.user_decisions, 11);

const identityBefore = await getJson(
  "/v1/people/person_service_fixture/identity?limit=10",
);
assert.equal(identityBefore.items.length, 1);
assert.equal(identityBefore.items[0].body_id, "body_identity_fixture");
assert.equal(identityBefore.items[0].buckets[0].bucket_kind, "prime");
assert.equal(identityBefore.items[0].body_selected, false);

const faceId = identityBefore.items[0].face_id;
const faceSelection = await getJson(
  `/v1/people/person_service_fixture/identity/faces/${encodeURIComponent(faceId)}/bucket`,
  {
    body: JSON.stringify({ bucketKind: "secondary" }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(faceSelection.changed, true);
assert.equal(faceSelection.bucketKind, "secondary");

const headSelection = await getJson(
  `/v1/people/person_service_fixture/identity/faces/${encodeURIComponent(faceId)}/bucket`,
  {
    body: JSON.stringify({ bucketKind: "head" }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(headSelection.changed, true);
assert.equal(headSelection.bucketKind, "head");
assert.deepEqual(
  (await getJson("/v1/people/person_service_fixture/assets?limit=10")).items[0]
    .association_types,
  ["head"],
);

const headModifierSelection = await getJson(
  `/v1/people/person_service_fixture/identity/faces/${encodeURIComponent(faceId)}/modifiers`,
  {
    body: JSON.stringify({ selected: true, modifierName: "Helmet" }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(headModifierSelection.changed, true);
assert.equal(headModifierSelection.modifierName, "Helmet");
assert.equal(
  (await getJson("/v1/people/person_service_fixture/identity?limit=10"))
    .items[0].modifiers[0].modifierLabel,
  "Helmet",
);

const secondaryRestore = await getJson(
  `/v1/people/person_service_fixture/identity/faces/${encodeURIComponent(faceId)}/bucket`,
  {
    body: JSON.stringify({ bucketKind: "secondary" }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(secondaryRestore.changed, true);

const bodySelection = await getJson(
  "/v1/people/person_service_fixture/identity/bodies/body_identity_fixture",
  {
    body: JSON.stringify({ selected: true }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(bodySelection.changed, true);
assert.equal(bodySelection.selected, true);

const identityAfter = await getJson(
  "/v1/people/person_service_fixture/identity?limit=10",
);
assert.equal(identityAfter.items[0].buckets[0].bucket_kind, "secondary");
assert.equal(
  identityAfter.items[0].modifiers.some(
    (modifier) => modifier.modifierLabel === "Helmet",
  ),
  true,
);
assert.equal(identityAfter.items[0].body_selected, true);

const captureContext = await getJson("/v1/capture-contexts", {
  body: JSON.stringify({
    assetIds: ["asset_identity_fixture", "asset_service_fixture"],
    contextKind: "same_moment",
    label: "Synthetic shared moment",
  }),
  headers: {
    "content-type": "application/json",
    "x-cimmich-actor": "synthetic-operator",
  },
  method: "POST",
});
assert.equal(captureContext.changed, true);
assert.equal(captureContext.memberCount, 2);
assert.equal(
  (await getJson("/v1/people/person_service_fixture/identity?limit=10"))
    .items[0].capture_contexts[0].contextKind,
  "same_moment",
);
assert.ok(
  Array.isArray(
    (
      await getJson(
        `/v1/capture-contexts/${captureContext.contextId}/presence-candidates`,
      )
    ).items,
  ),
);

const modifierRemoval = await getJson(
  `/v1/people/person_service_fixture/identity/faces/${encodeURIComponent(faceId)}/modifiers`,
  {
    body: JSON.stringify({ selected: false, modifierName: "Helmet" }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(modifierRemoval.changed, true);
assert.equal(
  (
    await getJson("/v1/people/person_service_fixture/identity?limit=10")
  ).items[0].modifiers.some((modifier) => modifier.modifierLabel === "Helmet"),
  false,
);

const correction = await getJson(
  "/v1/identity-claims/claim_identity_fixture/not-this-person",
  {
    body: JSON.stringify({
      commandId: "identity.correction.reject.001",
      note: "Synthetic accepted identity correction",
    }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(correction.changed, true);
assert.equal(correction.state, "rejected");
assert.equal(correction.undo.eligible, true);
const correctionReplay = await getJson(
  "/v1/identity-claims/claim_identity_fixture/not-this-person",
  {
    body: JSON.stringify({
      commandId: "identity.correction.reject.001",
      note: "Synthetic accepted identity correction",
    }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(correctionReplay.replayed, true);
assert.equal(correctionReplay.decisionId, correction.decisionId);
const correctionConflict = await fetch(
  `${root}/v1/identity-claims/claim_identity_fixture/not-this-person`,
  {
    body: JSON.stringify({
      commandId: "identity.correction.reject.001",
      note: "Different payload",
    }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(correctionConflict.status, 409);
assert.equal(
  (await correctionConflict.json()).code,
  "IDENTITY_CORRECTION_COMMAND_CONFLICT",
);

const identityCorrected = await getJson(
  "/v1/people/person_service_fixture/identity?limit=10",
);
assert.equal(identityCorrected.items.length, 0);
const correctionHistory = await getJson(
  "/v1/identity-claims/claim_identity_fixture/history",
);
assert.equal(
  correctionHistory.schemaVersion,
  "cimmich.identity-correction-history.v1",
);
assert.equal(
  correctionHistory.items.some(
    (item) => item.decisionId === correction.decisionId && item.undo.eligible,
  ),
  true,
);
const discoveredCorrections = await getJson(
  "/v1/identity-corrections?personId=person_service_fixture&undoEligible=true",
);
assert.equal(
  discoveredCorrections.schemaVersion,
  "cimmich.identity-correction-history.v1",
);
assert.deepEqual(discoveredCorrections.scope, {
  kind: "person",
  personId: "person_service_fixture",
});
assert.equal(
  discoveredCorrections.items.some(
    (item) =>
      item.decisionId === correction.decisionId &&
      item.faceId === correction.faceId &&
      item.personId === correction.personId &&
      item.undo.eligible,
  ),
  true,
);
const correctionUndone = await getJson(
  `/v1/identity-claims/decisions/${encodeURIComponent(correction.decisionId)}/undo`,
  {
    body: JSON.stringify({ commandId: "identity.correction.undo.001" }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(correctionUndone.state, "accepted");
const correctionUndoReplay = await getJson(
  `/v1/identity-claims/decisions/${encodeURIComponent(correction.decisionId)}/undo`,
  {
    body: JSON.stringify({ commandId: "identity.correction.undo.001" }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(correctionUndoReplay.replayed, true);
assert.equal(
  (
    await getJson(
      "/v1/identity-corrections?personId=person_service_fixture&undoEligible=true",
    )
  ).items.some((item) => item.decisionId === correction.decisionId),
  false,
);
const correctionUndoStale = await fetch(
  `${root}/v1/identity-claims/decisions/${encodeURIComponent(correction.decisionId)}/undo`,
  {
    body: JSON.stringify({ commandId: "identity.correction.undo.002" }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(correctionUndoStale.status, 409);
assert.equal(
  (await correctionUndoStale.json()).code,
  "IDENTITY_CORRECTION_UNDO_NOT_AVAILABLE",
);
assert.equal(
  (await getJson("/v1/people/person_service_fixture/identity?limit=10")).items
    .length,
  1,
);
const correctionFinal = await getJson(
  `/v1/identity-claims/${encodeURIComponent(correctionUndone.claimId)}/not-this-person`,
  {
    body: JSON.stringify({
      commandId: "identity.correction.reject.002",
      note: "Restore disposable correction state",
    }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(correctionFinal.state, "rejected");
assert.equal(
  (await getJson("/v1/people/person_service_fixture/identity?limit=10")).items
    .length,
  0,
);

for (const collision of [
  ["Synthetic Person Two", "person_reassign_fixture"],
  ["Synthetic Existing Alias", "person_reassign_fixture"],
]) {
  const conflict = await fetch(
    `${root}/v1/faces/face_new_person_fixture/identity`,
    {
      body: JSON.stringify({ newPersonName: collision[0] }),
      headers: {
        "content-type": "application/json",
        "x-cimmich-actor": "synthetic-operator",
      },
      method: "POST",
    },
  );
  assert.equal(conflict.status, 409);
  const payload = await conflict.json();
  assert.equal(payload.code, "PERSON_NAME_CONFLICT");
  assert.equal(payload.details.existingPeople[0].personId, collision[1]);
}

const createdFromFace = await getJson(
  "/v1/faces/face_new_person_fixture/identity",
  {
    body: JSON.stringify({ newPersonName: "Synthetic New Face Person" }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(createdFromFace.changed, true);
assert.equal(createdFromFace.createdPerson, true);
assert.equal(createdFromFace.faceId, "face_new_person_fixture");
assert.equal(createdFromFace.personName, "Synthetic New Face Person");
assert.equal(createdFromFace.previousPersonId, null);
assert.equal(createdFromFace.state, "accepted");
assert.equal(
  (
    await getJson(
      `/v1/people/${encodeURIComponent(createdFromFace.personId)}/identity?limit=10`,
    )
  ).items[0].face_id,
  "face_new_person_fixture",
);
assert.equal(
  (
    await getJson(
      `/v1/people/${encodeURIComponent(createdFromFace.personId)}/setup`,
    )
  ).categories.some((category) => category.slug === "sort"),
  true,
);
const newPersonConflict = await fetch(
  `${root}/v1/faces/face_new_person_fixture/identity`,
  {
    body: JSON.stringify({ newPersonName: "Synthetic New Face Person" }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(newPersonConflict.status, 409);
assert.equal(
  (await getJson("/v1/people?limit=500")).items.filter(
    (person) => person.display_name === "Synthetic New Face Person",
  ).length,
  1,
);

const reassignment = await getJson("/v1/faces/face_service_fixture/identity", {
  body: JSON.stringify({ personName: "Synthetic Person Two" }),
  headers: {
    "content-type": "application/json",
    "x-cimmich-actor": "synthetic-operator",
  },
  method: "POST",
});
assert.equal(reassignment.changed, true);
assert.equal(reassignment.createdPerson, false);
assert.equal(reassignment.personId, "person_reassign_fixture");
assert.equal(reassignment.previousPersonId, null);
const reassignedIdentity = await getJson(
  "/v1/people/person_reassign_fixture/identity?limit=10",
);
assert.equal(reassignedIdentity.items.length, 1);
assert.equal(reassignedIdentity.items[0].face_id, "face_service_fixture");

const split = await getJson(
  "/v1/people/person_split_fixture/identity/faces/face_split_fixture/move",
  {
    body: JSON.stringify({
      bodyId: "body_split_fixture",
      moveBody: true,
      newPersonName: "Synthetic Split Destination",
    }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(split.changed, true);
assert.equal(split.createdPerson, true);
assert.equal(split.movedBody, true);
assert.equal(
  (await getJson("/v1/people/person_split_fixture/identity?limit=10")).items
    .length,
  0,
);
let splitIdentity = await getJson(
  `/v1/people/${encodeURIComponent(split.personId)}/identity?limit=10`,
);
assert.equal(splitIdentity.items.length, 1);
assert.equal(
  splitIdentity.items[0].buckets.some(
    (bucket) => bucket.bucket_kind === "head",
  ),
  true,
);
assert.equal(
  splitIdentity.items[0].body_selected,
  true,
  JSON.stringify(splitIdentity.items[0]),
);
assert.equal(
  (
    await getJson(`/v1/people/${encodeURIComponent(split.personId)}/setup`)
  ).categories.some((category) => category.slug === "sort"),
  true,
);
const movedBack = await getJson(
  `/v1/people/${encodeURIComponent(split.personId)}/identity/faces/face_split_fixture/move`,
  {
    body: JSON.stringify({
      bodyId: "body_split_fixture",
      moveBody: true,
      targetPersonId: "person_split_fixture",
    }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(movedBack.changed, true);
assert.equal(movedBack.createdPerson, false);
assert.equal(movedBack.movedBody, true);
splitIdentity = await getJson(
  "/v1/people/person_split_fixture/identity?limit=10",
);
assert.equal(
  splitIdentity.items[0].buckets.some(
    (bucket) => bucket.bucket_kind === "head",
  ),
  true,
);
assert.equal(splitIdentity.items[0].body_selected, true);

const aliasAdded = await getJson("/v1/people/person_service_fixture/aliases", {
  body: JSON.stringify({ aliasKind: "nickname", label: "Synthetic Nickname" }),
  headers: {
    "content-type": "application/json",
    "x-cimmich-actor": "synthetic-operator",
  },
  method: "POST",
});
assert.equal(aliasAdded.changed, true);
let setup = await getJson("/v1/people/person_service_fixture/setup");
assert.equal(
  setup.alias_items.some((alias) => alias.label === "Synthetic Nickname"),
  true,
);

const markedPet = await getJson(
  "/v1/people/person_service_fixture/subject-kind",
  {
    body: JSON.stringify({ subjectKind: "pet" }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(markedPet.subjectKind, "pet");
assert.equal(
  (await getJson("/v1/people/person_service_fixture/setup")).subject_kind,
  "pet",
);
const markedPerson = await getJson(
  "/v1/people/person_service_fixture/subject-kind",
  {
    body: JSON.stringify({ subjectKind: "person" }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(markedPerson.subjectKind, "person");

const markedPetWithFace = await getJson(
  "/v1/people/person_reassign_fixture/subject-kind",
  {
    body: JSON.stringify({ subjectKind: "pet" }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(markedPetWithFace.subjectKind, "pet");
const routedPet = (await getJson("/v1/people?limit=500")).items.find(
  (person) => person.person_id === "person_reassign_fixture",
);
assert.equal(routedPet.subject_kind, "pet");
assert.equal(routedPet.representative_asset_id, "asset_service_fixture");
assert.equal(routedPet.representative_face_id, "face_service_fixture");
await getJson("/v1/people/person_reassign_fixture/subject-kind", {
  body: JSON.stringify({ subjectKind: "person" }),
  headers: {
    "content-type": "application/json",
    "x-cimmich-actor": "synthetic-operator",
  },
  method: "POST",
});

const familyCategory = (
  await getJson("/v1/people/person_reassign_fixture/setup")
).category_catalog.find((category) => category.slug === "family");
assert.ok(familyCategory);
await getJson(
  `/v1/people/person_reassign_fixture/categories/${encodeURIComponent(familyCategory.category_id)}`,
  {
    body: JSON.stringify({ selected: true }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);

const mergePreview = await getJson(
  "/v1/people/merge-preview?sourcePersonId=person_reassign_fixture&targetPersonId=person_service_fixture",
);
assert.equal(mergePreview.source.display_name, "Synthetic Person Two");
assert.equal(mergePreview.target.display_name, "Synthetic Person");
const merge = await getJson("/v1/people/merge", {
  body: JSON.stringify({
    commandId: "acceptance-person-merge-0001",
    sourcePersonId: "person_reassign_fixture",
    targetPersonId: "person_service_fixture",
  }),
  headers: {
    "content-type": "application/json",
    "x-cimmich-actor": "synthetic-operator",
  },
  method: "POST",
});
assert.equal(merge.changed, true);
const mergeReplay = await getJson("/v1/people/merge", {
  body: JSON.stringify({
    commandId: "acceptance-person-merge-0001",
    sourcePersonId: "person_reassign_fixture",
    targetPersonId: "person_service_fixture",
  }),
  headers: {
    "content-type": "application/json",
    "x-cimmich-actor": "synthetic-operator",
  },
  method: "POST",
});
assert.equal(mergeReplay.mergeOperationId, merge.mergeOperationId);
assert.equal(mergeReplay.replayed, true);
assert.equal(
  (await getJson("/v1/people/person_service_fixture/identity?limit=10"))
    .items[0].face_id,
  "face_service_fixture",
);
setup = await getJson("/v1/people/person_service_fixture/setup");
assert.equal(setup.merges.length, 1);
assert.equal(
  setup.alias_items.some((alias) => alias.label === "Synthetic Person Two"),
  true,
);
assert.equal(
  setup.categories.some((category) => category.slug === "family"),
  true,
);

const unmerge = await getJson(
  `/v1/people/merges/${encodeURIComponent(merge.mergeOperationId)}/unmerge`,
  {
    body: JSON.stringify({ commandId: "acceptance-person-unmerge-0001" }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(unmerge.changed, true);
const unmergeReplay = await getJson(
  `/v1/people/merges/${encodeURIComponent(merge.mergeOperationId)}/unmerge`,
  {
    body: JSON.stringify({ commandId: "acceptance-person-unmerge-0001" }),
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(unmergeReplay.mergeOperationId, merge.mergeOperationId);
assert.equal(unmergeReplay.replayed, true);
assert.equal(
  (await getJson("/v1/people/person_reassign_fixture/identity?limit=10"))
    .items[0].face_id,
  "face_service_fixture",
);
setup = await getJson("/v1/people/person_service_fixture/setup");
assert.equal(setup.merges.length, 0);
assert.equal(
  setup.alias_items.some((alias) => alias.label === "Synthetic Person Two"),
  false,
);
assert.equal(
  setup.categories.some((category) => category.slug === "family"),
  false,
);
assert.equal(
  (await getJson("/v1/people/person_reassign_fixture/setup")).categories.some(
    (category) => category.slug === "family",
  ),
  true,
);

const aliasRemoved = await getJson(
  `/v1/people/person_service_fixture/aliases/${encodeURIComponent(aliasAdded.alias.alias_id)}/remove`,
  {
    body: "{}",
    headers: {
      "content-type": "application/json",
      "x-cimmich-actor": "synthetic-operator",
    },
    method: "POST",
  },
);
assert.equal(aliasRemoved.changed, true);
assert.equal(
  (await getJson("/v1/people/person_service_fixture/setup")).alias_items.length,
  0,
);

console.log(
  "Cimmich local service acceptance: PASS (ranked/bulk candidates + review + Sort/Holding trust + galleries + correction + aliases + type + merge/unmerge)",
);
