import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveMissingFilesSchemaVersion,
  createArchiveMissingFileStore,
} from "../src/archive-missing-files.mjs";

const sourceAssetId = "dbe4efb0-9645-4c52-8cf6-70f6972a4fc7";

test("inactive-library review separates Immich trash from deleted rows", async () => {
  const statements = [];
  const sql = (strings, ..._values) => {
    const statement = strings.join(" ? ");
    statements.push(statement);
    if (statement.includes("AS trashed")) {
      return Promise.resolve([{ missing: "1", trashed: "1" }]);
    }
    if (statement.includes("projection.original_file_name")) {
      return Promise.resolve([
        {
          asset_type: "image",
          assignments: "2",
          capture_time: new Date("2024-01-01T00:00:00.000Z"),
          cimmich_asset_id: "asset-one",
          immich_asset_id: sourceAssetId,
          last_seen_at: new Date("2026-08-19T00:00:00.000Z"),
          last_seen_run_id: "inventory-run-one",
          original_file_name: "removed.jpg",
          people: "1",
          is_trashed: true,
          source_id: "immich-primary",
          state: "missing",
        },
      ]);
    }
    throw new Error(`Unexpected SQL: ${statement.slice(0, 120)}`);
  };

  const result = await createArchiveMissingFileStore(
    sql,
  ).archiveIntegrityMissingFiles({ limit: 500, offset: -1 });

  assert.equal(result.schemaVersion, archiveMissingFilesSchemaVersion);
  assert.equal(result.limit, 100);
  assert.equal(result.offset, 0);
  assert.deepEqual(result.summary, {
    missing: 1,
    total: 2,
    trashed: 1,
  });
  assert.deepEqual(result.items[0], {
    assetId: "asset-one",
    assetType: "image",
    assignments: 2,
    captureTime: "2024-01-01T00:00:00.000Z",
    filename: "removed.jpg",
    lastSeenAt: "2026-08-19T00:00:00.000Z",
    lastSeenRunId: "inventory-run-one",
    people: 1,
    sourceAssetId,
    sourceId: "immich-primary",
    state: "trashed",
  });
  assert.ok(statements.every((statement) => !statement.includes("is_offline")));
  assert.ok(
    statements.every((statement) =>
      statement.includes("inventory_source.state = 'active'"),
    ),
  );
  assert.ok(
    statements.some(
      (statement) =>
        statement.includes("projection.state = 'missing'") &&
        statement.includes("binding.state = 'missing'"),
    ),
  );
  const pageStatement = statements.find((statement) =>
    statement.includes("WITH candidates AS MATERIALIZED"),
  );
  assert.ok(pageStatement);
  assert.ok(
    pageStatement.indexOf("LIMIT") <
      pageStatement.indexOf("accepted_associations AS MATERIALIZED"),
  );
  assert.doesNotMatch(pageStatement, /person_assets|LEFT JOIN LATERAL/);
  assert.match(pageStatement, /JOIN face_observation face/);
  assert.match(pageStatement, /JOIN body_observation body/);
  assert.match(pageStatement, /JOIN presence_tag presence/);
  assert.match(pageStatement, /JOIN manual_head_observation head/);
});

test("bulk trash removal is count locked and limited to the active Immich source", async () => {
  const secondSourceAssetId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const statements = [];
  const transaction = (strings, ..._values) => {
    const statement = strings.join(" ? ");
    statements.push(statement);
    if (statement.includes("SELECT request_digest, response")) {
      return Promise.resolve([]);
    }
    if (
      statement.includes("SELECT projection.source_id") &&
      statement.includes("projection.is_trashed = true")
    ) {
      return Promise.resolve([
        {
          binding_id: "source_binding_one",
          cimmich_asset_id: "asset-one",
          immich_asset_id: sourceAssetId,
          source_id: "cedar-house-archive",
        },
        {
          binding_id: "source_binding_two",
          cimmich_asset_id: "asset-two",
          immich_asset_id: secondSourceAssetId,
          source_id: "cedar-house-archive",
        },
      ]);
    }
    return Promise.resolve([]);
  };
  transaction.json = (value) => value;
  const sql = Object.assign(transaction, {
    begin: (callback) => callback(transaction),
  });

  const result = await createArchiveMissingFileStore(
    sql,
  ).archiveIntegrityRemoveMissingFiles({
    actorId: "owner",
    commandId: "archive-trash-all-command-1",
    expectedCount: 2,
    selection: "trashed",
    sourceId: "cedar-house-archive",
  });

  assert.deepEqual(result.removedSourceAssetIds, [
    sourceAssetId,
    secondSourceAssetId,
  ]);
  assert.ok(
    statements.some(
      (statement) =>
        statement.includes("inventory_source.state = 'active'") &&
        statement.includes("projection.is_trashed = true"),
    ),
  );
});

