import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveIntegritySchemaVersion,
  createArchiveIntegrityStore,
} from "../src/archive-integrity.mjs";

const sqlFixture = ({ rows, summary }) => {
  const statements = [];
  const sql = (strings, ..._values) => {
    const statement = strings.join(" ? ");
    statements.push(statement);
    if (statement.includes("SELECT binding.content_id")) {
      return { kind: "visible-copies" };
    }
    if (statement.includes("SELECT count(*)::int AS duplicate_groups")) {
      return Promise.resolve([summary]);
    }
    if (statement.includes("SELECT group_row.content_id")) {
      return Promise.resolve(rows);
    }
    throw new Error(`Unexpected SQL: ${statement.slice(0, 120)}`);
  };
  return { sql, statements };
};

test("exact duplicate review projects bounded byte-verified copy groups", async () => {
  const { sql, statements } = sqlFixture({
    rows: [
      {
        asset_id: "asset-one",
        asset_type: "image",
        byte_length: "4096",
        capture_time: new Date("2024-02-03T04:05:06.000Z"),
        content_digest: "a".repeat(64),
        content_id: "media_content_one",
        copy_count: 2,
        filename: "first.jpg",
        height: 720,
        is_archived: false,
        is_favorite: true,
        original_mime_type: "image/jpeg",
        reclaimable_bytes: "4096",
        source_asset_id: "source-one",
        visibility: "timeline",
        width: 1280,
      },
      {
        asset_id: "asset-one",
        asset_type: "image",
        byte_length: "4096",
        capture_time: new Date("2024-02-03T04:05:06.000Z"),
        content_digest: "a".repeat(64),
        content_id: "media_content_one",
        copy_count: 2,
        filename: "second.jpg",
        height: 720,
        is_archived: true,
        is_favorite: false,
        original_mime_type: "image/jpeg",
        reclaimable_bytes: "4096",
        source_asset_id: "source-two",
        visibility: "archive",
        width: 1280,
      },
    ],
    summary: {
      copies_in_groups: "2",
      duplicate_groups: 1,
      reclaimable_bytes: "4096",
      redundant_copies: "1",
    },
  });
  const store = createArchiveIntegrityStore(sql, {
    presentationRank: () => 2,
  });

  const result = await store.exactDuplicates({ limit: 500, offset: -1 });

  assert.equal(result.schemaVersion, archiveIntegritySchemaVersion);
  assert.equal(result.limit, 100);
  assert.equal(result.offset, 0);
  assert.equal(result.nextOffset, null);
  assert.deepEqual(result.summary, {
    copiesInGroups: 2,
    duplicateGroups: 1,
    reclaimableBytes: 4096,
    redundantCopies: 1,
  });
  assert.equal(result.groups[0].copies.length, 2);
  assert.equal(
    result.groups[0].copies[0].captureTime,
    "2024-02-03T04:05:06.000Z",
  );
  assert.equal(result.groups[0].copies[1].archived, true);
  assert.ok(
    statements.some((statement) =>
      statement.includes("fingerprint.verification = 'byte_verified'"),
    ),
  );
  assert.ok(
    statements.some((statement) =>
      statement.includes("cimmich_visibility_asset_rank"),
    ),
  );
  assert.ok(
    statements.every(
      (statement) => !/\b(DELETE|UPDATE|INSERT)\b/.test(statement),
    ),
  );
});

test("exact duplicate review reports the next stable group offset", async () => {
  const { sql } = sqlFixture({
    rows: [
      {
        asset_id: "asset-one",
        asset_type: "video",
        byte_length: 10,
        capture_time: null,
        content_digest: "b".repeat(64),
        content_id: "media_content_one",
        copy_count: 2,
        filename: null,
        height: null,
        is_archived: false,
        is_favorite: false,
        original_mime_type: null,
        reclaimable_bytes: 10,
        source_asset_id: "source-one",
        visibility: "timeline",
        width: null,
      },
      {
        asset_id: "asset-one",
        asset_type: "video",
        byte_length: 10,
        capture_time: null,
        content_digest: "b".repeat(64),
        content_id: "media_content_one",
        copy_count: 2,
        filename: null,
        height: null,
        is_archived: false,
        is_favorite: false,
        original_mime_type: null,
        reclaimable_bytes: 10,
        source_asset_id: "source-two",
        visibility: "timeline",
        width: null,
      },
    ],
    summary: {
      copies_in_groups: 8,
      duplicate_groups: 4,
      reclaimable_bytes: 40,
      redundant_copies: 4,
    },
  });
  const result = await createArchiveIntegrityStore(sql, {
    presentationRank: () => 0,
  }).exactDuplicates({ limit: 1, offset: 1 });

  assert.equal(result.nextOffset, 2);
  assert.equal(result.groups[0].copies[0].filename, "Untitled media");
  assert.equal(result.groups[0].copies[0].width, null);
});
