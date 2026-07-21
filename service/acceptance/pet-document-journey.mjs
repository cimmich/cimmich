import assert from "node:assert/strict";

const root = process.env.CIMMICH_ACCEPTANCE_ROOT || "http://127.0.0.1:3101";
const phase = process.env.CIMMICH_PET_DOCUMENT_PHASE || "all";
const headers = {
  "content-type": "application/json",
  "x-cimmich-actor": "synthetic-pet-document-editor",
};

const request = async (path, { body, method = "GET", status = 200 } = {}) => {
  const response = await fetch(`${root}${path}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers }),
    method,
  });
  const payload = await response.json();
  assert.equal(response.status, status, JSON.stringify(payload));
  return payload;
};

const pets = await request("/v1/pets?q=Miso");
const pet = pets.items.find((item) => item.displayName === "Miso");
assert.ok(pet);
const petId = pet.petId;

const expectedAssetIds = ["asset_identity_fixture", "asset_service_fixture"];

const assertPersisted = async () => {
  const currentPet = await request(`/v1/pets/${petId}`);
  assert.equal(currentPet.breedLabel, "Domestic Shorthair");
  assert.equal(currentPet.confirmedMediaCount, 2);
  assert.equal(currentPet.documentCount, 2);
  const projection = await request(`/v1/pets/${petId}/documents`);
  assert.equal(projection.schemaVersion, "cimmich.pet-document.v1");
  assert.deepEqual(
    projection.items.map((item) => item.assetId).sort(),
    expectedAssetIds,
  );
  assert.equal(
    projection.items.find((item) => item.assetId === "asset_service_fixture")
      .documentKind,
    "vaccination",
  );
};

if (phase === "write" || phase === "all") {
  const initial = await request(`/v1/pets/${petId}/documents`);
  assert.deepEqual(initial.items, []);

  const attachBody = {
    commandId: "pet-document-attach-acceptance-01",
    documents: [
      {
        assetId: "asset_service_fixture",
        documentKind: "vaccination",
        documentLabel: "Annual vaccination",
      },
      {
        assetId: "asset_identity_fixture",
        documentKind: "insurance",
        documentLabel: "Example policy",
      },
    ],
  };
  const attached = await request(`/v1/pets/${petId}/documents:attach`, {
    body: attachBody,
    method: "POST",
  });
  assert.equal(attached.status, "applied");
  assert.equal(attached.documents.items.length, 2);
  assert.equal(attached.undo.eligible, true);

  const replay = await request(`/v1/pets/${petId}/documents:attach`, {
    body: attachBody,
    method: "POST",
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.decisionId, attached.decisionId);

  const conflict = await request(`/v1/pets/${petId}/documents:attach`, {
    body: {
      ...attachBody,
      documents: attachBody.documents.slice(0, 1),
    },
    method: "POST",
    status: 409,
  });
  assert.equal(conflict.code, "PET_DOCUMENT_COMMAND_CONFLICT");

  const invalid = await request(`/v1/pets/${petId}/documents:attach`, {
    body: {
      commandId: "pet-document-invalid-kind-01",
      documents: [
        { assetId: "asset_service_fixture", documentKind: "medical_guess" },
      ],
    },
    method: "POST",
    status: 400,
  });
  assert.equal(invalid.code, "PET_DOCUMENT_KIND_INVALID");

  const isolated = await request(
    "/v1/pets/person_service_fixture/documents:attach",
    {
      body: {
        commandId: "pet-document-isolation-001",
        documents: [
          { assetId: "asset_service_fixture", documentKind: "other" },
        ],
      },
      method: "POST",
      status: 404,
    },
  );
  assert.equal(isolated.code, "PET_DOCUMENT_PET_NOT_FOUND");

  const detached = await request(`/v1/pets/${petId}/documents:detach`, {
    body: {
      assetIds: ["asset_service_fixture"],
      commandId: "pet-document-detach-acceptance-01",
    },
    method: "POST",
  });
  assert.equal(detached.documents.items.length, 1);
  const undone = await request(
    `/v1/pet-documents/decisions/${detached.decisionId}/undo`,
    {
      body: { commandId: "pet-document-undo-detach-001" },
      method: "POST",
    },
  );
  assert.equal(undone.status, "reverted");
  assert.equal(undone.documents.items.length, 2);

  const staleUndo = await request(
    `/v1/pet-documents/decisions/${detached.decisionId}/undo`,
    {
      body: { commandId: "pet-document-undo-detach-002" },
      method: "POST",
      status: 409,
    },
  );
  assert.equal(staleUndo.code, "PET_DOCUMENT_UNDO_NOT_AVAILABLE");

  const noChange = await request(`/v1/pets/${petId}/documents:attach`, {
    body: {
      commandId: "pet-document-no-change-001",
      documents: attachBody.documents,
    },
    method: "POST",
  });
  assert.equal(noChange.status, "no_change");
  assert.equal(noChange.undo.eligible, false);

  await assertPersisted();
}

if (phase === "readback" || phase === "all") await assertPersisted();

console.log(`Cimmich Pet document journey (${phase}): PASS`);
