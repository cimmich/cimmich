BEGIN;

ALTER TABLE immich_inventory_lane
  ADD COLUMN access_state text NOT NULL DEFAULT 'unknown'
    CHECK (access_state IN ('unknown','available','elevated_session_required'));

CREATE FUNCTION begin_scoped_immich_inventory_run(
    p_source_id text,
    p_immich_version text,
    p_principal_digest text,
    p_visibilities text[]
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
      IF v_run.selected_visibilities = v_sorted THEN
        RETURN v_run;
      END IF;

      SELECT count(*) INTO v_observed FROM immich_asset_projection
        WHERE source_id = p_source_id AND last_seen_run_id = v_run.run_id;
      UPDATE source_snapshot SET state = 'incomplete', completed_at = now(),
        declared_asset_count = NULL, observed_asset_count = v_observed
        WHERE snapshot_id = v_run.snapshot_id;
      UPDATE immich_inventory_run SET state = 'failed', completed_at = now(),
        observed_asset_count = v_observed, last_error_code = 'SCOPE_SUPERSEDED'
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
      selected_visibilities
    ) VALUES (
      v_run_id, p_source_id, v_snapshot_id, p_immich_version,
      p_principal_digest, v_sorted
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

-- A process cannot survive a schema migration. Convert a pre-migration active
-- import into the exact resumable state instead of leaving a permanent unique
-- active-source lock after restart.
UPDATE immich_onboarding_run SET state = 'interrupted',
  progress = progress || jsonb_build_object(
    'lastErrorCode', 'IMMICH_ONBOARDING_IMPORT_INTERRUPTED'
  ),
  updated_at = now()
WHERE state = 'importing';

INSERT INTO producer_receipt (
  producer_receipt_id, producer_kind, producer_name, producer_version,
  started_at, completed_at, result_digest, privacy_class
) VALUES (
  'receipt_cimmich_immich_inventory_scope_rollover_v1', 'system',
  'cimmich-immich-inventory-scope-rollover', 'v1', now(), now(),
  encode(digest('cimmich.immich-inventory-scope-rollover.v1', 'sha256'), 'hex'),
  'release-safe'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
  completed_at = excluded.completed_at,
  result_digest = excluded.result_digest;

COMMIT;
