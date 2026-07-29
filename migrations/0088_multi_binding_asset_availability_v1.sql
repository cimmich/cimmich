BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_multi_binding_asset_availability_v1', 'system',
    'cimmich-multi-binding-asset-availability', 'v1', now(), now(),
    encode(digest('cimmich.multi-binding-asset-availability.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

-- During completion, the disappearing UUID's source binding has not yet been
-- advanced to offline/missing. Availability must therefore be derived from a
-- different source binding or a projection observed in this exact run.
CREATE OR REPLACE FUNCTION cimmich_asset_available_after_immich_run(
    p_asset_id text,
    p_source_id text,
    p_run_id text
) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1
        FROM immich_asset_projection projection
        WHERE projection.cimmich_asset_id = p_asset_id
          AND projection.source_id = p_source_id
          AND projection.state = 'active'
          AND projection.last_seen_run_id = p_run_id
    ) OR EXISTS (
        SELECT 1
        FROM asset_source_binding binding
        WHERE binding.asset_id = p_asset_id
          AND binding.state = 'active'
          AND NOT (
              binding.source_kind = 'immich'
              AND binding.source_id = p_source_id
          )
    );
$$;

CREATE OR REPLACE FUNCTION complete_immich_inventory_run(p_run_id text)
RETURNS immich_inventory_run LANGUAGE plpgsql AS $$
DECLARE
    v_run immich_inventory_run;
    v_observed bigint;
BEGIN
    SELECT * INTO v_run FROM immich_inventory_run
    WHERE run_id = p_run_id FOR UPDATE;
    IF NOT FOUND OR v_run.state <> 'processing' THEN
        RAISE EXCEPTION 'processing Immich inventory run not found'
            USING ERRCODE = '55000';
    END IF;
    IF EXISTS (
        SELECT 1 FROM immich_inventory_lane
        WHERE run_id = p_run_id AND state <> 'completed'
    ) THEN
        RAISE EXCEPTION 'Immich inventory lanes are incomplete'
            USING ERRCODE = '23514';
    END IF;

    WITH absent AS (
        UPDATE immich_asset_projection SET state = CASE
            WHEN state = 'suspected_missing' THEN 'missing'
            ELSE 'suspected_missing'
        END
        WHERE source_id = v_run.source_id AND state <> 'missing'
          AND last_seen_run_id <> p_run_id
        RETURNING cimmich_asset_id
    ), paused AS (
        UPDATE media_job job SET state = 'paused',
            attempt_count = CASE WHEN job.state = 'processing'
                THEN greatest(job.attempt_count - 1, 0) ELSE job.attempt_count END,
            lease_owner = NULL, lease_expires_at = NULL,
            last_error_code = 'ASSET_NOT_VISIBLE'
        FROM absent
        WHERE absent.cimmich_asset_id IS NOT NULL
          AND job.asset_id = absent.cimmich_asset_id
          AND job.state IN ('pending','processing')
          AND NOT cimmich_asset_available_after_immich_run(
              absent.cimmich_asset_id, v_run.source_id, p_run_id
          )
        RETURNING job.*
    )
    INSERT INTO media_job_event (
        event_id, job_id, event_kind, attempt_count, checkpoint_revision,
        public_details
    ) SELECT
        'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
        job_id, 'paused', attempt_count, checkpoint_revision,
        '{"reason":"asset_not_visible"}'::jsonb
    FROM paused;

    UPDATE asset SET state = 'missing'
    WHERE asset_id IN (
        SELECT cimmich_asset_id FROM immich_asset_projection
        WHERE source_id = v_run.source_id
          AND state = 'missing'
          AND cimmich_asset_id IS NOT NULL
    )
      AND NOT cimmich_asset_available_after_immich_run(
          asset_id, v_run.source_id, p_run_id
      );
    SELECT count(*) INTO v_observed FROM immich_asset_projection
    WHERE source_id = v_run.source_id AND last_seen_run_id = p_run_id;
    UPDATE source_snapshot SET state = 'complete', completed_at = now(),
        declared_asset_count = v_observed, observed_asset_count = v_observed
    WHERE snapshot_id = v_run.snapshot_id;
    UPDATE immich_inventory_run SET state = 'completed', completed_at = now(),
        observed_asset_count = v_observed,
        page_count = (SELECT coalesce(sum(page_count), 0)::int
            FROM immich_inventory_lane WHERE run_id = p_run_id)
    WHERE run_id = p_run_id RETURNING * INTO v_run;
    UPDATE immich_inventory_source SET last_completed_run_id = p_run_id,
        updated_at = now() WHERE source_id = v_run.source_id;
    RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION complete_scoped_immich_inventory_run(p_run_id text)
RETURNS immich_inventory_run LANGUAGE plpgsql AS $$
DECLARE
    v_run immich_inventory_run;
    v_observed bigint;
BEGIN
    SELECT * INTO v_run FROM immich_inventory_run
      WHERE run_id = p_run_id FOR UPDATE;
    IF NOT FOUND OR v_run.state <> 'processing' THEN
      RAISE EXCEPTION 'processing Immich inventory run not found'
        USING ERRCODE = '55000';
    END IF;
    IF EXISTS (
      SELECT 1 FROM immich_inventory_lane
      WHERE run_id = p_run_id AND visibility = ANY(v_run.selected_visibilities)
        AND state <> 'completed'
    ) THEN
      RAISE EXCEPTION 'Immich inventory selected lanes are incomplete'
        USING ERRCODE = '23514';
    END IF;

    WITH absent AS (
      UPDATE immich_asset_projection SET state = CASE
        WHEN state = 'suspected_missing' THEN 'missing' ELSE 'suspected_missing' END
      WHERE source_id = v_run.source_id AND state <> 'missing'
        AND visibility = ANY(v_run.selected_visibilities)
        AND last_seen_run_id <> p_run_id
      RETURNING cimmich_asset_id
    ), paused AS (
      UPDATE media_job job SET state = 'paused',
        attempt_count = CASE WHEN job.state = 'processing'
          THEN greatest(job.attempt_count - 1, 0) ELSE job.attempt_count END,
        lease_owner = NULL, lease_expires_at = NULL,
        last_error_code = 'ASSET_NOT_VISIBLE'
      FROM absent
      WHERE absent.cimmich_asset_id IS NOT NULL
        AND job.asset_id = absent.cimmich_asset_id
        AND job.state IN ('pending','processing')
        AND NOT cimmich_asset_available_after_immich_run(
          absent.cimmich_asset_id, v_run.source_id, p_run_id
        )
      RETURNING job.*
    )
    INSERT INTO media_job_event (
      event_id, job_id, event_kind, attempt_count, checkpoint_revision,
      public_details
    ) SELECT
      'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
      job_id, 'paused', attempt_count, checkpoint_revision,
      '{"reason":"asset_not_visible"}'::jsonb
    FROM paused;

    UPDATE asset SET state = 'missing'
    WHERE asset_id IN (
      SELECT cimmich_asset_id FROM immich_asset_projection
      WHERE source_id = v_run.source_id
        AND visibility = ANY(v_run.selected_visibilities)
        AND state = 'missing'
        AND cimmich_asset_id IS NOT NULL
    )
      AND NOT cimmich_asset_available_after_immich_run(
        asset_id, v_run.source_id, p_run_id
      );
    SELECT count(*) INTO v_observed FROM immich_asset_projection
      WHERE source_id = v_run.source_id AND last_seen_run_id = p_run_id;
    UPDATE source_snapshot SET state = 'complete', completed_at = now(),
      declared_asset_count = v_observed, observed_asset_count = v_observed
      WHERE snapshot_id = v_run.snapshot_id;
    UPDATE immich_inventory_run SET state = 'completed', completed_at = now(),
      observed_asset_count = v_observed,
      page_count = (SELECT coalesce(sum(page_count), 0)::int
        FROM immich_inventory_lane WHERE run_id = p_run_id)
      WHERE run_id = p_run_id RETURNING * INTO v_run;
    UPDATE immich_inventory_source SET last_completed_run_id = p_run_id,
      updated_at = now() WHERE source_id = v_run.source_id;
    RETURN v_run;
END;
$$;

-- Repair only the exact invariant violated before this migration: an asset
-- cannot be missing while at least one source binding is active.
UPDATE asset
SET state = 'active'
WHERE state = 'missing'
  AND EXISTS (
      SELECT 1
      FROM asset_source_binding binding
      WHERE binding.asset_id = asset.asset_id
        AND binding.state = 'active'
  );

COMMIT;
