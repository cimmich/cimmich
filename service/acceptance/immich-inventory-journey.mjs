import assert from "node:assert/strict";
import postgres from "postgres";
import { createImmichInventorySynchronizer } from "../src/immich-inventory.mjs";
import {
  createInventoryProjectionBridgeRefresher,
  resolveCimmichAssetIdFromDisplayBridge,
} from "../src/bridge.mjs";

const databaseUrl =
  process.env.DATABASE_URL || "postgres://cimmich@postgres:5432/cimmich";
const apiRoot =
  process.env.CIMMICH_ACCEPTANCE_API_URL || "http://127.0.0.1:3101";
const sql = postgres(databaseUrl, { max: 2, prepare: true });
const configDigest = "7".repeat(64);
let scenario = "initial";
const calls = [];
const projectionEvents = [];
const liveBridge = new Map();
const refreshLiveBridge = createInventoryProjectionBridgeRefresher({
  bridge: liveBridge,
  sql,
});

const asset = (id, visibility, revision, type = "image") => ({
  assetType: type,
  captureTime: "2026-01-01T00:00:00.000Z",
  checksum: `checksum-${id}-${revision}`,
  duration: type === "video" ? 12 : null,
  height: type === "audio" ? null : 800,
  immichAssetId: id,
  inputRevision: revision.repeat(64),
  isArchived: visibility === "archive",
  isFavorite: false,
  isOffline: false,
  isTrashed: false,
  originalMimeType:
    type === "image"
      ? "image/jpeg"
      : type === "video"
        ? "video/mp4"
        : "audio/mpeg",
  originalFileName: `${id}.${type === "video" ? "mp4" : type === "image" ? "jpg" : "mp3"}`,
  ownerId: "synthetic-inventory-owner",
  updatedAt: `2026-01-0${revision === "a" ? "2" : "3"}T00:00:00.000Z`,
  visibility,
  width: type === "audio" ? null : 1200,
});

const companion = {
  async status() {
    return {
      immichVersion: "3.0.3",
      principal: { userId: "synthetic-inventory-principal" },
      state: "ready",
    };
  },
  async listAssets({ cursor, visibility }) {
    calls.push({ cursor, scenario, visibility });
    if (visibility === "timeline") {
      if (scenario === "initial") {
        if (!cursor) {
          return {
            items: [asset("inventory-a", "timeline", "a")],
            nextCursor: "2",
            visibility,
          };
        }
        return {
          items: [asset("inventory-b", "timeline", "a")],
          nextCursor: null,
          visibility,
        };
      }
      if (scenario === "changed-missing") {
        return {
          items: [asset("inventory-a", "timeline", "b")],
          nextCursor: null,
          visibility,
        };
      }
      return {
        items: [
          asset("inventory-a", "timeline", "b"),
          asset("inventory-b", "timeline", "a"),
        ],
        nextCursor: null,
        visibility,
      };
    }
    if (visibility === "archive") {
      return {
        items: [asset("inventory-c", "archive", "a", "video")],
        nextCursor: null,
        visibility,
      };
    }
    if (visibility === "locked") {
      return {
        items: [asset("inventory-audio", "locked", "a", "audio")],
        nextCursor: null,
        visibility,
      };
    }
    return { items: [], nextCursor: null, visibility };
  },
};

const createSynchronizer = (
  job = {
    configDigest,
    maxAttempts: 3,
    operation: "detect_and_recognize",
    toolVersion: "synthetic-inventory-provider-v1",
  },
) =>
  createImmichInventorySynchronizer({
    companion,
    job,
    pageSize: 1,
    onProjectionCommitted: async (event) => {
      projectionEvents.push(event);
      await refreshLiveBridge(event);
    },
    resolveCimmichAssetId: ({ immichAssetId }) =>
      resolveCimmichAssetIdFromDisplayBridge(liveBridge, immichAssetId),
    sourceId: "synthetic-immich-primary",
    sql,
  });

