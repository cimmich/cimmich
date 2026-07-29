const repairReceiptId = "receipt_cimmich_inventory_asset_split_repair_v1";

const requiredText = (value, label, maximum = 200) => {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`Inventory asset-split repair requires ${label}`);
  }
  return normalized;
};

const createMappingSql = `
  CREATE TEMP TABLE inventory_asset_split_repair_map
  ON COMMIT DROP AS
  WITH selected_run AS (
    SELECT run_id, source_id, started_at, completed_at
    FROM immich_inventory_run
    WHERE run_id = $1 AND source_id = $2 AND state = 'completed'
  ), candidates AS (
    SELECT
      link.content_id,
      max(link.asset_id) FILTER (
        WHERE link.asset_id =
          'asset_content_' || substr(encode(digest(
            'sha256' || E'\\x1f' || fingerprint.content_digest,
            'sha256'
          ), 'hex'), 1, 40)
      ) AS duplicate_asset,
      max(link.asset_id) FILTER (
        WHERE link.asset_id <>
          'asset_content_' || substr(encode(digest(
            'sha256' || E'\\x1f' || fingerprint.content_digest,
            'sha256'
          ), 'hex'), 1, 40)
      ) AS canonical_asset,
      count(DISTINCT link.asset_id)::integer AS asset_count,
      count(*) FILTER (
        WHERE link.asset_id =
          'asset_content_' || substr(encode(digest(
            'sha256' || E'\\x1f' || fingerprint.content_digest,
            'sha256'
          ), 'hex'), 1, 40)
          AND asset.created_at BETWEEN run.started_at AND run.completed_at
          AND asset.state = 'active'
      )::integer AS generated_in_run,
      count(*) FILTER (
        WHERE link.asset_id <>
          'asset_content_' || substr(encode(digest(
            'sha256' || E'\\x1f' || fingerprint.content_digest,
            'sha256'
          ), 'hex'), 1, 40)
          AND asset.created_at < run.started_at
          AND asset.state = 'active'
      )::integer AS preexisting_assets
    FROM asset_content_link link
    JOIN asset ON asset.asset_id = link.asset_id
    JOIN media_content_fingerprint fingerprint
      ON fingerprint.content_id = link.content_id
     AND fingerprint.hash_algorithm = 'sha256'
     AND fingerprint.verification = 'byte_verified'
    CROSS JOIN selected_run run
    WHERE link.state = 'active'
    GROUP BY link.content_id
  )
  SELECT content_id, duplicate_asset, canonical_asset
  FROM candidates
  WHERE asset_count = 2
    AND generated_in_run = 1
    AND preexisting_assets = 1
    AND duplicate_asset IS NOT NULL
    AND canonical_asset IS NOT NULL
`;

const forbiddenAssetReferences = [
  ["asset_owner_summary_revision", "asset_id"],
  ["asset_source_revision", "asset_id"],
  ["asset_source_revision_head", "asset_id"],
  ["body_detection_result", "asset_id"],
  ["body_observation", "asset_id"],
  ["capture_context_member_event", "asset_id"],
  ["cimmich_document", "source_asset_id"],
  ["context_asset_link", "asset_id"],
  ["context_entity", "cover_asset_id"],
  ["face_detection_result", "asset_id"],
  ["face_observation", "asset_id"],
  ["identity_audit_item", "asset_id"],
  ["identity_audit_item", "suggested_reference_asset_id"],
  ["immich_face_projection", "cimmich_asset_id"],
  ["immich_onboarding_review_item", "cimmich_asset_id"],
  ["manual_context_observation", "asset_id"],
  ["manual_context_tag", "asset_id"],
  ["manual_face_recognition_request", "asset_id"],
  ["manual_head_observation", "asset_id"],
  ["manual_photo_context_operation", "asset_id"],
  ["manual_subject_presence_operation", "asset_id"],
  ["manual_subject_tag_operation", "asset_id"],
  ["media_pipeline_run", "asset_id"],
  ["observation_correction_operation", "asset_id"],
  ["person", "cover_asset_id"],
  ["person_presentation_media", "asset_id"],
  ["pet_document_link", "asset_id"],
  ["pet_match_observation", "asset_id"],
  ["presence_tag", "asset_id"],
  ["xmp_sidecar_face_evidence", "asset_id"],
];