test("bulk trash removal stops when the live count changed", async () => {
  const transaction = (strings, ..._values) => {
    const statement = strings.join(" ? ");
    if (statement.includes("SELECT request_digest, response")) {
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  };
  transaction.json = (value) => value;
  const sql = Object.assign(transaction, {
    begin: (callback) => callback(transaction),
  });

  await assert.rejects(
    createArchiveMissingFileStore(sql).archiveIntegrityRemoveMissingFiles({
      actorId: "owner",
      commandId: "archive-trash-all-command-2",
      expectedCount: 12,
      selection: "trashed",
      sourceId: "cedar-house-archive",
    }),
    {
      code: "ARCHIVE_MISSING_FILE_NOT_CONFIRMED",
      statusCode: 409,
    },
  );
});

test("inactive-library removal supersedes only selected source bindings and is replay safe", async () => {
  const statements = [];
  const transaction = (strings, ..._values) => {
    const statement = strings.join(" ? ");
    statements.push(statement);
    if (statement.includes("SELECT request_digest, response")) {
      return Promise.resolve([]);
    }
    if (statement.includes("SELECT projection.source_id")) {
      return Promise.resolve([
        {
          binding_id: "source_binding_one",
          cimmich_asset_id: "asset-one",
          immich_asset_id: sourceAssetId,
          last_seen_run_id: "inventory-run-two",
          source_id: "immich-primary",
        },
      ]);
    }
    if (statement.includes("UPDATE asset SET state = 'tombstoned'")) {
      return Promise.resolve([{ asset_id: "asset-one" }]);
    }
    return Promise.resolve([]);
  };
  transaction.json = (value) => value;
  const sql = Object.assign(transaction, {
    begin: (callback) => callback(transaction),
  });

  const result = await createArchiveMissingFileStore(
    sql,
  ).archiveIntegrityRemoveMissingFiles({
    actorId: "owner",
    commandId: "archive-missing-command-1",
    sourceId: "immich-primary",
    sourceAssetIds: [sourceAssetId],
  });

  assert.deepEqual(result, {
    removedSourceAssetIds: [sourceAssetId],
    replayed: false,
    schemaVersion: archiveMissingFilesSchemaVersion,
    sourceId: "immich-primary",
    tombstonedAssets: 1,
  });
  assert.ok(
    statements.some((statement) =>
      statement.includes("SET state = 'superseded'"),
    ),
  );
  assert.ok(
    statements.some((statement) =>
      statement.includes("remaining.state IN ('active','offline','missing')"),
    ),
  );
  assert.ok(
    statements.some((statement) =>
      statement.includes("projection.state = 'missing'"),
    ),
  );
});

test("source unavailability without inactive-library evidence cannot be removed", async () => {
  const transaction = (strings, ..._values) => {
    const statement = strings.join(" ? ");
    if (statement.includes("SELECT request_digest, response")) {
      return Promise.resolve([]);
    }
    if (statement.includes("SELECT projection.source_id")) {
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  };
  transaction.json = (value) => value;
  const sql = Object.assign(transaction, {
    begin: (callback) => callback(transaction),
  });

  await assert.rejects(
    createArchiveMissingFileStore(sql).archiveIntegrityRemoveMissingFiles({
      actorId: "owner",
      commandId: "archive-missing-command-2",
      sourceId: "immich-primary",
      sourceAssetIds: [sourceAssetId],
    }),
    {
      code: "ARCHIVE_MISSING_FILE_NOT_CONFIRMED",
      statusCode: 409,
    },
  );
});
