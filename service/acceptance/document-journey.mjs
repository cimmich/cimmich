import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const root = "http://127.0.0.1:3101";
const phase = process.env.CIMMICH_DOCUMENT_PHASE || "write";
const expectQuotaRejection =
  process.env.CIMMICH_DOCUMENT_EXPECT_QUOTA_REJECTION !== "false";
const statePath = "/tmp/cimmich-document-acceptance.json";
const baseHeaders = {
  "x-cimmich-actor": "synthetic-document-editor",
  "x-cimmich-device-id": "synthetic-document-device",
  "x-cimmich-principal-id": "local-primary",
  "x-cimmich-surface": "interactive",
};
let privateToken = "";

const request = async (
  path,
  { body, headers = {}, method = "GET", raw = false } = {},
) => {
  const response = await fetch(`${root}${path}`, {
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    headers: {
      ...baseHeaders,
      ...(privateToken ? { "x-cimmich-private-session": privateToken } : {}),
      ...(raw
        ? {}
        : body === undefined
          ? {}
          : { "content-type": "application/json" }),
      ...headers,
    },
    method,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw Object.assign(new Error(error.error || `${method} ${path} failed`), {
      code: error.code,
      details: error.details,
      status: response.status,
    });
  }
  return response;
};
const json = async (path, options) => (await request(path, options)).json();
const expectError = async (path, options, status, code) => {
  try {
    await request(path, options);
    assert.fail(`${options?.method || "GET"} ${path} unexpectedly succeeded`);
  } catch (error) {
    assert.equal(error.status, status);
    assert.equal(error.code, code);
  }
};
const setMode = async (viewingMode) =>
  json("/v1/visibility/mode", { body: { viewingMode }, method: "POST" });
const unlockPrivate = async () => {
  const unlocked = await json("/v1/visibility/unlock", {
    body: { password: "1" },
    method: "POST",
  });
  privateToken = unlocked.privateSessionToken;
  assert.ok(privateToken);
  await setMode("private");
};

if (phase === "write") {
  const pet = await json("/v1/pets", {
    body: {
      commandId: "document.acceptance.pet.create.001",
      displayName: "Synthetic Document Pet",
    },
    method: "POST",
  });
  const place = await json("/v1/places", {
    body: {
      commandId: "document.acceptance.place.create.001",
      displayName: "Synthetic Document Place",
      geometry: null,
      typeKind: "unlocated",
    },
    method: "POST",
  });
  const object = await json("/v1/objects", {
    body: {
      commandId: "document.acceptance.object.create.001",
      displayName: "Synthetic Document Object",
      typeKind: "vehicle",
    },
    method: "POST",
  });
  const event = await json("/v1/events", {
    body: {
      commandId: "document.acceptance.event.create.001",
      displayName: "Synthetic Document Event",
      typeKind: "event",
    },
    method: "POST",
  });

  const referenced = await json("/v1/documents/reference", {
    body: {
      assetId: "asset_service_fixture",
      commandId: "document.acceptance.reference.001",
      displayTitle: "Synthetic source certificate",
      documentKind: "certificate",
      sourceFilename: "source-certificate.jpg",
      visibilityTier: "standard",
    },
    method: "POST",
  });
  assert.match(referenced.documentId, /^document_[0-9a-f]{32}$/);
  const replay = await json("/v1/documents/reference", {
    body: {
      assetId: "asset_service_fixture",
      commandId: "document.acceptance.reference.001",
      displayTitle: "Synthetic source certificate",
      documentKind: "certificate",
      sourceFilename: "source-certificate.jpg",
      visibilityTier: "standard",
    },
    method: "POST",
  });
  assert.equal(replay.documentId, referenced.documentId);
  assert.equal(replay.replayed, true);
  await expectError(
    "/v1/documents/reference",
    {
      body: {
        assetId: "asset_service_fixture",
        commandId: "document.acceptance.reference.001",
        displayTitle: "Conflicting title",
        documentKind: "certificate",
      },
      method: "POST",
    },
    409,
    "DOCUMENT_COMMAND_CONFLICT",
  );

  const contentBytes = Buffer.from("Cimmich synthetic private lease\n", "utf8");
  const importMetadata = {
    commandId: "document.acceptance.import.001",
    displayTitle: "Synthetic private lease",
    documentKind: "lease",
    issuedOn: "2025-01-01",
    sourceFilename: "synthetic-lease.txt",
    visibilityTier: "personal",
  };
  const imported = await json("/v1/documents/import", {
    body: contentBytes,
    headers: {
      "content-type": "text/plain",
      "x-cimmich-document-metadata": Buffer.from(
        JSON.stringify(importMetadata),
      ).toString("base64url"),
    },
    method: "POST",
    raw: true,
  });
  assert.match(imported.documentId, /^document_[0-9a-f]{32}$/);

  const standard = await json("/v1/documents?q=Synthetic");
  assert.deepEqual(
    standard.items.map((item) => item.documentId),
    [referenced.documentId],
  );
  const standardSearch = await json(
    "/v1/search/smart?q=Synthetic%20source%20certificate&limit=20",
  );
  assert.equal(standardSearch.schemaVersion, "cimmich.smart-search-basic.v2");
  assert.equal(
    standardSearch.documents.some(
      (document) => document.documentId === referenced.documentId,
    ),
    true,
  );
  const hiddenPersonalSearch = await json(
    "/v1/search/smart?q=Synthetic%20private%20lease&limit=20",
  );
  assert.equal(
    hiddenPersonalSearch.documents.some(
      (document) => document.documentId === imported.documentId,
    ),
    false,
  );
  await expectError(
    `/v1/documents/${imported.documentId}`,
    undefined,
    404,
    "DOCUMENT_NOT_FOUND",
  );

  await setMode("personal");
  const personal = await json(`/v1/documents/${imported.documentId}`);
  assert.equal(personal.visibilityTier, "personal");
  assert.equal(personal.preview.disposition, "inline");
  assert.equal(
    personal.source.contentSha256,
    createHash("sha256").update(contentBytes).digest("hex"),
  );
  const personalSearch = await json(
    "/v1/search/smart?q=Synthetic%20private%20lease&limit=20",
  );
  assert.equal(
    personalSearch.documents.some(
      (document) => document.documentId === imported.documentId,
    ),
    true,
  );

  const successorMetadata = {
    ...importMetadata,
    commandId: "document.acceptance.import.successor.001",
    displayTitle: "Synthetic renewed lease edition",
    issuedOn: "2026-01-01",
    supersedesDocumentId: imported.documentId,
  };
  const successor = await json("/v1/documents/import", {
    body: contentBytes,
    headers: {
      "content-type": "text/plain",
      "x-cimmich-document-metadata": Buffer.from(
        JSON.stringify(successorMetadata),
      ).toString("base64url"),
    },
    method: "POST",
    raw: true,
  });
  assert.equal(
    (await json(`/v1/documents/${imported.documentId}`)).supersededByDocumentId,
    successor.documentId,
  );
  const successorRead = await json(`/v1/documents/${successor.documentId}`);
  assert.equal(successorRead.supersedesDocumentId, imported.documentId);
  assert.equal(
    successorRead.source.contentSha256,
    personal.source.contentSha256,
  );

  if (expectQuotaRejection) {
    const quotaMetadata = {
      commandId: "document.acceptance.import.quota.001",
      displayTitle: "Synthetic quota rejection",
      documentKind: "other",
      documentLabel: "Quota fixture",
      sourceFilename: "quota-fixture.txt",
      visibilityTier: "personal",
    };
    await expectError(
      "/v1/documents/import",
      {
        body: Buffer.from(
          "This distinct content must exceed the tiny acceptance quota.",
          "utf8",
        ),
        headers: {
          "content-type": "text/plain",
          "x-cimmich-document-metadata": Buffer.from(
            JSON.stringify(quotaMetadata),
          ).toString("base64url"),
        },
        method: "POST",
        raw: true,
      },
      413,
      "DOCUMENT_STORE_QUOTA_EXCEEDED",
    );
  }

  const links = [
    {
      relationKind: "issued_to",
      subjectId: "person_service_fixture",
      subjectKind: "person",
    },
    { relationKind: "about", subjectId: pet.pet.petId, subjectKind: "pet" },
    {
      relationKind: "applies_to",
      subjectId: place.detail.entity.entityId,
      subjectKind: "place",
    },
    {
      relationKind: "applies_to",
      subjectId: object.detail.entity.entityId,
      subjectKind: "object",
    },
    {
      relationKind: "related",
      subjectId: event.detail.entity.entityId,
      subjectKind: "event",
    },
  ];
  const attached = await json(
    `/v1/documents/${imported.documentId}/links:attach`,
    {
      body: { commandId: "document.acceptance.links.attach.001", links },
      method: "POST",
    },
  );
  assert.equal(attached.linkCount, 5);
  assert.equal(
    (await json(`/v1/documents/${imported.documentId}`)).links.length,
    5,
  );

  const placeLink = links.filter((link) => link.subjectKind === "place");
  const detached = await json(
    `/v1/documents/${imported.documentId}/links:detach`,
    {
      body: {
        commandId: "document.acceptance.links.detach.001",
        links: placeLink,
      },
      method: "POST",
    },
  );
  assert.equal(
    (await json(`/v1/documents/${imported.documentId}`)).links.length,
    4,
  );
  const undoneDetach = await json(
    `/v1/document-decisions/${detached.decisionId}/undo`,
    {
      body: { commandId: "document.acceptance.links.undo.001" },
      method: "POST",
    },
  );
  assert.equal(undoneDetach.undoneDecisionId, detached.decisionId);
  assert.equal(
    (await json(`/v1/documents/${imported.documentId}`)).links.length,
    5,
  );
  await expectError(
    `/v1/document-decisions/${detached.decisionId}/undo`,
    {
      body: { commandId: "document.acceptance.links.undo.stale" },
      method: "POST",
    },
    409,
    "DOCUMENT_UNDO_STALE",
  );

  const updated = await json(`/v1/documents/${imported.documentId}`, {
    body: {
      commandId: "document.acceptance.update.001",
      displayTitle: "Synthetic renewed private lease",
      expiresOn: "2026-01-01",
    },
    method: "PATCH",
  });
  assert.equal(updated.changed, true);
  assert.equal(
    (await json(`/v1/documents/${imported.documentId}`)).displayTitle,
    "Synthetic renewed private lease",
  );
  await json(`/v1/document-decisions/${updated.decisionId}/undo`, {
    body: { commandId: "document.acceptance.update.undo.001" },
    method: "POST",
  });
  assert.equal(
    (await json(`/v1/documents/${imported.documentId}`)).displayTitle,
    "Synthetic private lease",
  );
  const noChange = await json(`/v1/documents/${imported.documentId}`, {
    body: {
      commandId: "document.acceptance.update.nochange.001",
      displayTitle: "Synthetic private lease",
      issuedOn: "2025-01-01",
    },
    method: "PATCH",
  });
  assert.equal(noChange.changed, false);
  assert.equal(noChange.decisionId, null);

  const bytesResponse = await request(
    `/v1/documents/${imported.documentId}/content`,
  );
  assert.equal(bytesResponse.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(
    Buffer.from(await bytesResponse.arrayBuffer()),
    contentBytes,
  );

  await expectError(
    `/v1/visibility/objects/document/${imported.documentId}`,
    {
      body: {
        commandId: "document.acceptance.visibility.private.no-session.001",
        visibilityTier: "private",
      },
      method: "PATCH",
    },
    401,
    "VISIBILITY_PRIVATE_SESSION_REQUIRED",
  );
  await unlockPrivate();
  const protectedResult = await json(
    `/v1/visibility/objects/document/${imported.documentId}`,
    {
      body: {
        commandId: "document.acceptance.visibility.private.001",
        visibilityTier: "private",
      },
      method: "PATCH",
    },
  );
  assert.equal(protectedResult.objects[0].visibilityTier, "private");
  await setMode("standard");
  await expectError(
    `/v1/documents/${imported.documentId}`,
    undefined,
    404,
    "DOCUMENT_NOT_FOUND",
  );
  await setMode("private");
  assert.equal(
    (await json(`/v1/documents/${imported.documentId}`)).links.length,
    5,
  );
  const visibilityUndo = await json(
    `/v1/visibility/decisions/${protectedResult.decisionId}/undo`,
    {
      body: { commandId: "document.acceptance.visibility.undo.001" },
      method: "POST",
    },
  );
  assert.equal(visibilityUndo.objects[0].explicit, false);
  assert.equal(visibilityUndo.objects[0].visibilityTier, "personal");
  const protectedAgain = await json(
    `/v1/visibility/objects/document/${imported.documentId}`,
    {
      body: {
        commandId: "document.acceptance.visibility.private.002",
        visibilityTier: "private",
      },
      method: "PATCH",
    },
  );
  assert.equal(protectedAgain.objects[0].visibilityTier, "private");

  await writeFile(
    statePath,
    JSON.stringify({
      content: contentBytes.toString("base64"),
      importedDocumentId: imported.documentId,
      referencedDocumentId: referenced.documentId,
      successorDocumentId: successor.documentId,
    }),
  );
  console.log("Cimmich Document V1 write acceptance: PASS");
} else if (phase === "readback") {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  const standard = await json("/v1/documents?q=Synthetic");
  assert.deepEqual(
    standard.items.map((item) => item.documentId),
    [state.referencedDocumentId],
  );
  await unlockPrivate();
  const document = await json(`/v1/documents/${state.importedDocumentId}`);
  assert.equal(document.displayTitle, "Synthetic private lease");
  assert.equal(document.links.length, 5);
  assert.equal(document.effectiveVisibilityTier, "private");
  assert.equal(document.supersededByDocumentId, state.successorDocumentId);
  assert.equal(
    (await json(`/v1/documents/${state.successorDocumentId}`))
      .supersedesDocumentId,
    state.importedDocumentId,
  );
  const content = await request(
    `/v1/documents/${state.importedDocumentId}/content`,
  );
  assert.equal(
    Buffer.from(await content.arrayBuffer()).toString("base64"),
    state.content,
  );
  console.log("Cimmich Document V1 restart/readback acceptance: PASS");
} else {
  throw new Error(`Unknown CIMMICH_DOCUMENT_PHASE ${phase}`);
}