const inspectPreparedMapping = async (sql, sourceId) => {
  const [summary] = await sql`
    SELECT
      count(*)::integer AS split_assets,
      count(DISTINCT map.content_id)::integer AS split_contents,
      coalesce(sum((
        SELECT count(*) FROM immich_asset_projection projection
        WHERE projection.source_id = ${sourceId}
          AND projection.cimmich_asset_id = map.duplicate_asset
      )), 0)::integer AS projections,
      coalesce(sum((
        SELECT count(*) FROM asset_source_binding binding
        WHERE binding.source_kind = 'immich'
          AND binding.source_id = ${sourceId}
          AND binding.asset_id = map.duplicate_asset
      )), 0)::integer AS source_bindings,
      coalesce(sum((
        SELECT count(*) FROM media_job job
        WHERE job.asset_id = map.duplicate_asset
      )), 0)::integer AS media_jobs,
      coalesce(sum((
        SELECT count(*) FROM face_observation face
        WHERE face.asset_id = map.canonical_asset AND face.state = 'valid'
      )), 0)::integer AS preserved_faces
    FROM inventory_asset_split_repair_map map
  `;
  return {
    mediaJobs: Number(summary.media_jobs),
    preservedFaces: Number(summary.preserved_faces),
    projections: Number(summary.projections),
    sourceBindings: Number(summary.source_bindings),
    splitAssets: Number(summary.split_assets),
    splitContents: Number(summary.split_contents),
  };
};

const assertSafeMapping = async (sql, sourceId) => {
  for (const [table, column] of forbiddenAssetReferences) {
    const [row] = await sql.unsafe(
      `SELECT count(*)::integer AS count
       FROM ${table} target
       JOIN inventory_asset_split_repair_map map
         ON target.${column} = map.duplicate_asset`,
    );
    if (Number(row.count) !== 0) {
      throw new Error(
        "Inventory asset-split repair found derived evidence on a duplicate asset",
      );
    }
  }
  const [invalidJobs] = await sql`
    SELECT count(*)::integer AS count
    FROM media_job job
    JOIN inventory_asset_split_repair_map map
      ON map.duplicate_asset = job.asset_id
    WHERE job.state <> 'pending'
       OR job.attempt_count <> 0
       OR job.checkpoint_stage <> 'queued'
       OR job.checkpoint_revision <> 0
  `;
  const [foreignBindings] = await sql`
    SELECT count(*)::integer AS count
    FROM asset_source_binding binding
    JOIN inventory_asset_split_repair_map map
      ON map.duplicate_asset = binding.asset_id
    WHERE binding.source_kind <> 'immich'
       OR binding.source_id <> ${sourceId}
  `;
  const [foreignProjections] = await sql`
    SELECT count(*)::integer AS count
    FROM immich_asset_projection projection
    JOIN inventory_asset_split_repair_map map
      ON map.duplicate_asset = projection.cimmich_asset_id
    WHERE projection.source_id <> ${sourceId}
  `;
  if (
    Number(invalidJobs.count) !== 0 ||
    Number(foreignBindings.count) !== 0 ||
    Number(foreignProjections.count) !== 0
  ) {
    throw new Error(
      "Inventory asset-split repair found non-inventory state on a duplicate asset",
    );
  }
};

