BEGIN;

ALTER TABLE immich_inventory_run
  ALTER COLUMN catalogue_includes_deleted SET DEFAULT false;

DROP FUNCTION begin_scoped_immich_inventory_run(text, text, text, text[]);

CREATE FUNCTION begin_scoped_immich_inventory_run(
    p_source_id text,
    p_immich_version text,
    p_principal_digest text,
    p_visibilities text[],
    p_catalogue_includes_deleted boolean
) RETURNS immich_inventory_run LANGUAGE plpgsql AS $$
DECLARE
    v_source immich_inventory_source;
    v_run immich_inventory_run;
    v_run_id text;
    v_snapshot_id text;
    v_sorted text[];
    v_observed bigint;
BEGIN
    SELECT array_agg(item ORDER BY array_position(
      ARRAY['timeline','archive','hidden','locked']::text[], item
    )) INTO v_sorted FROM (SELECT DISTINCT unnest(p_visibilities) AS item) items;
    IF length(btrim(coalesce(p_source_id, ''))) NOT BETWEEN 1 AND 120
      OR length(btrim(coalesce(p_immich_version, ''))) NOT BETWEEN 1 AND 80
      OR p_principal_digest !~ '^[0-9a-f]{64}$'
      OR p_catalogue_includes_deleted IS NULL
      OR v_sorted IS NULL OR cardinality(v_sorted) NOT BETWEEN 1 AND 4
      OR NOT (v_sorted <@ ARRAY['timeline','archive','hidden','locked']::text[]) THEN
      RAISE EXCEPTION 'invalid scoped Immich inventory source identity'
        USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_source_id, 0));
    SELECT * INTO v_source FROM immich_inventory_source
      WHERE source_id = p_source_id FOR UPDATE;
    IF FOUND AND v_source.principal_digest <> p_principal_digest THEN
      RAISE EXCEPTION 'Immich inventory source principal changed'
        USING ERRCODE = '23514';
    END IF;
    IF NOT FOUND THEN
      INSERT INTO immich_inventory_source (
        source_id, principal_digest, companion_schema_version, immich_version
      ) VALUES (
        p_source_id, p_principal_digest, 'cimmich.immich-companion.v1',
        p_immich_version
      ) RETURNING * INTO v_source;
    ELSIF v_source.state <> 'active' THEN
      RAISE EXCEPTION 'Immich inventory source is disabled'
        USING ERRCODE = '55000';
    END IF;

    SELECT * INTO v_run FROM immich_inventory_run
      WHERE source_id = p_source_id AND state = 'processing' FOR UPDATE;
    IF FOUND THEN
      IF v_run.principal_digest <> p_principal_digest
        OR v_run.immich_version <> p_immich_version THEN
        RAISE EXCEPTION 'processing Immich inventory source changed'
          USING ERRCODE = '23514';
      END IF;
      IF v_run.selected_visibilities = v_sorted
        AND v_run.catalogue_includes_deleted = p_catalogue_includes_deleted THEN
        RETURN v_run;
      END IF;

      SELECT count(*) INTO v_observed FROM immich_asset_projection
        WHERE source_id = p_source_id AND last_seen_run_id = v_run.run_id;
      UPDATE source_snapshot SET state = 'incomplete', completed_at = now(),
        declared_asset_count = NULL, observed_asset_count = v_observed
        WHERE snapshot_id = v_run.snapshot_id;
      UPDATE immich_inventory_run SET state = 'failed', completed_at = now(),
        observed_asset_count = v_observed,
        last_error_code = CASE
          WHEN v_run.catalogue_includes_deleted <> p_catalogue_includes_deleted
            THEN 'CATALOGUE_MODE_SUPERSEDED'
          ELSE 'SCOPE_SUPERSEDED'
        END
        WHERE run_id = v_run.run_id;
    END IF;

    v_run_id := 'immich_inventory_run_' || replace(gen_random_uuid()::text, '-', '');
    v_snapshot_id := 'snapshot_' || v_run_id;
    INSERT INTO source_snapshot (
      snapshot_id, input_schema_version, source_digest, locator_root_token,
      started_at, completed_at, observed_asset_count, state, privacy_class
    ) VALUES (
      v_snapshot_id, 'cimmich.immich-companion.v1',
      encode(digest(p_source_id || E'\x1f' || v_run_id, 'sha256'), 'hex'),
      p_source_id, now(), now(), 0, 'open', 'private'
    );
    INSERT INTO immich_inventory_run (
      run_id, source_id, snapshot_id, immich_version, principal_digest,
      selected_visibilities, catalogue_includes_deleted
    ) VALUES (
      v_run_id, p_source_id, v_snapshot_id, p_immich_version,
      p_principal_digest, v_sorted, p_catalogue_includes_deleted
    ) RETURNING * INTO v_run;
    INSERT INTO immich_inventory_lane (run_id, visibility, state)
      SELECT v_run_id, visibility,
        CASE WHEN visibility = ANY(v_sorted) THEN 'pending' ELSE 'completed' END
      FROM unnest(ARRAY['timeline','archive','hidden','locked']::text[])
        AS visibility;
    UPDATE immich_inventory_source SET immich_version = p_immich_version,
      updated_at = now() WHERE source_id = p_source_id;
    RETURN v_run;
END;
$$;

-- Keep pre-145 inventory callers operable, but classify them as ordinary
-- inventory. They cannot reconcile database absence without the explicit
-- deleted-row scope used by Archive Health.
CREATE FUNCTION begin_scoped_immich_inventory_run(
    p_source_id text,
    p_immich_version text,
    p_principal_digest text,
    p_visibilities text[]
) RETURNS immich_inventory_run LANGUAGE sql AS $$
  SELECT begin_scoped_immich_inventory_run(
    p_source_id, p_immich_version, p_principal_digest, p_visibilities, false
  );
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

    IF v_run.catalogue_includes_deleted THEN
      WITH absent AS (
        UPDATE immich_asset_projection SET state = CASE
          WHEN state = 'suspected_missing' THEN 'missing'
          ELSE 'suspected_missing' END
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
    END IF;

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

INSERT INTO producer_receipt (
  producer_receipt_id, producer_kind, producer_name, producer_version,
  started_at, completed_at, result_digest, privacy_class
) VALUES (
  'receipt_cimmich_catalogue_presence_inventory_mode_v1', 'system',
  'cimmich-catalogue-presence-inventory-mode', 'v1', now(), now(),
  encode(digest('cimmich.catalogue-presence-inventory-mode.v1', 'sha256'), 'hex'),
  'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
  completed_at = excluded.completed_at,
  result_digest = excluded.result_digest;

COMMIT;