try {
  await sql`
    INSERT INTO asset (
      asset_id, content_hash, locator_token, media_kind, mime_type,
      width, height, capture_time, source_snapshot_id, state, privacy_class
    ) SELECT
      'asset_inventory_legacy_fixture', content_hash,
      'synthetic:inventory-legacy', media_kind, mime_type,
      width, height, capture_time, source_snapshot_id, state, privacy_class
    FROM asset WHERE asset_id = 'asset_service_fixture'
    ON CONFLICT (asset_id) DO NOTHING
  `;
  liveBridge.set("asset_inventory_legacy_fixture", {
    filename: "inventory-a.jpg",
    sourceAssetId: "inventory-a",
  });
  const interrupted = await createSynchronizer().synchronize({ maxPages: 1 });
  assert.equal(interrupted.pagesProcessed, 1);
  assert.equal(interrupted.admittedAssetCount, 0);
  assert.deepEqual(interrupted.admittedAssets, []);
  assert.equal(interrupted.run.state, "processing");
  assert.deepEqual(projectionEvents[0], {
    entries: [
      {
        active: true,
        assetId: "asset_inventory_legacy_fixture",
        filename: "inventory-a.jpg",
        sourceAssetId: "inventory-a",
      },
    ],
    phase: "page_committed",
    runId: interrupted.run.runId,
    sourceId: "synthetic-immich-primary",
  });
  assert.deepEqual(liveBridge.get("asset_inventory_legacy_fixture"), {
    filename: "inventory-a.jpg",
    sourceAssetId: "inventory-a",
  });
  assert.equal(
    interrupted.lanes.find((lane) => lane.visibility === "timeline").cursor,
    "2",
  );

  const resumed = await createSynchronizer().synchronize();
  assert.ok(resumed.pagesProcessed > 0);
  assert.equal(resumed.run.state, "completed");
  assert.equal(resumed.admittedAssetCount, 2);
  assert.deepEqual(
    resumed.admittedAssets.map((item) => item.sourceAssetId).sort(),
    ["inventory-b", "inventory-c"],
  );
  assert.equal(resumed.admittedAssetsTruncated, false);
  assert.equal(
    projectionEvents.some((event) => event.phase === "run_completed"),
    true,
  );
  assert.equal(resumed.run.observedAssetCount, 4);
  assert.equal(resumed.source.activeAssets, 3);
  assert.equal(resumed.source.unsupportedAssets, 1);
  assert.equal(resumed.coverage.state, "complete");
  assert.deepEqual(
    resumed.coverage.lanes.find((lane) => lane.visibility === "locked"),
    {
      accessState: "available",
      inventoryState: "completed",
      observedItemCount: 1,
      selected: true,
      visibility: "locked",
    },
  );
  assert.equal(
    [...liveBridge.values()].some(
      (entry) => entry.sourceAssetId === "inventory-audio",
    ),
    false,
  );
  const initialRunId = interrupted.run.runId;
  assert.equal(resumed.run.runId, initialRunId);

  const [initialCounts] = await sql`
    SELECT
      (SELECT count(*)::int FROM immich_asset_projection
       WHERE source_id = 'synthetic-immich-primary') AS projections,
      (SELECT count(*)::int FROM media_job job
       JOIN immich_asset_projection projection
         ON projection.cimmich_asset_id = job.asset_id
       WHERE projection.source_id = 'synthetic-immich-primary') AS jobs
  `;
  assert.deepEqual(initialCounts, { jobs: 3, projections: 4 });

  const replacementProvider = createSynchronizer({
    configDigest: "8".repeat(64),
    maxAttempts: 3,
    operation: "detect_faces",
    toolVersion: "synthetic-inventory-provider-v2",
  });
  assert.deepEqual(await replacementProvider.ensureCurrentJobs(), {
    eligibleAssets: 3,
    ensuredJobs: 3,
  });
  assert.deepEqual(await replacementProvider.ensureCurrentJobs(), {
    eligibleAssets: 3,
    ensuredJobs: 3,
  });
  const [{ jobs: replacementJobs }] = await sql`
    SELECT count(*)::int AS jobs FROM media_job job
    JOIN immich_asset_projection projection
      ON projection.cimmich_asset_id = job.asset_id
    WHERE projection.source_id = 'synthetic-immich-primary'
      AND job.config_digest = ${"8".repeat(64)}
  `;
  assert.equal(replacementJobs, 3);

  const unchanged = await createSynchronizer().synchronize();
  assert.equal(unchanged.run.state, "completed");
  const [{ jobs: unchangedJobs }] = await sql`
    SELECT count(*)::int AS jobs FROM media_job job
    JOIN immich_asset_projection projection
      ON projection.cimmich_asset_id = job.asset_id
    WHERE projection.source_id = 'synthetic-immich-primary'
      AND job.config_digest = ${configDigest}
  `;
  assert.equal(unchangedJobs, 3);

  scenario = "changed-missing";
  const changed = await createSynchronizer().synchronize();
  assert.equal(changed.run.state, "completed");
  assert.equal(changed.source.activeAssets, 2);
  assert.equal(changed.source.missingAssets, 0);
  assert.equal(changed.source.suspectedMissingAssets, 1);
  const [firstAbsence] = await sql`
    SELECT projection.state AS projection_state, asset.state AS asset_state
    FROM immich_asset_projection projection
    JOIN asset ON asset.asset_id = projection.cimmich_asset_id
    WHERE projection.source_id = 'synthetic-immich-primary'
      AND projection.immich_asset_id = 'inventory-b'
  `;
  assert.deepEqual(firstAbsence, {
    asset_state: "active",
    projection_state: "suspected_missing",
  });
  const changedJobs = await sql`
    SELECT projection.immich_asset_id, job.input_revision, job.state,
      job.last_error_code
    FROM media_job job
    JOIN immich_asset_projection projection
      ON projection.cimmich_asset_id = job.asset_id
    WHERE projection.source_id = 'synthetic-immich-primary'
      AND job.config_digest = ${configDigest}
    ORDER BY projection.immich_asset_id, job.input_revision
  `;
  assert.equal(changedJobs.length, 4);
  assert.equal(
    changedJobs.find(
      (row) =>
        row.immich_asset_id === "inventory-a" &&
        row.input_revision === "a".repeat(64),
    ).state,
    "paused",
  );
  assert.equal(
    changedJobs.find((row) => row.immich_asset_id === "inventory-b")
      .last_error_code,
    "ASSET_NOT_VISIBLE",
  );

  const confirmedMissing = await createSynchronizer().synchronize();
  assert.equal(confirmedMissing.source.suspectedMissingAssets, 0);
  assert.equal(confirmedMissing.source.missingAssets, 1);
  const [secondAbsence] = await sql`
    SELECT projection.state AS projection_state, asset.state AS asset_state
    FROM immich_asset_projection projection
    JOIN asset ON asset.asset_id = projection.cimmich_asset_id
    WHERE projection.source_id = 'synthetic-immich-primary'
      AND projection.immich_asset_id = 'inventory-b'
  `;
  assert.deepEqual(secondAbsence, {
    asset_state: "missing",
    projection_state: "missing",
  });

  scenario = "reentry";
  const reentered = await createSynchronizer().synchronize();
  assert.equal(reentered.run.state, "completed");
  assert.equal(reentered.source.activeAssets, 3);
  assert.equal(reentered.source.missingAssets, 0);
  const [reentryJob] = await sql`
    SELECT job.state, job.last_error_code
    FROM media_job job
    JOIN immich_asset_projection projection
      ON projection.cimmich_asset_id = job.asset_id
    WHERE projection.source_id = 'synthetic-immich-primary'
      AND projection.immich_asset_id = 'inventory-b'
      AND job.config_digest = ${configDigest}
  `;
  assert.deepEqual(reentryJob, { last_error_code: null, state: "pending" });
  const [{ jobs: finalJobs }] = await sql`
    SELECT count(*)::int AS jobs FROM media_job job
    JOIN immich_asset_projection projection
      ON projection.cimmich_asset_id = job.asset_id
    WHERE projection.source_id = 'synthetic-immich-primary'
      AND job.config_digest = ${configDigest}
  `;
  assert.equal(finalJobs, 4);

  const partialAllLane = await createSynchronizer().synchronize({
    maxPages: 3,
  });
  assert.equal(partialAllLane.run.state, "processing");
  assert.deepEqual(partialAllLane.run.selectedVisibilities, [
    "timeline",
    "archive",
    "hidden",
    "locked",
  ]);
  assert.equal(
    partialAllLane.lanes.find((lane) => lane.visibility === "locked").state,
    "pending",
  );
  const scopeChangeCallBoundary = calls.length;
  const timelineOnly = await createSynchronizer().synchronize({
    visibilities: ["timeline"],
  });
  assert.equal(timelineOnly.run.state, "completed");
  assert.notEqual(timelineOnly.run.runId, partialAllLane.run.runId);
  assert.deepEqual(timelineOnly.run.selectedVisibilities, ["timeline"]);
  assert.equal(
    calls
      .slice(scopeChangeCallBoundary)
      .every((call) => call.visibility === "timeline"),
    true,
  );
  const [supersededScope] = await sql`
    SELECT run.state, run.last_error_code, snapshot.state AS snapshot_state
    FROM immich_inventory_run run
    JOIN source_snapshot snapshot ON snapshot.snapshot_id = run.snapshot_id
    WHERE run.run_id = ${partialAllLane.run.runId}
  `;
  assert.deepEqual(supersededScope, {
    last_error_code: "SCOPE_SUPERSEDED",
    snapshot_state: "incomplete",
    state: "failed",
  });
  const [preservedArchive] = await sql`
    SELECT state FROM immich_asset_projection
    WHERE source_id = 'synthetic-immich-primary'
      AND immich_asset_id = 'inventory-c'
  `;
  assert.equal(preservedArchive.state, "active");
  await assert.rejects(
    () => sql`
      SELECT * FROM begin_immich_inventory_run(
        'synthetic-immich-primary', '3.0.3', ${"9".repeat(64)}
      )
    `,
    /principal changed/,
  );

  const [currentRun] = await sql`
    SELECT run_id FROM immich_inventory_run
    WHERE source_id = 'synthetic-immich-primary' AND state = 'completed'
    ORDER BY completed_at DESC, run_id DESC
    LIMIT 1
  `;
  const documentImmichAssetId = "44444444-4444-4444-8444-444444444444";
  await sql`
    INSERT INTO immich_asset_projection (
      source_id, immich_asset_id, cimmich_asset_id, owner_digest,
      input_revision, checksum, asset_type, visibility, original_mime_type,
      capture_time, source_updated_at, width, height, duration_seconds,
      is_archived, is_favorite, is_offline, is_trashed, state,
      first_seen_run_id, last_seen_run_id
    )
    SELECT 'synthetic-immich-primary', ${documentImmichAssetId}, asset.asset_id,
      ${"8".repeat(64)}, ${"9".repeat(64)}, 'document-source-checksum',
      'image', 'timeline', asset.mime_type, asset.capture_time, now(),
      asset.width, asset.height, asset.duration_seconds, false, false, false,
      false, 'active', ${currentRun.run_id}, ${currentRun.run_id}
    FROM asset
    WHERE asset.asset_id = 'asset_service_fixture'
    ON CONFLICT DO NOTHING
  `;
  const documentsResponse = await fetch(
    `${apiRoot}/v1/documents?q=${encodeURIComponent("Synthetic source certificate")}`,
  );
  assert.equal(documentsResponse.status, 200);
  const documents = await documentsResponse.json();
  assert.equal(documents.items.length, 1);
  assert.equal(documents.items[0].source.assetId, documentImmichAssetId);
  assert.equal(
    documents.items[0].source.cimmichAssetId,
    "asset_service_fixture",
  );
  const evidenceResponse = await fetch(
    `${apiRoot}/v1/assets/evidence?sourceAssetId=${documentImmichAssetId}`,
  );
  assert.equal(evidenceResponse.status, 200);
  assert.equal(
    (await evidenceResponse.json()).sourceAssetId,
    documentImmichAssetId,
  );
  await sql`
    DELETE FROM immich_asset_projection
    WHERE source_id = 'synthetic-immich-primary'
      AND immich_asset_id = ${documentImmichAssetId}
  `;

  for (const visibility of ["timeline", "archive", "hidden", "locked"]) {
    assert.equal(
      calls.some((call) => call.visibility === visibility),
      true,
    );
  }
  process.stdout.write(
    `${JSON.stringify({
      assets: reentered.source.activeAssets,
      finalJobs,
      interruptedRunId: initialRunId,
      status: "PASS",
      unsupported: reentered.source.unsupportedAssets,
    })}\n`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
