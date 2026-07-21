import assert from "node:assert/strict";

const root = process.env.CIMMICH_ACCEPTANCE_ROOT || "http://127.0.0.1:3101";
const headers = {
  "content-type": "application/json",
  "x-cimmich-actor": "synthetic-pet-editor",
};

const request = async (path, { body, method = "GET", status = 200 } = {}) => {
  const response = await fetch(`${root}${path}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(body === undefined ? {} : { headers }),
    method,
  });
  const payload = await response.json();
  assert.equal(response.status, status, JSON.stringify(payload));
  return payload;
};

const first = await request("/v1/pets", {
  body: {
    aliases: ["Mimi"],
    breedLabel: "Domestic Shorthair",
    commandId: "acceptance-pet-create-a",
    coverAssetId: "asset_identity_fixture",
    coverCrop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
    description: "Synthetic ginger cat",
    displayName: "Miso",
    speciesKind: "cat",
  },
  method: "POST",
  status: 201,
});
assert.equal(first.pet.displayName, "Miso");
assert.equal(first.pet.confirmedMediaCount, 0);
assert.equal(first.pet.documentCount, 0);
assert.equal(first.pet.breedLabel, "Domestic Shorthair");
assert.equal(first.pet.speciesKind, "cat");
assert.equal(first.pet.speciesLabel, null);
assert.equal(first.schemaVersion, "cimmich.pet-manual.v2");

const replay = await request("/v1/pets", {
  body: {
    aliases: ["Mimi"],
    breedLabel: "Domestic Shorthair",
    commandId: "acceptance-pet-create-a",
    coverAssetId: "asset_identity_fixture",
    coverCrop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
    description: "Synthetic ginger cat",
    displayName: "Miso",
    speciesKind: "cat",
  },
  method: "POST",
  status: 201,
});
assert.equal(replay.replayed, true);
assert.equal(replay.pet.petId, first.pet.petId);

const second = await request("/v1/pets", {
  body: {
    commandId: "acceptance-pet-create-b",
    displayName: "Pixel",
    speciesKind: "dog",
  },
  method: "POST",
  status: 201,
});

const updated = await request(`/v1/pets/${first.pet.petId}`, {
  body: {
    aliases: ["Mimi", "Bean"],
    breedLabel: "Ginger rescue",
    commandId: "acceptance-pet-update-a",
    description: "Synthetic ginger rescue cat",
  },
  method: "PATCH",
});
assert.deepEqual(updated.pet.aliases.sort(), ["Bean", "Mimi"]);
assert.equal(updated.pet.speciesKind, "cat");
assert.equal(updated.pet.breedLabel, "Ginger rescue");

const clearedBreed = await request(`/v1/pets/${first.pet.petId}`, {
  body: {
    breedLabel: null,
    commandId: "acceptance-pet-breed-clear",
  },
  method: "PATCH",
});
assert.equal(clearedBreed.pet.breedLabel, null);
const restoredBreed = await request(`/v1/pets/${first.pet.petId}`, {
  body: {
    breedLabel: "Domestic Shorthair",
    commandId: "acceptance-pet-breed-restore",
  },
  method: "PATCH",
});
assert.equal(restoredBreed.pet.breedLabel, "Domestic Shorthair");

const otherSpecies = await request(`/v1/pets/${second.pet.petId}`, {
  body: {
    commandId: "acceptance-pet-species-other",
    speciesKind: "other",
    speciesLabel: "Axolotl",
  },
  method: "PATCH",
});
assert.equal(otherSpecies.pet.speciesKind, "other");
assert.equal(otherSpecies.pet.speciesLabel, "Axolotl");
const otherSpeciesReplay = await request(`/v1/pets/${second.pet.petId}`, {
  body: {
    commandId: "acceptance-pet-species-other",
    speciesKind: "other",
    speciesLabel: "Axolotl",
  },
  method: "PATCH",
});
assert.equal(otherSpeciesReplay.replayed, true);

const invalidSpecies = await request(`/v1/pets/${first.pet.petId}`, {
  body: {
    commandId: "acceptance-pet-species-invalid",
    speciesKind: "cat",
    speciesLabel: "Not permitted",
  },
  method: "PATCH",
  status: 400,
});
assert.equal(invalidSpecies.code, "PET_SPECIES_INVALID");

const attached = await request(`/v1/pets/${first.pet.petId}/media:attach`, {
  body: {
    assetIds: ["asset_service_fixture", "asset_identity_fixture"],
    commandId: "acceptance-pet-attach-a",
  },
  method: "POST",
});
assert.equal(attached.status, "applied");
assert.equal(attached.pet.confirmedMediaCount, 2);
assert.equal(attached.undo.eligible, true);

const attachedReplay = await request(
  `/v1/pets/${first.pet.petId}/media:attach`,
  {
    body: {
      assetIds: ["asset_service_fixture", "asset_identity_fixture"],
      commandId: "acceptance-pet-attach-a",
    },
    method: "POST",
  },
);
assert.equal(attachedReplay.replayed, true);

let search = await request(`/v1/search/media?petId=${first.pet.petId}`);
assert.equal(search.items.length, 2);
const subjects = await request("/v1/assets/asset_service_fixture/subjects");
assert.ok(
  subjects.items.some(
    (subject) =>
      subject.subjectId === first.pet.petId && subject.subjectKind === "pet",
  ),
);

const detached = await request(`/v1/pets/${first.pet.petId}/media:detach`, {
  body: {
    assetIds: ["asset_service_fixture"],
    commandId: "acceptance-pet-detach-a",
  },
  method: "POST",
});
assert.equal(detached.pet.confirmedMediaCount, 1);

const undone = await request(`/v1/decisions/${detached.decisionId}/undo`, {
  body: { commandId: "acceptance-pet-undo-detach" },
  method: "POST",
});
assert.equal(undone.status, "reverted");
search = await request(`/v1/search/media?petId=${first.pet.petId}`);
assert.equal(search.items.length, 2);

const unavailableUndo = await request(
  `/v1/decisions/${detached.decisionId}/undo`,
  {
    body: { commandId: "acceptance-pet-undo-again" },
    method: "POST",
    status: 409,
  },
);
assert.equal(unavailableUndo.code, "PET_UNDO_NOT_AVAILABLE");

const isolation = await request(
  `/v1/pets/merge-preview?sourcePetId=${first.pet.petId}&targetPetId=person_service_fixture`,
  { status: 409 },
);
assert.equal(isolation.code, "PET_PERSON_ISOLATION");

const mergeDocument = await request(
  `/v1/pets/${first.pet.petId}/documents:attach`,
  {
    body: {
      commandId: "acceptance-pet-merge-document-attach",
      documents: [
        {
          assetId: "asset_service_fixture",
          documentKind: "other",
          documentLabel: "Merge rollback evidence",
        },
      ],
    },
    method: "POST",
  },
);
assert.equal(mergeDocument.status, "applied");

const preview = await request(
  `/v1/pets/merge-preview?sourcePetId=${first.pet.petId}&targetPetId=${second.pet.petId}`,
);
assert.equal(preview.source.subject_kind, "pet");
const mergeBody = {
  commandId: "acceptance-pet-merge-0001",
  sourcePetId: first.pet.petId,
  targetPetId: second.pet.petId,
};
const merged = await request("/v1/pets/merge", {
  body: mergeBody,
  method: "POST",
});
assert.ok(merged.mergeOperationId);
assert.equal(merged.schemaVersion, "cimmich.person-merge.v2");
const mergedReplay = await request("/v1/pets/merge", {
  body: mergeBody,
  method: "POST",
});
assert.equal(mergedReplay.mergeOperationId, merged.mergeOperationId);
assert.equal(mergedReplay.replayed, true);
const unmergeBody = { commandId: "acceptance-pet-unmerge-0001" };
const unmerged = await request(
  `/v1/pets/merges/${merged.mergeOperationId}/unmerge`,
  { body: unmergeBody, method: "POST" },
);
assert.equal(unmerged.mergeOperationId, merged.mergeOperationId);
assert.equal(unmerged.schemaVersion, "cimmich.person-merge.v2");
const unmergedReplay = await request(
  `/v1/pets/merges/${merged.mergeOperationId}/unmerge`,
  { body: unmergeBody, method: "POST" },
);
assert.equal(unmergedReplay.mergeOperationId, merged.mergeOperationId);
assert.equal(unmergedReplay.replayed, true);
search = await request(`/v1/search/media?petId=${first.pet.petId}`);
assert.equal(search.items.length, 2);
const restoredDocuments = await request(
  `/v1/pets/${first.pet.petId}/documents`,
);
assert.equal(restoredDocuments.items.length, 1);
assert.equal(
  restoredDocuments.items[0].documentLabel,
  "Merge rollback evidence",
);
await request(`/v1/pets/${first.pet.petId}/documents:detach`, {
  body: {
    assetIds: ["asset_service_fixture"],
    commandId: "acceptance-pet-merge-document-cleanup",
  },
  method: "POST",
});

console.log("Cimmich Pet manual journey acceptance: PASS");
