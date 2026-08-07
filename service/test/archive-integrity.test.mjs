import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveBackupProofSchemaVersion,
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

test("source evidence explains verified content and accepted Cimmich associations", async () => {
  const statements = [];
  const sql = (strings, ..._values) => {
    statements.push(strings.join(" ? "));
    return Promise.resolve([
      {
        asset_id: "asset-content-one",
        body_assignments: "1",
        content_digest: "c".repeat(64),
        face_assignments: 2,
        head_assignments: "4",
        people: "3",
        presence_assignments: 1,
        source_asset_id: "dbe4efb0-9645-4c52-8cf6-70f6972a4fc7",
      },
    ]);
  };
  const result = await createArchiveIntegrityStore(sql, {
    presentationRank: () => 1,
  }).archiveIntegritySourceEvidence({
    sourceAssetIds:
      "dbe4efb0-9645-4c52-8cf6-70f6972a4fc7,dbe4efb0-9645-4c52-8cf6-70f6972a4fc7",
  });

  assert.deepEqual(result, {
    items: [
      {
        assetId: "asset-content-one",
        bodyAssignments: 1,
        contentDigest: "c".repeat(64),
        faceAssignments: 2,
        headAssignments: 4,
        people: 3,
        presenceAssignments: 1,
        sourceAssetId: "dbe4efb0-9645-4c52-8cf6-70f6972a4fc7",
      },
    ],
    schemaVersion: archiveIntegritySchemaVersion,
  });
  assert.match(statements[0], /verification = 'byte_verified'/);
  assert.match(statements[0], /association\.authority_state = 'accepted'/);
  assert.match(statements[0], /cimmich_visibility_asset_rank/);
  assert.doesNotMatch(statements[0], /\b(?:DELETE|INSERT|UPDATE)\b/);
});

test("source evidence rejects missing, malformed and oversized asset sets", async () => {
  const store = createArchiveIntegrityStore(() => Promise.resolve([]), {
    presentationRank: () => 0,
  });
  await assert.rejects(
    store.archiveIntegritySourceEvidence({ sourceAssetIds: "" }),
    { code: "ARCHIVE_INTEGRITY_SOURCE_ASSET_IDS_INVALID", statusCode: 400 },
  );
  await assert.rejects(
    store.archiveIntegritySourceEvidence({ sourceAssetIds: "not-a-uuid" }),
    { code: "ARCHIVE_INTEGRITY_SOURCE_ASSET_IDS_INVALID", statusCode: 400 },
  );
  await assert.rejects(
    store.archiveIntegritySourceEvidence({
      sourceAssetIds: Array.from(
        { length: 101 },
        (_, index) =>
          `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      ),
    }),
    { code: "ARCHIVE_INTEGRITY_SOURCE_ASSET_IDS_INVALID", statusCode: 400 },
  );
});

test("backup proof refuses to treat source-system copies as independent storage", async () => {
  const statements = [];
  const sourceAssetId = "dbe4efb0-9645-4c52-8cf6-70f6972a4fc7";
  const sql = (strings, ..._values) => {
    const statement = strings.join(" ? ");
    statements.push(statement);
    if (statement.includes("SELECT binding.content_id")) {
      return { kind: "visible-copies" };
    }
    if (statement.includes("AS byte_verified_items")) {
      return Promise.resolve([
        {
          byte_verified_bytes: "647067285586",
          byte_verified_items: "119860",
          maximum_source_systems_per_item: 1,
          multiple_source_system_items: 0,
          source_system_count: 1,
        },
      ]);
    }
    if (statement.includes("WITH requested(source_asset_id, position)")) {
      return Promise.resolve([
        {
          byte_length: "4096",
          content_digest: "d".repeat(64),
          source_asset_id: sourceAssetId,
          source_system_count: 1,
        },
      ]);
    }
    throw new Error(`Unexpected SQL: ${statement.slice(0, 120)}`);
  };

  const result = await createArchiveIntegrityStore(sql, {
    presentationRank: () => 2,
  }).archiveIntegrityBackupProof({ sourceAssetIds: sourceAssetId });

  assert.equal(result.schemaVersion, archiveBackupProofSchemaVersion);
  assert.deepEqual(result.summary, {
    byteVerifiedBytes: 647067285586,
    byteVerifiedItems: 119860,
    independentDestinationCount: 0,
    independentlyProtectedItems: 0,
    maximumSourceSystemsPerItem: 1,
    multipleSourceSystemItems: 0,
    proofState: "storage_domain_evidence_required",
    sourceSystemCount: 1,
    unprovenItems: 119860,
  });
  assert.deepEqual(result.items, [
    {
      byteLength: 4096,
      contentDigest: "d".repeat(64),
      independentDestinationCount: 0,
      proofState: "storage_domain_evidence_required",
      sourceAssetId,
      sourceSystemCount: 1,
    },
  ]);
  assert.ok(
    statements.every(
      (statement) => !/\b(DELETE|UPDATE|INSERT)\b/.test(statement),
    ),
  );
});

test("backup proof allows a summary-only readiness read", async () => {
  let requestedQueryRan = false;
  const sql = (strings, ..._values) => {
    const statement = strings.join(" ? ");
    if (statement.includes("SELECT binding.content_id")) {
      return { kind: "visible-copies" };
    }
    if (statement.includes("AS byte_verified_items")) {
      return Promise.resolve([{}]);
    }
    requestedQueryRan = true;
    return Promise.resolve([]);
  };
  const result = await createArchiveIntegrityStore(sql, {
    presentationRank: () => 0,
  }).archiveIntegrityBackupProof();

  assert.equal(requestedQueryRan, false);
  assert.deepEqual(result.items, []);
  assert.equal(result.summary.unprovenItems, 0);
});
