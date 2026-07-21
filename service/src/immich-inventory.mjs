import { createHash } from "node:crypto";

export const IMMICH_INVENTORY_SCHEMA_VERSION = "cimmich.immich-inventory.v1";

const VISIBILITIES = ["timeline", "archive", "hidden", "locked"];
const VISIBILITY_SET = new Set(VISIBILITIES);
const INVENTORY_ACCESS_STATES = new Set([
  "available",
  "elevated_session_required",
]);
const OPERATIONS = new Set([
  "detect_faces",
  "recognize_faces",
  "detect_and_recognize",
]);
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
};

const digest = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" ? value : JSON.stringify(canonicalize(value)),
    )
    .digest("hex");

const requiredText = (value, label, maximum = 200) => {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`Immich inventory requires ${label}`);
  }
  return normalized;
};

const requiredDigest = (value, label) => {
  const normalized = requiredText(value, label, 64);
  if (!DIGEST_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
  return normalized;
};

const optionalInteger = (value, label) => {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Immich inventory ${label} must be a non-negative integer`);
  }
  return value;
};

const requiredTimestamp = (value, label) => {
  const normalized = requiredText(value, label, 80);
  if (Number.isNaN(Date.parse(normalized))) {
    throw new Error(`Immich inventory ${label} is invalid`);
  }
  return new Date(normalized).toISOString();
};

export const normalizeInventoryJob = (job) => {
  if (job == null) return null;
  const normalized = {
    configDigest: requiredDigest(job.configDigest, "job.configDigest"),
    maxAttempts: Number(job.maxAttempts ?? 3),
    operation: requiredText(job.operation, "job.operation", 40),
    toolVersion: requiredText(job.toolVersion, "job.toolVersion", 200),
  };
  if (!OPERATIONS.has(normalized.operation)) {
    throw new Error("Immich inventory job operation is unsupported");
  }
  if (
    !Number.isInteger(normalized.maxAttempts) ||
    normalized.maxAttempts < 1 ||
    normalized.maxAttempts > 20
  ) {
    throw new Error("Immich inventory job maxAttempts must be from 1 to 20");
  }
  return normalized;
};

const optionalFilename = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (normalized.length > 500 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error("Immich inventory asset.originalFileName is invalid");
  }
  return normalized;
};

export const cimmichAssetIdForImmich = ({ sourceId, immichAssetId }) =>
  `asset_immich_${digest(
    `${requiredText(sourceId, "sourceId", 120)}\u001f${requiredText(
      immichAssetId,
      "immichAssetId",
      200,
    )}`,
  ).slice(0, 40)}`;

const normalizeAsset = (value, visibility) => {
  if (!value || typeof value !== "object") {
    throw new Error("Immich inventory asset is invalid");
  }
  const assetVisibility = requiredText(
    value.visibility,
    "asset.visibility",
    20,
  );
  if (assetVisibility !== visibility) {
    throw new Error("Immich inventory asset crossed visibility lanes");
  }
  const assetType = requiredText(value.assetType, "asset.assetType", 20);
  if (!new Set(["image", "video", "audio", "other"]).has(assetType)) {
    throw new Error("Immich inventory asset type is unsupported");
  }
  return {
    immichAssetId: requiredText(value.immichAssetId, "asset.immichAssetId"),
    ownerDigest: digest(requiredText(value.ownerId, "asset.ownerId")),
    inputRevision: requiredDigest(value.inputRevision, "asset.inputRevision"),
    checksum: requiredText(value.checksum, "asset.checksum", 500),
    assetType,
    visibility: assetVisibility,
    originalMimeType: String(value.originalMimeType || "").trim() || null,
    originalFileName: optionalFilename(value.originalFileName),
    captureTime: requiredTimestamp(value.captureTime, "asset.captureTime"),
    sourceUpdatedAt: requiredTimestamp(value.updatedAt, "asset.updatedAt"),
    width: optionalInteger(value.width, "asset.width"),
    height: optionalInteger(value.height, "asset.height"),
    durationSeconds: optionalInteger(value.duration, "asset.duration"),
    isArchived: Boolean(value.isArchived),
    isFavorite: Boolean(value.isFavorite),
    isOffline: Boolean(value.isOffline),
    isTrashed: Boolean(value.isTrashed),
  };
};

export const normalizeInventoryPage = ({ cursor = "", page, visibility }) => {
  const normalizedVisibility = requiredText(visibility, "visibility", 20);
  if (!VISIBILITY_SET.has(normalizedVisibility)) {
    throw new Error("Immich inventory visibility is unsupported");
  }
  if (
    !page ||
    page.visibility !== normalizedVisibility ||
    !Array.isArray(page.items)
  ) {
    throw new Error("Immich inventory page is invalid");
  }
  const normalizedCursor = String(cursor || "");
  const accessState = String(page.accessState || "available");
  if (!INVENTORY_ACCESS_STATES.has(accessState)) {
    throw new Error("Immich inventory page accessState is unsupported");
  }
  const nextCursor =
    page.nextCursor == null
      ? null
      : requiredText(page.nextCursor, "nextCursor", 120);
  if (nextCursor === normalizedCursor) {
    throw new Error("Immich inventory cursor did not advance");
  }
  const items = page.items.map((item) =>
    normalizeAsset(item, normalizedVisibility),
  );
  if (
    accessState === "elevated_session_required" &&
    (normalizedVisibility !== "locked" ||
      items.length > 0 ||
      nextCursor !== null)
  ) {
    throw new Error(
      "Immich inventory elevated access state is invalid for this page",
    );
  }
  if (new Set(items.map((item) => item.immichAssetId)).size !== items.length) {
    throw new Error("Immich inventory page contains duplicate assets");
  }
  return {
    accessState,
    cursor: normalizedCursor,
    items,
    nextCursor,
    pageDigest: digest({
      cursor: normalizedCursor,
      items: items.map((item) => ({
        immichAssetId: item.immichAssetId,
        inputRevision: item.inputRevision,
        visibility: item.visibility,
      })),
      nextCursor,
      visibility: normalizedVisibility,
    }),
    visibility: normalizedVisibility,
  };
};

export const projectInventoryCoverage = ({
  lanes = [],
  lockedAccessState = "unknown",
  selectedVisibilities = VISIBILITIES,
} = {}) => {
  if (
    !new Set(["available", "elevated_session_required", "unknown"]).has(
      lockedAccessState,
    )
  ) {
    throw new Error("Immich inventory Locked access state is invalid");
  }
  const selected = new Set(selectedVisibilities);
  const byVisibility = new Map(lanes.map((lane) => [lane.visibility, lane]));
  const projected = VISIBILITIES.map((visibility) => {
    const lane = byVisibility.get(visibility);
    const isSelected = selected.has(visibility);
    const accessState =
      visibility === "locked" ? lockedAccessState : "available";
    return {
      accessState,
      inventoryState: !isSelected
        ? "not_selected"
        : accessState === "elevated_session_required"
          ? "unavailable"
          : accessState === "unknown"
            ? "unknown"
            : lane?.state || "pending",
      observedItemCount: Number(lane?.observedItemCount || 0),
      selected: isSelected,
      visibility,
    };
  });
  if (selected.size === 0) {
    return {
      complete: false,
      lanes: projected,
      state: "not_started",
    };
  }
  return {
    complete: projected.every(
      (lane) =>
        !lane.selected ||
        lane.inventoryState === "completed" ||
        lane.inventoryState === "unavailable",
    ),
    lanes: projected,
    state: projected.some(
      (lane) =>
        lane.selected &&
        new Set(["pending", "processing"]).has(lane.inventoryState),
    )
      ? "processing"
      : projected.some(
            (lane) => lane.selected && lane.inventoryState === "unknown",
          )
        ? "unknown"
        : projected.some(
              (lane) => lane.selected && lane.inventoryState === "unavailable",
            )
          ? "complete_with_exclusions"
          : projected.every(
                (lane) => !lane.selected || lane.inventoryState === "completed",
              )
            ? "complete"
            : "incomplete",
  };
};

const projectRun = (row) => ({
  completedAt: row.completed_at || null,
  immichVersion: row.immich_version,
  observedAssetCount: Number(row.observed_asset_count),
  pageCount: Number(row.page_count),
  runId: row.run_id,
  snapshotId: row.snapshot_id,
  sourceId: row.source_id,
  selectedVisibilities: row.selected_visibilities || [...VISIBILITIES],
  startedAt: row.started_at,
  state: row.state,
});

const projectLane = (row) => ({
  cursor: row.cursor,
  observedItemCount: Number(row.observed_item_count),
  pageCount: Number(row.page_count),
  state: row.state,
  visibility: row.visibility,
});

const pauseSupersededJobs = async (sql, { assetId, inputRevision }) => {
  await sql`
    WITH paused AS (
      UPDATE media_job job SET state = 'paused',
        attempt_count = CASE WHEN job.state = 'processing'
          THEN greatest(job.attempt_count - 1, 0) ELSE job.attempt_count END,
        lease_owner = NULL, lease_expires_at = NULL,
        last_error_code = 'INPUT_REVISION_SUPERSEDED'
      WHERE job.asset_id = ${assetId}
        AND job.input_revision <> ${inputRevision}
        AND job.state IN ('pending','processing')
      RETURNING job.*
    )
    INSERT INTO media_job_event (
      event_id, job_id, event_kind, attempt_count, checkpoint_revision,
      public_details
    ) SELECT
      'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
      job_id, 'paused', attempt_count, checkpoint_revision,
      '{"reason":"input_revision_superseded"}'::jsonb
    FROM paused
  `;
};

export const createImmichInventoryLedger = (
  sql,
  { resolveCimmichAssetId = null } = {},
) => ({
  async begin({ immichVersion, principalDigest, sourceId }) {
    const [row] = await sql`
      SELECT * FROM begin_immich_inventory_run(
        ${requiredText(sourceId, "sourceId", 120)},
        ${requiredText(immichVersion, "immichVersion", 80)},
        ${requiredDigest(principalDigest, "principalDigest")}
      )
    `;
    return projectRun(row);
  },

  async beginScoped({
    immichVersion,
    principalDigest,
    sourceId,
    visibilities,
  }) {
    const [row] = await sql`
      SELECT * FROM begin_scoped_immich_inventory_run(
        ${requiredText(sourceId, "sourceId", 120)},
        ${requiredText(immichVersion, "immichVersion", 80)},
        ${requiredDigest(principalDigest, "principalDigest")},
        ${visibilities}
      )
    `;
    return projectRun(row);
  },

  async complete({ runId }) {
    const [row] = await sql`
      SELECT * FROM complete_immich_inventory_run(
        ${requiredText(runId, "runId", 200)}
      )
    `;
    return projectRun(row);
  },

  async completeScoped({ runId }) {
    const [row] = await sql`
      SELECT * FROM complete_scoped_immich_inventory_run(
        ${requiredText(runId, "runId", 200)}
      )
    `;
    return projectRun(row);
  },

  async scope({ runId, visibilities }) {
    const [row] = await sql`
      SELECT * FROM scope_immich_inventory_run(
        ${requiredText(runId, "runId", 200)}, ${visibilities}
      )
    `;
    return projectRun(row);
  },

  async lanes({ runId }) {
    const rows = await sql`
      SELECT * FROM immich_inventory_lane
      WHERE run_id = ${requiredText(runId, "runId", 200)}
      ORDER BY array_position(
        ARRAY['timeline','archive','hidden','locked']::text[], visibility
      )
    `;
    return rows.map(projectLane);
  },

  async recordPage({ job, page, runId, sourceId }) {
    const normalized = normalizeInventoryPage(page);
    const projectedAssetIds = new Map(
      normalized.items.map((asset) => {
        const generatedAssetId = cimmichAssetIdForImmich({
          immichAssetId: asset.immichAssetId,
          sourceId,
        });
        const resolvedAssetId =
          ["image", "video"].includes(asset.assetType) && resolveCimmichAssetId
            ? resolveCimmichAssetId({
                immichAssetId: asset.immichAssetId,
                sourceId,
              })
            : null;
        return [
          asset.immichAssetId,
          resolvedAssetId == null
            ? generatedAssetId
            : requiredText(resolvedAssetId, "resolved Cimmich assetId", 200),
        ];
      }),
    );
    if (new Set(projectedAssetIds.values()).size !== projectedAssetIds.size) {
      throw new Error("Immich inventory asset identity is ambiguous");
    }
    const bridgeEntries = normalized.items.map((asset) => ({
      active: ["image", "video"].includes(asset.assetType),
      assetId: projectedAssetIds.get(asset.immichAssetId),
      filename: asset.originalFileName || "",
      sourceAssetId: asset.immichAssetId,
    }));
    const normalizedJob = normalizeInventoryJob(job);

    return sql.begin(async (transaction) => {
      const [priorPage] = await transaction`
        SELECT page_digest FROM immich_inventory_page
        WHERE run_id = ${runId} AND visibility = ${normalized.visibility}
          AND cursor = ${normalized.cursor}
      `;
      if (priorPage) {
        if (priorPage.page_digest !== normalized.pageDigest) {
          throw new Error("Immich inventory page replay changed contents");
        }
        if (normalizedJob) {
          for (const assetInput of normalized.items) {
            if (!new Set(["image", "video"]).has(assetInput.assetType)) {
              continue;
            }
            const assetId = projectedAssetIds.get(assetInput.immichAssetId);
            const [projection] = await transaction`
              SELECT cimmich_asset_id, input_revision, state
              FROM immich_asset_projection
              WHERE source_id = ${sourceId}
                AND immich_asset_id = ${assetInput.immichAssetId}
              FOR SHARE
            `;
            if (
              !projection ||
              projection.state !== "active" ||
              projection.cimmich_asset_id !== assetId ||
              projection.input_revision !== assetInput.inputRevision
            ) {
              throw new Error(
                "Immich inventory replay no longer matches its current projection",
              );
            }
            await transaction`
              SELECT * FROM enqueue_media_job(
                ${assetId}, ${normalizedJob.operation},
                ${normalizedJob.toolVersion}, ${normalizedJob.configDigest},
                ${assetInput.inputRevision}, ${normalizedJob.maxAttempts}
              )
            `;
          }
        }
        const [replayedLane] = await transaction`
          SELECT * FROM immich_inventory_lane
          WHERE run_id = ${runId} AND visibility = ${normalized.visibility}
        `;
        return {
          admittedAssetMappings: [],
          bridgeEntries,
          lane: projectLane(replayedLane),
          replayed: true,
        };
      }

      const [run] = await transaction`
        SELECT * FROM immich_inventory_run
        WHERE run_id = ${runId} AND source_id = ${sourceId}
        FOR UPDATE
      `;
      const [lane] = await transaction`
        SELECT * FROM immich_inventory_lane
        WHERE run_id = ${runId} AND visibility = ${normalized.visibility}
        FOR UPDATE
      `;
      if (
        !run ||
        run.state !== "processing" ||
        !lane ||
        lane.state === "completed"
      ) {
        throw new Error("Immich inventory run or lane is not processing");
      }
      if (lane.cursor !== normalized.cursor) {
        throw new Error("Immich inventory page cursor is stale");
      }

      const admittedAssetMappings = [];
      for (const assetInput of normalized.items) {
        const [existing] = await transaction`
          SELECT * FROM immich_asset_projection
          WHERE source_id = ${sourceId}
            AND immich_asset_id = ${assetInput.immichAssetId}
          FOR UPDATE
        `;
        if (
          existing &&
          existing.last_seen_run_id === runId &&
          existing.visibility !== assetInput.visibility
        ) {
          throw new Error("Immich asset appeared in multiple visibility lanes");
        }

        const supported = ["image", "video"].includes(assetInput.assetType);
        const assetId = supported
          ? projectedAssetIds.get(assetInput.immichAssetId)
          : null;

        if (
          supported &&
          existing?.cimmich_asset_id &&
          existing.cimmich_asset_id !== assetId
        ) {
          throw new Error("Immich inventory asset identity changed");
        }
        if (supported) {
          const [resolvedAsset] = await transaction`
            SELECT asset_id FROM asset
            WHERE asset_id = ${assetId}
            FOR UPDATE
          `;
          const generatedAssetId = cimmichAssetIdForImmich({
            immichAssetId: assetInput.immichAssetId,
            sourceId,
          });
          if (assetId !== generatedAssetId && !resolvedAsset) {
            throw new Error("Resolved Cimmich inventory asset does not exist");
          }
          const [crossedProjection] = await transaction`
            SELECT source_id, immich_asset_id
            FROM immich_asset_projection
            WHERE cimmich_asset_id = ${assetId}
              AND NOT (
                source_id = ${sourceId}
                AND immich_asset_id = ${assetInput.immichAssetId}
              )
            LIMIT 1
          `;
          if (crossedProjection) {
            throw new Error(
              "Resolved Cimmich inventory asset is already bound",
            );
          }
          if (!resolvedAsset) {
            admittedAssetMappings.push({
              assetId,
              sourceAssetId: assetInput.immichAssetId,
            });
          }
        }

        if (
          existing?.cimmich_asset_id &&
          (!supported || existing.input_revision !== assetInput.inputRevision)
        ) {
          await pauseSupersededJobs(transaction, {
            assetId: existing.cimmich_asset_id,
            inputRevision: assetInput.inputRevision,
          });
        }

        if (supported) {
          await transaction`
            INSERT INTO asset (
              asset_id, content_hash, locator_token, media_kind, mime_type,
              width, height, duration_seconds, capture_time,
              source_snapshot_id, state, privacy_class
            ) VALUES (
              ${assetId}, ${assetInput.checksum},
              ${`immich:${sourceId}:${assetInput.immichAssetId}`},
              ${assetInput.assetType},
              ${assetInput.originalMimeType || "application/octet-stream"},
              ${assetInput.width}, ${assetInput.height},
              ${assetInput.durationSeconds}, ${assetInput.captureTime},
              ${run.snapshot_id}, 'active', 'private'
            )
            ON CONFLICT (asset_id) DO UPDATE SET
              content_hash = excluded.content_hash,
              media_kind = excluded.media_kind,
              mime_type = excluded.mime_type,
              width = excluded.width,
              height = excluded.height,
              duration_seconds = excluded.duration_seconds,
              capture_time = excluded.capture_time,
              source_snapshot_id = excluded.source_snapshot_id,
              state = 'active'
          `;
        } else if (existing?.cimmich_asset_id) {
          await transaction`
            UPDATE asset SET state = 'unsupported'
            WHERE asset_id = ${existing.cimmich_asset_id}
          `;
        }

        await transaction`
          INSERT INTO immich_asset_projection (
            source_id, immich_asset_id, cimmich_asset_id, owner_digest,
            input_revision, checksum, asset_type, visibility,
            original_mime_type, original_file_name, capture_time, source_updated_at,
            width, height, duration_seconds, is_archived, is_favorite,
            is_offline, is_trashed, state, first_seen_run_id, last_seen_run_id
          ) VALUES (
            ${sourceId}, ${assetInput.immichAssetId}, ${assetId},
            ${assetInput.ownerDigest}, ${assetInput.inputRevision},
            ${assetInput.checksum}, ${assetInput.assetType},
            ${assetInput.visibility}, ${assetInput.originalMimeType},
            ${assetInput.originalFileName}, ${assetInput.captureTime}, ${assetInput.sourceUpdatedAt},
            ${assetInput.width}, ${assetInput.height},
            ${assetInput.durationSeconds}, ${assetInput.isArchived},
            ${assetInput.isFavorite}, ${assetInput.isOffline},
            ${assetInput.isTrashed}, ${supported ? "active" : "unsupported"},
            ${runId}, ${runId}
          )
          ON CONFLICT (source_id, immich_asset_id) DO UPDATE SET
            cimmich_asset_id = excluded.cimmich_asset_id,
            owner_digest = excluded.owner_digest,
            input_revision = excluded.input_revision,
            checksum = excluded.checksum,
            asset_type = excluded.asset_type,
            visibility = excluded.visibility,
            original_mime_type = excluded.original_mime_type,
            original_file_name = excluded.original_file_name,
            capture_time = excluded.capture_time,
            source_updated_at = excluded.source_updated_at,
            width = excluded.width,
            height = excluded.height,
            duration_seconds = excluded.duration_seconds,
            is_archived = excluded.is_archived,
            is_favorite = excluded.is_favorite,
            is_offline = excluded.is_offline,
            is_trashed = excluded.is_trashed,
            state = excluded.state,
            last_seen_run_id = excluded.last_seen_run_id,
            last_seen_at = now()
        `;

        if (supported && normalizedJob) {
          await transaction`
            SELECT * FROM enqueue_media_job(
              ${assetId}, ${normalizedJob.operation},
              ${normalizedJob.toolVersion}, ${normalizedJob.configDigest},
              ${assetInput.inputRevision}, ${normalizedJob.maxAttempts}
            )
          `;
        }
      }

      await transaction`
        INSERT INTO immich_inventory_page (
          run_id, visibility, cursor, next_cursor, page_digest, item_count
        ) VALUES (
          ${runId}, ${normalized.visibility}, ${normalized.cursor},
          ${normalized.nextCursor}, ${normalized.pageDigest},
          ${normalized.items.length}
        )
      `;
      const [updatedLane] = await transaction`
        UPDATE immich_inventory_lane SET
          state = ${normalized.nextCursor == null ? "completed" : "processing"},
          access_state = ${normalized.accessState},
          cursor = ${normalized.nextCursor || ""},
          page_count = page_count + 1,
          observed_item_count = observed_item_count + ${normalized.items.length},
          updated_at = now()
        WHERE run_id = ${runId} AND visibility = ${normalized.visibility}
        RETURNING *
      `;
      await transaction`
        UPDATE immich_inventory_run SET page_count = page_count + 1
        WHERE run_id = ${runId}
      `;
      return {
        admittedAssetMappings,
        bridgeEntries,
        lane: projectLane(updatedLane),
        replayed: false,
      };
    });
  },

  async status({ lockedAccessState = "unknown", sourceId }) {
    const normalizedSourceId = requiredText(sourceId, "sourceId", 120);
    const [summary] = await sql`
      SELECT * FROM immich_inventory_status WHERE source_id = ${normalizedSourceId}
    `;
    const coverageRunId =
      summary?.processing_run_id || summary?.last_completed_run_id || null;
    let lanes = [];
    let selectedVisibilities = [];
    if (coverageRunId) {
      lanes = await this.lanes({ runId: coverageRunId });
      const [coverageRun] = await sql`
        SELECT run.selected_visibilities,
          coalesce(locked.access_state, 'unknown') AS locked_access_state
        FROM immich_inventory_run run
        LEFT JOIN immich_inventory_lane locked
          ON locked.run_id = run.run_id AND locked.visibility = 'locked'
        WHERE run.run_id = ${coverageRunId}
      `;
      selectedVisibilities = coverageRun?.selected_visibilities || [
        ...VISIBILITIES,
      ];
      if (lockedAccessState === "unknown") {
        lockedAccessState = coverageRun?.locked_access_state || "unknown";
      }
    }
    const coverage = projectInventoryCoverage({
      lanes,
      lockedAccessState,
      selectedVisibilities,
    });
    return {
      schemaVersion: IMMICH_INVENTORY_SCHEMA_VERSION,
      coverage: {
        ...coverage,
        runId: coverageRunId,
      },
      source: summary
        ? {
            activeAssets: Number(summary.active_assets),
            immichVersion: summary.immich_version,
            lastCompletedRunId: summary.last_completed_run_id || null,
            missingAssets: Number(summary.missing_assets),
            processingRunId: summary.processing_run_id || null,
            sourceId: summary.source_id,
            state: summary.state,
            suspectedMissingAssets: Number(summary.suspected_missing_assets),
            unsupportedAssets: Number(summary.unsupported_assets),
          }
        : null,
      lanes,
    };
  },
});

export const createImmichInventorySynchronizer = ({
  companion,
  job,
  onProjectionCommitted = null,
  pageSize = 250,
  resolveCimmichAssetId = null,
  sourceId = "immich-primary",
  sql,
}) => {
  if (
    !companion ||
    typeof companion.status !== "function" ||
    typeof companion.listAssets !== "function"
  ) {
    throw new Error("Immich inventory requires a companion adapter");
  }
  if (!sql) throw new Error("Immich inventory requires a Cimmich database");
  const normalizedPageSize = Number(pageSize);
  if (
    !Number.isInteger(normalizedPageSize) ||
    normalizedPageSize < 1 ||
    normalizedPageSize > 1000
  ) {
    throw new Error("Immich inventory pageSize must be from 1 to 1000");
  }
  const normalizedSourceId = requiredText(sourceId, "sourceId", 120);
  const normalizedJob = normalizeInventoryJob(job);
  if (
    onProjectionCommitted !== null &&
    typeof onProjectionCommitted !== "function"
  ) {
    throw new Error("Immich inventory projection callback is invalid");
  }
  if (
    resolveCimmichAssetId !== null &&
    typeof resolveCimmichAssetId !== "function"
  ) {
    throw new Error("Immich inventory asset resolver is invalid");
  }
  const ledger = createImmichInventoryLedger(sql, { resolveCimmichAssetId });
  const inventoryStatus = async ({ probeLocked = true } = {}) => {
    let lockedAccessState = "unknown";
    if (probeLocked) {
      try {
        const companionStatus = await companion.status();
        if (companionStatus.state === "ready") {
          const locked = await companion.listAssets({
            cursor: "",
            limit: 1,
            visibility: "locked",
          });
          lockedAccessState = locked.accessState || "available";
        }
      } catch {
        // Coverage remains explicitly unknown when the bounded probe fails.
      }
    }
    return ledger.status({
      lockedAccessState,
      sourceId: normalizedSourceId,
    });
  };

  return {
    status: () => inventoryStatus(),

    async ensureCurrentJobs({ limit = 10_000 } = {}) {
      if (!normalizedJob) return { eligibleAssets: 0, ensuredJobs: 0 };
      const normalizedLimit = Number(limit);
      if (
        !Number.isInteger(normalizedLimit) ||
        normalizedLimit < 1 ||
        normalizedLimit > 10_000
      ) {
        throw new Error(
          "Immich inventory current-job limit must be from 1 to 10000",
        );
      }
      return sql.begin(async (transaction) => {
        const projections = await transaction`
          SELECT projection.cimmich_asset_id AS asset_id,
            projection.input_revision
          FROM immich_asset_projection projection
          JOIN asset ON asset.asset_id = projection.cimmich_asset_id
            AND asset.state = 'active'
          WHERE projection.source_id = ${normalizedSourceId}
            AND projection.state = 'active'
            AND projection.asset_type IN ('image', 'video')
          ORDER BY projection.cimmich_asset_id
          LIMIT ${normalizedLimit}
          FOR SHARE OF projection, asset
        `;
        for (const projection of projections) {
          await transaction`
            SELECT * FROM enqueue_media_job(
              ${projection.asset_id}, ${normalizedJob.operation},
              ${normalizedJob.toolVersion}, ${normalizedJob.configDigest},
              ${projection.input_revision}, ${normalizedJob.maxAttempts}
            )
          `;
        }
        return {
          eligibleAssets: projections.length,
          ensuredJobs: projections.length,
        };
      });
    },

    async synchronize({
      maxPages = Number.POSITIVE_INFINITY,
      visibilities = VISIBILITIES,
    } = {}) {
      if (
        maxPages !== Number.POSITIVE_INFINITY &&
        (!Number.isInteger(maxPages) || maxPages < 1)
      ) {
        throw new Error("Immich inventory maxPages must be a positive integer");
      }
      if (
        !Array.isArray(visibilities) ||
        visibilities.length < 1 ||
        visibilities.length > VISIBILITIES.length ||
        new Set(visibilities).size !== visibilities.length ||
        visibilities.some((visibility) => !VISIBILITY_SET.has(visibility))
      ) {
        throw new Error("Immich inventory visibilities are invalid");
      }
      const selectedVisibilities = VISIBILITIES.filter((visibility) =>
        visibilities.includes(visibility),
      );
      const companionStatus = await companion.status();
      if (companionStatus.state !== "ready") {
        throw Object.assign(
          new Error("Immich companion is not ready for inventory"),
          {
            code: companionStatus.code || "IMMICH_COMPANION_NOT_READY",
          },
        );
      }
      const principalDigest = digest(
        requiredText(companionStatus.principal?.userId, "principal.userId"),
      );
      const run = await ledger.beginScoped({
        immichVersion: companionStatus.immichVersion,
        principalDigest,
        sourceId: normalizedSourceId,
        visibilities: selectedVisibilities,
      });
      let processedPages = 0;
      let admittedAssetCount = 0;
      const admittedAssets = [];

      for (const visibility of selectedVisibilities) {
        let lane = (await ledger.lanes({ runId: run.runId })).find(
          (candidate) => candidate.visibility === visibility,
        );
        while (lane.state !== "completed") {
          const page = await companion.listAssets({
            cursor: lane.cursor,
            limit: normalizedPageSize,
            visibility,
          });
          const recorded = await ledger.recordPage({
            job: normalizedJob,
            page: { cursor: lane.cursor, page, visibility },
            runId: run.runId,
            sourceId: normalizedSourceId,
          });
          admittedAssetCount += recorded.admittedAssetMappings.length;
          admittedAssets.push(
            ...recorded.admittedAssetMappings.slice(
              0,
              Math.max(1_000 - admittedAssets.length, 0),
            ),
          );
          if (onProjectionCommitted) {
            await onProjectionCommitted({
              entries: recorded.bridgeEntries,
              phase: "page_committed",
              runId: run.runId,
              sourceId: normalizedSourceId,
            });
          }
          lane = recorded.lane;
          processedPages += 1;
          if (processedPages >= maxPages) {
            return {
              ...(await inventoryStatus({ probeLocked: false })),
              admittedAssetCount,
              admittedAssets,
              admittedAssetsTruncated:
                admittedAssetCount > admittedAssets.length,
              pagesProcessed: processedPages,
              run: { ...run, state: "processing" },
            };
          }
        }
      }

      const completed = await ledger.completeScoped({ runId: run.runId });
      if (onProjectionCommitted) {
        await onProjectionCommitted({
          entries: [],
          phase: "run_completed",
          runId: run.runId,
          sourceId: normalizedSourceId,
        });
      }
      return {
        ...(await inventoryStatus({ probeLocked: false })),
        admittedAssetCount,
        admittedAssets,
        admittedAssetsTruncated: admittedAssetCount > admittedAssets.length,
        pagesProcessed: processedPages,
        run: completed,
      };
    },
  };
};
