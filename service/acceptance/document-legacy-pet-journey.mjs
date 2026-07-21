import assert from "node:assert/strict";

const root = process.env.CIMMICH_ACCEPTANCE_ROOT || "http://127.0.0.1:3101";
const phase = process.env.CIMMICH_DOCUMENT_LEGACY_PET_PHASE || "all";
const headers = {
  "content-type": "application/json",
  "x-cimmich-actor": "synthetic-document-compatibility-editor",
  "x-cimmich-device-id": "synthetic-document-compatibility-device",
  "x-cimmich-principal-id": "local-primary",
  "x-cimmich-surface": "interactive",
};

const request = async (path, { body, method = "GET", status = 200 } = {}) => {
  const response = await fetch(`${root}${path}`, {
    ...(body === undefined
      ? { headers }
      : { body: JSON.stringify(body), headers }),
    method,
  });
  const payload = await response.json();
  assert.equal(response.status, status, JSON.stringify(payload));
  return payload;
};
const setMode = (viewingMode) =>
  request("/v1/visibility/mode", { body: { viewingMode }, method: "POST" });

const pets = await request("/v1/pets?q=Miso");
const pet = pets.items.find((item) => item.displayName === "Miso");
assert.ok(pet);
const petId = pet.petId;

const legacyDocuments = await request(`/v1/pets/${petId}/documents`);
assert.equal(legacyDocuments.items.length, 2);
const legacy = legacyDocuments.items.find(
  (item) => item.assetId === "asset_identity_fixture",
);
assert.ok(legacy);

if (phase === "write" || phase === "all") {
  const candidates = await request(
    `/v1/documents/legacy-pet-links?petId=${encodeURIComponent(petId)}`,
  );
  assert.equal(candidates.schemaVersion, "cimmich.document-legacy-pet.v1");
  assert.equal(candidates.items.length, 2);
  const candidate = candidates.items.find(
    (item) => item.legacyAssociationId === legacy.associationId,
  );
  assert.equal(candidate.state, "available");

  const adoptBody = {
    commandId: "document.legacy.pet.adopt.001",
    displayTitle: "Synthetic Pet insurance policy",
    sourceFilename: "synthetic-pet-insurance.jpg",
    visibilityTier: "personal",
  };
  const adopted = await request(
    `/v1/documents/legacy-pet-links/${candidate.legacyAssociationId}:adopt`,
    { body: adoptBody, method: "POST", status: 201 },
  );
  assert.equal(adopted.createdDocument, true);
  assert.equal(adopted.createdLink, true);
  assert.equal(adopted.reactivatedDocument, false);

  const replay = await request(
    `/v1/documents/legacy-pet-links/${candidate.legacyAssociationId}:adopt`,
    { body: adoptBody, method: "POST", status: 201 },
  );
  assert.equal(replay.replayed, true);
  assert.equal(replay.documentId, adopted.documentId);

  const conflict = await request(
    `/v1/documents/legacy-pet-links/${candidate.legacyAssociationId}:adopt`,
    {
      body: { ...adoptBody, displayTitle: "Conflicting title" },
      method: "POST",
      status: 409,
    },
  );
  assert.equal(conflict.code, "DOCUMENT_COMMAND_CONFLICT");

  await request(`/v1/documents/${adopted.documentId}`, { status: 404 });
  await setMode("personal");
  const document = await request(`/v1/documents/${adopted.documentId}`);
  assert.equal(document.links.length, 1);
  assert.equal(document.links[0].subjectId, petId);
  assert.equal(document.links[0].subjectKind, "pet");
  assert.equal(document.links[0].relationKind, "about");

  const adoptedCandidates = await request(
    `/v1/documents/legacy-pet-links?petId=${encodeURIComponent(petId)}&includeAdopted=true`,
  );
  const adoptedCandidate = adoptedCandidates.items.find(
    (item) => item.legacyAssociationId === candidate.legacyAssociationId,
  );
  assert.equal(adoptedCandidate.state, "adopted");
  assert.equal(adoptedCandidate.adoptedDocumentId, adopted.documentId);

  const undone = await request(
    `/v1/document-legacy-pet-decisions/${adopted.decisionId}/undo`,
    {
      body: { commandId: "document.legacy.pet.undo.001" },
      method: "POST",
    },
  );
  assert.equal(undone.undoneDecisionId, adopted.decisionId);
  const stale = await request(
    `/v1/document-legacy-pet-decisions/${adopted.decisionId}/undo`,
    {
      body: { commandId: "document.legacy.pet.undo.002" },
      method: "POST",
      status: 409,
    },
  );
  assert.equal(stale.code, "DOCUMENT_UNDO_STALE");

  const availableAgain = await request(
    `/v1/documents/legacy-pet-links?petId=${encodeURIComponent(petId)}`,
  );
  assert.ok(
    availableAgain.items.some(
      (item) => item.legacyAssociationId === candidate.legacyAssociationId,
    ),
  );
  assert.equal((await request(`/v1/pets/${petId}/documents`)).items.length, 2);

  const readopted = await request(
    `/v1/documents/legacy-pet-links/${candidate.legacyAssociationId}:adopt`,
    {
      body: { ...adoptBody, commandId: "document.legacy.pet.adopt.002" },
      method: "POST",
      status: 201,
    },
  );
  assert.equal(readopted.documentId, adopted.documentId);
  assert.equal(readopted.createdDocument, false);
  assert.equal(readopted.reactivatedDocument, true);
  await writeFileState({ documentId: readopted.documentId, petId });
}

if (phase === "readback" || phase === "all") {
  const state = await readFileState();
  await setMode("personal");
  const document = await request(`/v1/documents/${state.documentId}`);
  assert.equal(document.status, "active");
  assert.equal(document.links.length, 1);
  assert.equal(document.links[0].subjectId, state.petId);
  assert.equal(
    (await request(`/v1/pets/${state.petId}/documents`)).items.length,
    2,
  );
}

console.log(`Cimmich legacy Pet Document journey (${phase}): PASS`);

async function writeFileState(value) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    "/tmp/cimmich-document-legacy-pet-acceptance.json",
    JSON.stringify(value),
  );
}
async function readFileState() {
  const { readFile } = await import("node:fs/promises");
  return JSON.parse(
    await readFile("/tmp/cimmich-document-legacy-pet-acceptance.json", "utf8"),
  );
}
