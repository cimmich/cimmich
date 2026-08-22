import { createHash } from "node:crypto";

export const archiveMissingFilesSchemaVersion =
  "cimmich.archive-missing-files.v2";

const sourceAssetIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const typedError = (message, code, statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });

const cleanText = (value, label, maximum = 120) => {
  const clean = String(value || "").trim();
  if (!clean || clean.length > maximum) {
    throw typedError(
      `${label} is invalid`,
      "ARCHIVE_MISSING_FILE_COMMAND_INVALID",
    );
  }
  return clean;
};

const cleanPageInteger = (value, fallback, maximum) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0
    ? Math.min(parsed, maximum)
    : fallback;
};

const cleanSourceAssetIds = (values) => {
  const result = [
    ...new Set(
      [values]
        .flat()
        .map(String)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  if (
    result.length < 1 ||
    result.length > 100 ||
    result.some((item) => !sourceAssetIdPattern.test(item))
  ) {
    throw typedError(
      "Missing Immich asset IDs are invalid",
      "ARCHIVE_MISSING_FILE_ASSET_IDS_INVALID",
    );
  }
  return result.sort();
};

const cleanExpectedCount = (value) => {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 1_000_000) {
    throw typedError(
      "Expected trash count is invalid",
      "ARCHIVE_MISSING_FILE_EXPECTED_COUNT_INVALID",
    );
  }
  return count;
};

const iso = (value) => (value ? new Date(value).toISOString() : null);
const number = (value) => Number(value || 0);
const requestDigest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const createArchiveMissingFileStore = (sql) => ({
  async archiveIntegrityMissingFiles({ limit, offset } = {}) {
    const pageSize = Math.max(1, cleanPageInteger(limit, 50, 100));
    const pageOffset = cleanPageInteger(offset, 0, 1_000_000);
    const [summary = {}] = await sql`
      SELECT
        count(*) FILTER (
          WHERE projection.is_trashed
        )::int AS trashed,
        count(*) FILTER (
          WHERE NOT projection.is_trashed
        )::int AS missing
      FROM immich_asset_projection projection
      JOIN immich_inventory_source inventory_source
        ON inventory_source.source_id = projection.source_id
        AND inventory_source.state = 'active'
      JOIN asset_source_binding binding
        ON binding.source_kind = 'immich'
        AND binding.source_id = projection.source_id
        AND binding.external_asset_id = projection.immich_asset_id
      WHERE projection.state = 'missing' AND binding.state = 'missing'
    `;
    const rows = await sql`
      WITH candidates AS MATERIALIZED (
        SELECT projection.source_id, projection.immich_asset_id,
          projection.cimmich_asset_id, projection.original_file_name,
          projection.asset_type, projection.capture_time,
          projection.last_seen_at, projection.last_seen_run_id,
          projection.state, projection.is_trashed,
          binding.state AS binding_state
        FROM immich_asset_projection projection
        JOIN immich_inventory_source inventory_source
          ON inventory_source.source_id = projection.source_id
          AND inventory_source.state = 'active'
        JOIN asset_source_binding binding
          ON binding.source_kind = 'immich'
          AND binding.source_id = projection.source_id
          AND binding.external_asset_id = projection.immich_asset_id
        WHERE projection.state = 'missing' AND binding.state = 'missing'
        ORDER BY projection.is_trashed DESC,
          projection.last_seen_at, projection.immich_asset_id
        LIMIT ${pageSize} OFFSET ${pageOffset}
      ), accepted_associations AS MATERIALIZED (
        SELECT face.asset_id, claim.person_id
        FROM candidates
        JOIN face_observation face
          ON face.asset_id = candidates.cimmich_asset_id
        JOIN identity_claim claim
          ON claim.face_id = face.face_id
          AND claim.state = 'accepted'
        UNION ALL
        SELECT body.asset_id, tag.person_id
        FROM candidates
        JOIN body_observation body
          ON body.asset_id = candidates.cimmich_asset_id
        JOIN body_tag tag
          ON tag.body_id = body.body_id
          AND tag.state = 'accepted'
        UNION ALL
        SELECT presence.asset_id, presence.person_id
        FROM candidates
        JOIN presence_tag presence
          ON presence.asset_id = candidates.cimmich_asset_id
          AND presence.state = 'accepted'
        UNION ALL
        SELECT head.asset_id, tag.subject_id AS person_id
        FROM candidates
        JOIN manual_head_observation head
          ON head.asset_id = candidates.cimmich_asset_id
          AND head.state = 'valid'
        JOIN manual_head_tag tag
          ON tag.head_id = head.head_id
          AND tag.state = 'accepted'
      ), evidence AS MATERIALIZED (
        SELECT association.asset_id,
          count(DISTINCT association.person_id)::int AS people,
          count(*)::int AS assignments
        FROM accepted_associations association
        GROUP BY association.asset_id
      )
      SELECT candidates.source_id, candidates.immich_asset_id,
        candidates.cimmich_asset_id, candidates.original_file_name,
        candidates.asset_type, candidates.capture_time,
        candidates.last_seen_at, candidates.last_seen_run_id,
        candidates.state, candidates.is_trashed, candidates.binding_state,
        asset.state AS asset_state,
        coalesce(evidence.people, 0)::int AS people,
        coalesce(evidence.assignments, 0)::int AS assignments
      FROM candidates
      JOIN asset ON asset.asset_id = candidates.cimmich_asset_id
      LEFT JOIN evidence
        ON evidence.asset_id = candidates.cimmich_asset_id
      ORDER BY candidates.is_trashed DESC,
        candidates.last_seen_at, candidates.immich_asset_id
    `;
    const trashed = number(summary.trashed);
    const missing = number(summary.missing);
    const total = trashed + missing;
    return {
      items: rows.map((row) => ({
        assetId: row.cimmich_asset_id,
        assetType: row.asset_type,
        assignments: number(row.assignments),
        captureTime: iso(row.capture_time),
        filename: row.original_file_name || "Untitled media",
        lastSeenAt: iso(row.last_seen_at),
        lastSeenRunId: row.last_seen_run_id,
        people: number(row.people),
        sourceAssetId: row.immich_asset_id,
        sourceId: row.source_id,
        state: row.is_trashed ? "trashed" : "missing",
      })),
      limit: pageSize,
      nextOffset:
        pageOffset + rows.length < total ? pageOffset + rows.length : null,
      offset: pageOffset,
      schemaVersion: archiveMissingFilesSchemaVersion,
      summary: { missing, total, trashed },
    };
  },

  async archiveIntegrityRemoveMissingFiles({
    actorId,
    commandId,
    expectedCount,
    selection,
    sourceId,
    sourceAssetIds,
  } = {}) {
    const actor = cleanText(actorId, "actorId");
    const command = cleanText(commandId, "commandId");
    const source = cleanText(sourceId, "sourceId");
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$/.test(command)) {
      throw typedError(
        "Missing-file commandId is invalid",
        "ARCHIVE_MISSING_FILE_COMMAND_INVALID",
      );
    }
    const removeAllTrashed = selection === "trashed";
    const expected = removeAllTrashed
      ? cleanExpectedCount(expectedCount)
      : undefined;
    const requestedAssetIds = removeAllTrashed
      ? []
      : cleanSourceAssetIds(sourceAssetIds);
    const digest = requestDigest({
      actor,
      expectedCount: expected,
      selection: removeAllTrashed ? "trashed" : "selected",
      source,
      sourceAssetIds: requestedAssetIds,
    });
    return sql.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`archive-missing-files:${command}`}, 0)
        )
      `;
      const [prior] = await transaction`
        SELECT request_digest, response
        FROM archive_missing_file_command
        WHERE command_id = ${command}
        FOR UPDATE
      `;
      if (prior) {
        if (prior.request_digest !== digest) {
          throw typedError(
            "Missing-file commandId was reused with different input",
            "ARCHIVE_MISSING_FILE_COMMAND_CONFLICT",
            409,
          );
        }
        return { ...prior.response, replayed: true };
      }
      const rows = removeAllTrashed
        ? await transaction`
            SELECT projection.source_id, projection.immich_asset_id,
              projection.cimmich_asset_id, projection.last_seen_run_id,
              binding.binding_id
            FROM immich_asset_projection projection
            JOIN immich_inventory_source inventory_source
              ON inventory_source.source_id = projection.source_id
              AND inventory_source.state = 'active'
            JOIN asset_source_binding binding
              ON binding.source_kind = 'immich'
              AND binding.source_id = projection.source_id
              AND binding.external_asset_id = projection.immich_asset_id
            WHERE projection.source_id = ${source}
              AND projection.state = 'missing'
              AND projection.is_trashed = true
              AND binding.state = 'missing'
            ORDER BY projection.immich_asset_id
            FOR UPDATE OF projection, binding
          `
        : await transaction`
            SELECT projection.source_id, projection.immich_asset_id,
              projection.cimmich_asset_id, projection.last_seen_run_id,
              binding.binding_id
            FROM immich_asset_projection projection
            JOIN immich_inventory_source inventory_source
              ON inventory_source.source_id = projection.source_id
              AND inventory_source.state = 'active'
            JOIN asset_source_binding binding
              ON binding.source_kind = 'immich'
              AND binding.source_id = projection.source_id
              AND binding.external_asset_id = projection.immich_asset_id
            WHERE projection.immich_asset_id = ANY(${requestedAssetIds}::text[])
              AND projection.source_id = ${source}
              AND projection.state = 'missing'
              AND binding.state = 'missing'
            ORDER BY projection.immich_asset_id
            FOR UPDATE OF projection, binding
          `;
      if (
        (removeAllTrashed && rows.length !== expected) ||
        (!removeAllTrashed && rows.length !== requestedAssetIds.length)
      ) {
        throw typedError(
          removeAllTrashed
            ? "Immich trash changed; refresh Archive Health before removing"
            : "Only assets outside the active Immich library can be removed",
          "ARCHIVE_MISSING_FILE_NOT_CONFIRMED",
          409,
        );
      }
      const assetIds = rows.map((row) => row.immich_asset_id);
      const bindingIds = rows.map((row) => row.binding_id);
      const cimmichAssetIds = [
        ...new Set(rows.map((row) => row.cimmich_asset_id)),
      ];
      await transaction`
        UPDATE asset_source_binding
        SET state = 'superseded'
        WHERE binding_id = ANY(${bindingIds}::text[])
      `;
      await transaction`
        INSERT INTO asset_source_binding_event (
          event_id, binding_id, asset_id, content_id, input_revision,
          event_kind, producer_receipt_id
        )
        SELECT 'source_binding_event_' || substr(encode(digest(
          binding_id || E'\x1f' || ${command} || E'\x1fremoved', 'sha256'
        ), 'hex'), 1, 40),
          binding_id, asset_id, content_id, input_revision, 'superseded',
          'receipt_cimmich_archive_missing_file_management_v1'
        FROM asset_source_binding
        WHERE binding_id = ANY(${bindingIds}::text[])
        ON CONFLICT DO NOTHING
      `;
      const tombstoned = await transaction`
        UPDATE asset SET state = 'tombstoned'
        WHERE asset_id = ANY(${cimmichAssetIds}::text[])
          AND NOT EXISTS (
            SELECT 1 FROM asset_source_binding remaining
            WHERE remaining.asset_id = asset.asset_id
              AND remaining.state IN ('active','offline','missing')
          )
        RETURNING asset_id
      `;
      const response = {
        removedSourceAssetIds: assetIds,
        schemaVersion: archiveMissingFilesSchemaVersion,
        sourceId: source,
        tombstonedAssets: tombstoned.length,
      };
      await transaction`
        INSERT INTO archive_missing_file_command (
          command_id, actor_id, source_id, source_asset_ids,
          request_digest, response, producer_receipt_id
        ) VALUES (
          ${command}, ${actor}, ${source}, ${assetIds},
          ${digest}, ${transaction.json(response)},
          'receipt_cimmich_archive_missing_file_management_v1'
        )
      `;
      return { ...response, replayed: false };
    });
  },
});
