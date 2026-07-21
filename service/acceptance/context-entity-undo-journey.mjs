import assert from "node:assert/strict";
import postgres from "postgres";
import { currentSchemaVersion } from "./current-schema.mjs";

const root = process.env.CIMMICH_ACCEPTANCE_ROOT || "http://127.0.0.1:3101";
const sql = postgres(process.env.DATABASE_URL, { max: 2, prepare: true });
const headers = {
  "content-type": "application/json",
  "x-cimmich-actor": "synthetic-context-undo-owner",
  "x-cimmich-device-id": "synthetic-context-undo-device",
  "x-cimmich-principal-id": "local-primary",
  "x-cimmich-surface": "interactive",
};
const request = async (path, { body, method = "GET", status = 200 } = {}) => {
  const response = await fetch(`${root}${path}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers,
    method,
  });
  const payload = await response.json();
  assert.equal(response.status, status, JSON.stringify(payload));
  return payload;
};
const fixtures = [
  { family: "places", kind: "unlocated", label: "Place" },
  { family: "objects", kind: "other", label: "Thing" },
  { family: "events", kind: "event", label: "Event" },
];

try {
  assert.equal(
    (await request("/health")).schemaVersion,
    await currentSchemaVersion(),
  );
  for (const [index, fixture] of fixtures.entries()) {
    const stem = `context73.${fixture.family}.${index}`;
    const created = await request(`/v1/${fixture.family}`, {
      body: {
        aliases: [`${fixture.label} alias`],
        commandId: `${stem}.create`,
        displayName: `Schema 73 ${fixture.label}`,
        typeKind: fixture.kind,
      },
      method: "POST",
      status: 201,
    });
    assert.equal(created.changed, true);
    assert.equal(created.status, "applied");
    assert.deepEqual(created.undo, {
      eligible: true,
      token: created.decisionId,
    });
    const entity = created.detail.entity;
    assert.equal(entity.revision, 1);

    const [before] = await sql`
      SELECT
        (SELECT count(*)::int FROM decision WHERE subject_id = ${entity.entityId}) AS decisions,
        (SELECT count(*)::int FROM context_operation WHERE entity_id = ${entity.entityId}) AS operations
    `;
    const noChangeBody = {
      aliases: [`${fixture.label} alias`],
      commandId: `${stem}.nochange`,
      displayName: entity.displayName,
      expectedRevision: 1,
      typeKind: fixture.kind,
    };
    const unchanged = await request(
      `/v1/${fixture.family}/${entity.entityId}`,
      {
        body: noChangeBody,
        method: "PATCH",
      },
    );
    assert.equal(unchanged.changed, false);
    assert.equal(unchanged.decisionId, null);
    assert.equal(unchanged.detail.entity.revision, 1);
    assert.equal(unchanged.status, "no_change");
    assert.deepEqual(unchanged.undo, { eligible: false, token: null });
    const [after] = await sql`
      SELECT
        (SELECT count(*)::int FROM decision WHERE subject_id = ${entity.entityId}) AS decisions,
        (SELECT count(*)::int FROM context_operation WHERE entity_id = ${entity.entityId}) AS operations
    `;
    assert.deepEqual(after, before);
    const noChangeReplay = await request(
      `/v1/${fixture.family}/${entity.entityId}`,
      { body: noChangeBody, method: "PATCH" },
    );
    assert.equal(noChangeReplay.replayed, true);
    assert.equal(noChangeReplay.decisionId, null);
    const conflict = await request(`/v1/${fixture.family}/${entity.entityId}`, {
      body: {
        commandId: `${stem}.nochange`,
        description: "Conflicting payload",
        expectedRevision: 1,
      },
      method: "PATCH",
      status: 409,
    });
    assert.equal(conflict.code, "CONTEXT_COMMAND_CONFLICT");

    const updateBody = {
      aliases: [`${fixture.label} changed alias`],
      commandId: `${stem}.update`,
      description: `Changed ${fixture.label}`,
      displayName: `Changed Schema 73 ${fixture.label}`,
      expectedRevision: 1,
    };
    const updated = await request(`/v1/${fixture.family}/${entity.entityId}`, {
      body: updateBody,
      method: "PATCH",
    });
    assert.equal(updated.changed, true);
    assert.equal(updated.detail.entity.revision, 2);
    assert.equal(updated.undo.eligible, true);
    assert.equal(
      (
        await request(`/v1/${fixture.family}/${entity.entityId}`, {
          body: updateBody,
          method: "PATCH",
        })
      ).replayed,
      true,
    );
    const stale = await request(`/v1/${fixture.family}/${entity.entityId}`, {
      body: {
        commandId: `${stem}.stale`,
        description: "Stale edit",
        expectedRevision: 1,
      },
      method: "PATCH",
      status: 409,
    });
    assert.equal(stale.code, "CONTEXT_UPDATE_STALE");
    const reverted = await request(
      `/v1/context/decisions/${updated.decisionId}/undo`,
      { body: { commandId: `${stem}.undo-update` }, method: "POST" },
    );
    assert.equal(reverted.status, "reverted");
    assert.equal(reverted.detail.entity.displayName, entity.displayName);
    assert.equal(reverted.detail.entity.description, null);
    assert.deepEqual(reverted.detail.entity.aliases, [
      `${fixture.label} alias`,
    ]);
    assert.equal(reverted.detail.entity.revision, 3);
    const undoReplay = await request(
      `/v1/context/decisions/${updated.decisionId}/undo`,
      { body: { commandId: `${stem}.undo-update` }, method: "POST" },
    );
    assert.equal(undoReplay.replayed, true);
    assert.equal(undoReplay.decisionId, reverted.decisionId);
  }

  for (const [index, fixture] of fixtures.entries()) {
    const stem = `context73.createundo.${fixture.family}.${index}`;
    const created = await request(`/v1/${fixture.family}`, {
      body: {
        commandId: `${stem}.create`,
        displayName: `Disposable ${fixture.label}`,
        typeKind: fixture.kind,
      },
      method: "POST",
      status: 201,
    });
    const reverted = await request(
      `/v1/context/decisions/${created.decisionId}/undo`,
      { body: { commandId: `${stem}.undo` }, method: "POST" },
    );
    assert.equal(reverted.status, "reverted");
    assert.equal(reverted.detail, null);
    assert.equal(reverted.projectionUnavailable, true);
    assert.equal(
      (
        await request(
          `/v1/${fixture.family}/${created.detail.entity.entityId}`,
          { status: 404 },
        )
      ).code,
      "CONTEXT_NOT_FOUND",
    );
    const replay = await request(
      `/v1/context/decisions/${created.decisionId}/undo`,
      { body: { commandId: `${stem}.undo` }, method: "POST" },
    );
    assert.equal(replay.replayed, true);
    assert.equal(replay.decisionId, reverted.decisionId);
  }

  const staleCreated = await request("/v1/events", {
    body: {
      commandId: "context73.superseded.create",
      displayName: "Superseded Event",
      typeKind: "event",
    },
    method: "POST",
    status: 201,
  });
  const staleId = staleCreated.detail.entity.entityId;
  const firstUpdate = await request(`/v1/events/${staleId}`, {
    body: {
      commandId: "context73.superseded.first",
      description: "First successor",
      expectedRevision: 1,
    },
    method: "PATCH",
  });
  await request(`/v1/events/${staleId}`, {
    body: {
      commandId: "context73.superseded.second",
      description: "Second successor",
      expectedRevision: 2,
    },
    method: "PATCH",
  });
  assert.equal(
    (
      await request(`/v1/context/decisions/${firstUpdate.decisionId}/undo`, {
        body: { commandId: "context73.superseded.undo" },
        method: "POST",
        status: 409,
      })
    ).code,
    "CONTEXT_UNDO_SUPERSEDED",
  );
  assert.equal(
    (
      await request(`/v1/context/decisions/${staleCreated.decisionId}/undo`, {
        body: { commandId: "context73.superseded.create.undo" },
        method: "POST",
        status: 409,
      })
    ).code,
    "CONTEXT_UNDO_SUPERSEDED",
  );

  const dependencyCases = [
    {
      attachBody: {
        commandId: "context73.reverted.event.attach",
        relations: [
          {
            direction: "outgoing",
            relationKind: "participant",
            targetId: "person_service_fixture",
            targetKind: "person",
          },
        ],
      },
      attachPath: (entityId) => `/v1/events/${entityId}/relations:attach`,
      family: "events",
      kind: "event",
      label: "Event",
    },
    {
      attachBody: {
        assets: [
          { assetId: "asset_identity_fixture", associationKind: "manual" },
        ],
        commandId: "context73.reverted.object.attach",
      },
      attachPath: (entityId) => `/v1/objects/${entityId}/assets:attach`,
      family: "objects",
      kind: "other",
      label: "Thing",
    },
  ];
  for (const dependencyCase of dependencyCases) {
    const key = dependencyCase.family.slice(0, -1);
    const blockedCommandId = `context73.reverted.${key}.blocked`;
    const created = await request(`/v1/${dependencyCase.family}`, {
      body: {
        commandId: `context73.reverted.${key}.create`,
        displayName: `Reverted dependency ${dependencyCase.label}`,
        typeKind: dependencyCase.kind,
      },
      method: "POST",
      status: 201,
    });
    const entityId = created.detail.entity.entityId;
    const attached = await request(dependencyCase.attachPath(entityId), {
      body: dependencyCase.attachBody,
      method: "POST",
    });
    assert.equal(attached.detail.entity.revision, 2);
    const [beforeBlocked] = await sql`
      SELECT
        (SELECT count(*)::int FROM context_command
          WHERE command_id = ${blockedCommandId}) AS blocked_commands,
        (SELECT count(*)::int FROM decision
          WHERE subject_id = ${entityId}) AS decisions,
        (SELECT count(*)::int FROM context_operation
          WHERE entity_id = ${entityId} AND state = 'active') AS active_operations
    `;
    assert.equal(
      (
        await request(`/v1/context/decisions/${created.decisionId}/undo`, {
          body: { commandId: blockedCommandId },
          method: "POST",
          status: 409,
        })
      ).code,
      "CONTEXT_UNDO_DEPENDENCY",
    );
    const [afterBlocked] = await sql`
      SELECT
        (SELECT count(*)::int FROM context_command
          WHERE command_id = ${blockedCommandId}) AS blocked_commands,
        (SELECT count(*)::int FROM decision
          WHERE subject_id = ${entityId}) AS decisions,
        (SELECT count(*)::int FROM context_operation
          WHERE entity_id = ${entityId} AND state = 'active') AS active_operations
    `;
    assert.deepEqual(afterBlocked, beforeBlocked);
    assert.equal(afterBlocked.blocked_commands, 0);

    const dependencyUndo = await request(
      `/v1/context/decisions/${attached.decisionId}/undo`,
      {
        body: { commandId: `context73.reverted.${key}.dependency.undo` },
        method: "POST",
      },
    );
    assert.equal(dependencyUndo.detail.entity.revision, 3);
    const createUndo = await request(
      `/v1/context/decisions/${created.decisionId}/undo`,
      {
        body: { commandId: `context73.reverted.${key}.create.undo` },
        method: "POST",
      },
    );
    assert.equal(createUndo.status, "reverted");
    assert.equal(createUndo.detail, null);
    assert.equal(createUndo.projectionUnavailable, true);
    const createUndoReplay = await request(
      `/v1/context/decisions/${created.decisionId}/undo`,
      {
        body: { commandId: `context73.reverted.${key}.create.undo` },
        method: "POST",
      },
    );
    assert.equal(createUndoReplay.replayed, true);
    assert.equal(createUndoReplay.decisionId, createUndo.decisionId);
  }

  const parent = await request("/v1/places", {
    body: {
      commandId: "context73.dependency.parent",
      displayName: "Dependency Parent",
      typeKind: "unlocated",
    },
    method: "POST",
    status: 201,
  });
  const child = await request("/v1/places", {
    body: {
      commandId: "context73.dependency.child",
      displayName: "Dependency Child",
      parentEntityId: parent.detail.entity.entityId,
      typeKind: "unlocated",
    },
    method: "POST",
    status: 201,
  });
  assert.equal(
    (
      await request(`/v1/context/decisions/${parent.decisionId}/undo`, {
        body: { commandId: "context73.dependency.blocked" },
        method: "POST",
        status: 409,
      })
    ).code,
    "CONTEXT_UNDO_DEPENDENCY",
  );
  await request(`/v1/context/decisions/${child.decisionId}/undo`, {
    body: { commandId: "context73.dependency.child.undo" },
    method: "POST",
  });
  assert.equal(
    (
      await request(`/v1/context/decisions/${parent.decisionId}/undo`, {
        body: { commandId: "context73.dependency.parent.undo" },
        method: "POST",
      })
    ).status,
    "reverted",
  );

  process.stdout.write(
    `${JSON.stringify({
      createUndoFamilies: 3,
      dependencyCleanupFamilies: dependencyCases.length,
      noChangeFamilies: 3,
      schemaVersion: "cimmich.context-entity.v1",
      updateUndoFamilies: 3,
      visibilityBeforeProjection: true,
    })}\n`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
