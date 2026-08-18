import assert from "node:assert/strict";

const root = process.env.CIMMICH_ACCEPTANCE_URL || "http://127.0.0.1:3101";
const headers = {
  "content-type": "application/json",
  "x-cimmich-actor": "asset-organisation-acceptance",
};

const requestJson = async (path, { body, method = "GET" } = {}) => {
  const response = await fetch(`${root}${path}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers,
    method,
  });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  return payload;
};

const created = await requestJson("/v1/asset-labels", {
  body: {
    commandId: "acceptance.asset-label.create.0001",
    displayName: "Restricted",
  },
  method: "POST",
});
assert.equal(created.changed, true);
assert.equal(created.label.displayName, "Restricted");

const attached = await requestJson(
  `/v1/asset-labels/${created.label.labelId}/assets:attach`,
  {
    body: {
      assetIds: ["asset_service_fixture", "asset_identity_fixture"],
      commandId: "acceptance.asset-label.attach.0001",
    },
    method: "POST",
  },
);
assert.deepEqual(attached.changedAssetIds, [
  "asset_identity_fixture",
  "asset_service_fixture",
]);
const attachReplay = await requestJson(
  `/v1/asset-labels/${created.label.labelId}/assets:attach`,
  {
    body: {
      assetIds: ["asset_service_fixture", "asset_identity_fixture"],
      commandId: "acceptance.asset-label.attach.0001",
    },
    method: "POST",
  },
);
assert.deepEqual(attachReplay, attached);

const labelsAfterAttach = await requestJson("/v1/asset-labels?q=Restricted");
assert.equal(labelsAfterAttach.items.length, 1);
assert.equal(labelsAfterAttach.items[0].assetCount, 2);

const undoneLabel = await requestJson(
  `/v1/asset-label-decisions/${attached.decisionId}/undo`,
  {
    body: { commandId: "acceptance.asset-label.undo.0001" },
    method: "POST",
  },
);
assert.deepEqual(undoneLabel.changedAssetIds, [
  "asset_identity_fixture",
  "asset_service_fixture",
]);
const labelsAfterUndo = await requestJson("/v1/asset-labels?q=Restricted");
assert.equal(labelsAfterUndo.items[0].assetCount, 0);

const collection = await requestJson("/v1/asset-labels", {
  body: {
    commandId: "acceptance.asset-label.collection.create.0001",
    displayName: "PP Aug 2011",
    kind: "collection",
  },
  method: "POST",
});
assert.equal(collection.label.kind, "collection");
const collectionMembership = await requestJson(
  `/v1/asset-labels/${collection.label.labelId}/assets:attach`,
  {
    body: {
      assetIds: ["asset_service_fixture", "asset_identity_fixture"],
      commandId: "acceptance.asset-label.collection.attach.0001",
    },
    method: "POST",
  },
);

const operationBody = {
  manifest: [
    {
      assetCount: 2,
      sourcePath: "/library/2011_August - PP",
      title: "PP Aug 2011",
    },
  ],
  operationId: "acceptance.bulk-album.0001",
  snapshotDigest: "a".repeat(64),
  sourcePath: "/library",
};
const operation = await requestJson("/v1/bulk-album-operations", {
  body: operationBody,
  method: "POST",
});
assert.equal(operation.state, "applying");
assert.equal(operation.assetCount, 2);
const operationReplay = await requestJson("/v1/bulk-album-operations", {
  body: operationBody,
  method: "POST",
});
assert.equal(operationReplay.operationId, operation.operationId);

const membershipCheckpoint = await requestJson(
  `/v1/bulk-album-operations/${operation.operationId}/checkpoints`,
  {
    body: {
      albumCreated: false,
      albumId: collection.label.labelId,
      albumName: "PP Aug 2011",
      assetIds: ["immich-service-fixture", "immich-identity-fixture"],
      batchSequence: 0,
      commandId: "acceptance.bulk-album.checkpoint.0001",
      organizationDecisionId: collectionMembership.decisionId,
      sourcePath: "/library/2011_August - PP",
    },
    method: "POST",
  },
);
const checkpointReplay = await requestJson(
  `/v1/bulk-album-operations/${operation.operationId}/checkpoints`,
  {
    body: {
      albumCreated: false,
      albumId: collection.label.labelId,
      albumName: "PP Aug 2011",
      assetIds: ["immich-service-fixture", "immich-identity-fixture"],
      batchSequence: 0,
      commandId: "acceptance.bulk-album.checkpoint.0001",
      organizationDecisionId: collectionMembership.decisionId,
      sourcePath: "/library/2011_August - PP",
    },
    method: "POST",
  },
);
assert.deepEqual(checkpointReplay, membershipCheckpoint);

await requestJson(`/v1/bulk-album-operations/${operation.operationId}`, {
  body: {
    commandId: "acceptance.bulk-album.state.applied.0001",
    state: "applied",
  },
  method: "PATCH",
});
const active = await requestJson("/v1/bulk-album-operations/active");
assert.equal(active.operationId, operation.operationId);
assert.equal(active.checkpoints.length, 1);
assert.equal(
  active.checkpoints[0].organizationDecisionId,
  collectionMembership.decisionId,
);

await requestJson(`/v1/bulk-album-operations/${operation.operationId}`, {
  body: {
    commandId: "acceptance.bulk-album.state.undoing.0001",
    state: "undoing",
  },
  method: "PATCH",
});
for (const [sequence, checkpoint] of [membershipCheckpoint].entries()) {
  const undone = await requestJson(
    `/v1/bulk-album-operations/checkpoints/${checkpoint.checkpointId}/undo`,
    {
      body: {
        commandId: `acceptance.bulk-album.checkpoint.undo.000${sequence + 1}`,
      },
      method: "POST",
    },
  );
  assert.equal(undone.state, "undone");
}
await requestJson(`/v1/bulk-album-operations/${operation.operationId}`, {
  body: {
    commandId: "acceptance.bulk-album.state.undone.0001",
    state: "undone",
  },
  method: "PATCH",
});
const noActiveOperation = await requestJson("/v1/bulk-album-operations/active");
assert.equal(noActiveOperation.operation, null);

process.stdout.write(
  `${JSON.stringify({
    collectionCheckpoints: 1,
    labelAssetsAttached: attached.changedAssetIds.length,
    labelAssetsUndone: undoneLabel.changedAssetIds.length,
    status: "PASS",
  })}\n`,
);