export const repairInventoryAssetSplits = async ({
  apply = false,
  runId,
  sourceId,
  sql,
}) => {
  if (!sql || typeof sql.begin !== "function") {
    throw new Error("Inventory asset-split repair requires a database");
  }
  const selectedRunId = requiredText(runId, "runId");
  const selectedSourceId = requiredText(sourceId, "sourceId", 120);
  return sql.begin(async (transaction) => {
    await transaction`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`inventory-asset-split-repair:${selectedRunId}`}, 0)
      )
    `;
    await transaction.unsafe(createMappingSql, [
      selectedRunId,
      selectedSourceId,
    ]);
    const before = await inspectPreparedMapping(transaction, selectedSourceId);
    await assertSafeMapping(transaction, selectedSourceId);
    if (!apply || before.splitAssets === 0) {
      return {
        applied: false,
        before,
        schemaVersion: "cimmich.inventory-asset-split-repair.v1",
      };
    }

    await transaction`
      INSERT INTO producer_receipt (
        producer_receipt_id, producer_kind, producer_name, producer_version,
        started_at, completed_at, result_digest, privacy_class
      ) VALUES (
        ${repairReceiptId}, 'system',
        'cimmich-inventory-asset-split-repair', 'v1', now(), now(),
        encode(digest('cimmich.inventory-asset-split-repair.v1', 'sha256'), 'hex'),
        'private'
      )
      ON CONFLICT (producer_receipt_id) DO UPDATE SET
        completed_at = excluded.completed_at,
        result_digest = excluded.result_digest
    `;
    const pausedJobs = await transaction`
      WITH paused AS (
        UPDATE media_job job SET
          state = 'paused',
          lease_owner = NULL,
          lease_expires_at = NULL
        FROM inventory_asset_split_repair_map map
        WHERE job.asset_id = map.duplicate_asset
          AND job.state = 'pending'
        RETURNING job.job_id, job.attempt_count, job.checkpoint_revision
      )
      INSERT INTO media_job_event (
        event_id, job_id, event_kind, attempt_count,
        checkpoint_revision, public_details
      )
      SELECT
        'event_inventory_split_repair_' ||
          substr(encode(digest(job_id, 'sha256'), 'hex'), 1, 40),
        job_id, 'paused', attempt_count, checkpoint_revision,
        '{"reason":"inventory_asset_split_repaired"}'::jsonb
      FROM paused
      ON CONFLICT (event_id) DO NOTHING
      RETURNING job_id
    `;
    const movedProjections = await transaction`
      UPDATE immich_asset_projection projection SET
        cimmich_asset_id = map.canonical_asset
      FROM inventory_asset_split_repair_map map
      WHERE projection.source_id = ${selectedSourceId}
        AND projection.cimmich_asset_id = map.duplicate_asset
      RETURNING projection.immich_asset_id
    `;
    const movedBindings = await transaction`
      WITH moved AS (
        UPDATE asset_source_binding binding SET
          asset_id = map.canonical_asset,
          content_id = map.content_id,
          last_seen_at = now()
        FROM inventory_asset_split_repair_map map
        WHERE binding.source_kind = 'immich'
          AND binding.source_id = ${selectedSourceId}
          AND binding.asset_id = map.duplicate_asset
        RETURNING binding.binding_id, binding.asset_id, binding.content_id,
          binding.input_revision
      )
      INSERT INTO asset_source_binding_event (
        event_id, binding_id, asset_id, content_id, input_revision,
        event_kind, producer_receipt_id
      )
      SELECT
        'source_binding_event_' || substr(encode(digest(
          binding_id || E'\x1f' || asset_id || E'\x1f' ||
          coalesce(input_revision, '') || E'\x1fmoved',
          'sha256'
        ), 'hex'), 1, 40),
        binding_id, asset_id, content_id, input_revision, 'moved',
        ${repairReceiptId}
      FROM moved
      ON CONFLICT (binding_id, asset_id, input_revision, event_kind) DO NOTHING
      RETURNING binding_id
    `;
    const supersededLinks = await transaction`
      UPDATE asset_content_link link SET state = 'superseded'
      FROM inventory_asset_split_repair_map map
      WHERE link.asset_id = map.duplicate_asset
        AND link.content_id = map.content_id
        AND link.state = 'active'
      RETURNING link.asset_id
    `;
    const tombstonedAssets = await transaction`
      UPDATE asset duplicate SET state = 'tombstoned'
      FROM inventory_asset_split_repair_map map
      WHERE duplicate.asset_id = map.duplicate_asset
        AND duplicate.state = 'active'
      RETURNING duplicate.asset_id
    `;
    const [remaining] = await transaction`
      SELECT count(*)::integer AS count
      FROM inventory_asset_split_repair_map map
      JOIN asset_content_link link
        ON link.asset_id = map.duplicate_asset
       AND link.content_id = map.content_id
       AND link.state = 'active'
    `;
    if (Number(remaining.count) !== 0) {
      throw new Error("Inventory asset-split repair did not converge");
    }
    return {
      applied: true,
      before,
      movedBindings: movedBindings.length,
      movedProjections: movedProjections.length,
      pausedJobs: pausedJobs.length,
      schemaVersion: "cimmich.inventory-asset-split-repair.v1",
      supersededLinks: supersededLinks.length,
      tombstonedAssets: tombstonedAssets.length,
    };
  });
};
