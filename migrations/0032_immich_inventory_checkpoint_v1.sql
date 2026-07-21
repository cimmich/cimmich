BEGIN;

CREATE TABLE immich_inventory_source (
    source_id text PRIMARY KEY CHECK (length(btrim(source_id)) BETWEEN 1 AND 120),
    principal_digest text NOT NULL CHECK (principal_digest ~ '^[0-9a-f]{64}$'),
    companion_schema_version text NOT NULL,
    immich_version text NOT NULL,
    state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','disabled')),
    last_completed_run_id text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE immich_inventory_run (
    run_id text PRIMARY KEY,
    source_id text NOT NULL REFERENCES immich_inventory_source(source_id),
    snapshot_id text NOT NULL UNIQUE REFERENCES source_snapshot(snapshot_id),
    immich_version text NOT NULL,
    principal_digest text NOT NULL CHECK (principal_digest ~ '^[0-9a-f]{64}$'),
    state text NOT NULL DEFAULT 'processing' CHECK (
        state IN ('processing','completed','failed')
    ),
    observed_asset_count bigint NOT NULL DEFAULT 0 CHECK (observed_asset_count >= 0),
    page_count integer NOT NULL DEFAULT 0 CHECK (page_count >= 0),
    last_error_code text CHECK (
        last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{2,79}$'
    ),
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    CHECK ((state = 'processing') = (completed_at IS NULL))
);

CREATE UNIQUE INDEX immich_inventory_one_processing_run
    ON immich_inventory_run(source_id) WHERE state = 'processing';

ALTER TABLE immich_inventory_source
    ADD CONSTRAINT immich_inventory_source_last_run_fk
    FOREIGN KEY (last_completed_run_id) REFERENCES immich_inventory_run(run_id);

CREATE TABLE immich_inventory_lane (
    run_id text NOT NULL REFERENCES immich_inventory_run(run_id) ON DELETE CASCADE,
    visibility text NOT NULL CHECK (
        visibility IN ('timeline','archive','hidden','locked')
    ),
    state text NOT NULL DEFAULT 'pending' CHECK (
        state IN ('pending','processing','completed')
    ),
    cursor text NOT NULL DEFAULT '',
    page_count integer NOT NULL DEFAULT 0 CHECK (page_count >= 0),
    observed_item_count bigint NOT NULL DEFAULT 0 CHECK (observed_item_count >= 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, visibility),
    CHECK (state <> 'completed' OR cursor = '')
);

CREATE TABLE immich_inventory_page (
    run_id text NOT NULL,
    visibility text NOT NULL,
    cursor text NOT NULL,
    next_cursor text,
    page_digest text NOT NULL CHECK (page_digest ~ '^[0-9a-f]{64}$'),
    item_count integer NOT NULL CHECK (item_count BETWEEN 0 AND 1000),
    created_at timestamptz NOT NULL DEFAULT now(),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    PRIMARY KEY (run_id, visibility, cursor),
    FOREIGN KEY (run_id, visibility)
        REFERENCES immich_inventory_lane(run_id, visibility) ON DELETE CASCADE,
    CHECK (next_cursor IS NULL OR next_cursor <> cursor)
);

CREATE TABLE immich_asset_projection (
    source_id text NOT NULL REFERENCES immich_inventory_source(source_id),
    immich_asset_id text NOT NULL,
    cimmich_asset_id text UNIQUE REFERENCES asset(asset_id) ON DELETE SET NULL,
    owner_digest text NOT NULL CHECK (owner_digest ~ '^[0-9a-f]{64}$'),
    input_revision text NOT NULL CHECK (input_revision ~ '^[0-9a-f]{64}$'),
    checksum text NOT NULL,
    asset_type text NOT NULL CHECK (asset_type IN ('image','video','audio','other')),
    visibility text NOT NULL CHECK (
        visibility IN ('timeline','archive','hidden','locked')
    ),
    original_mime_type text,
    capture_time timestamptz NOT NULL,
    source_updated_at timestamptz NOT NULL,
    width integer CHECK (width IS NULL OR width >= 0),
    height integer CHECK (height IS NULL OR height >= 0),
    duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
    is_archived boolean NOT NULL DEFAULT false,
    is_favorite boolean NOT NULL DEFAULT false,
    is_offline boolean NOT NULL DEFAULT false,
    is_trashed boolean NOT NULL DEFAULT false,
    state text NOT NULL CHECK (
        state IN ('active','suspected_missing','missing','unsupported')
    ),
    first_seen_run_id text NOT NULL REFERENCES immich_inventory_run(run_id),
    last_seen_run_id text NOT NULL REFERENCES immich_inventory_run(run_id),
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    PRIMARY KEY (source_id, immich_asset_id),
    CHECK ((asset_type IN ('image','video')) = (cimmich_asset_id IS NOT NULL))
);

CREATE INDEX immich_asset_projection_current
    ON immich_asset_projection(source_id, state, visibility, immich_asset_id);
CREATE INDEX immich_asset_projection_last_seen
    ON immich_asset_projection(source_id, last_seen_run_id);

CREATE OR REPLACE FUNCTION begin_immich_inventory_run(
    p_source_id text,
    p_immich_version text,
    p_principal_digest text
) RETURNS immich_inventory_run LANGUAGE plpgsql AS $$
DECLARE
    v_source immich_inventory_source;
    v_run immich_inventory_run;
    v_run_id text;
    v_snapshot_id text;
BEGIN
    IF length(btrim(coalesce(p_source_id, ''))) NOT BETWEEN 1 AND 120
        OR length(btrim(coalesce(p_immich_version, ''))) NOT BETWEEN 1 AND 80
        OR p_principal_digest !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'invalid Immich inventory source identity'
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
        RETURN v_run;
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
        run_id, source_id, snapshot_id, immich_version, principal_digest
    ) VALUES (
        v_run_id, p_source_id, v_snapshot_id, p_immich_version,
        p_principal_digest
    ) RETURNING * INTO v_run;
    INSERT INTO immich_inventory_lane (run_id, visibility)
    SELECT v_run_id, visibility FROM unnest(
        ARRAY['timeline','archive','hidden','locked']::text[]
    ) AS visibility;
    UPDATE immich_inventory_source SET immich_version = p_immich_version,
        updated_at = now() WHERE source_id = p_source_id;
    RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION enqueue_media_job(
    p_asset_id text,
    p_operation text,
    p_tool_version text,
    p_config_digest text,
    p_input_revision text,
    p_max_attempts integer DEFAULT 3
) RETURNS media_job LANGUAGE plpgsql AS $$
DECLARE
    v_work_key text;
    v_job_id text;
    v_job media_job;
    v_receipt_digest text;
BEGIN
    IF p_operation NOT IN ('detect_faces','recognize_faces','detect_and_recognize') THEN
        RAISE EXCEPTION 'unsupported media job operation' USING ERRCODE = '22023';
    END IF;
    IF p_config_digest !~ '^[0-9a-f]{64}$' OR p_input_revision !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'media job digests must be lowercase SHA-256' USING ERRCODE = '22023';
    END IF;
    IF p_max_attempts < 1 OR p_max_attempts > 20 THEN
        RAISE EXCEPTION 'media job max attempts must be from 1 to 20' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM asset WHERE asset_id = p_asset_id AND state = 'active';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'active media job asset not found' USING ERRCODE = 'P0002';
    END IF;

    v_work_key := encode(digest(concat_ws(E'\x1f', p_asset_id, p_operation,
        p_tool_version, p_config_digest, p_input_revision), 'sha256'), 'hex');
    v_job_id := 'media_job_' || substr(v_work_key, 1, 40);
    PERFORM pg_advisory_xact_lock(hashtextextended(v_work_key, 0));

    SELECT * INTO v_job FROM media_job WHERE work_key = v_work_key FOR UPDATE;
    IF FOUND THEN
        IF v_job.state = 'paused' THEN
            UPDATE media_job SET state = 'pending', last_error_code = NULL,
                max_attempts = p_max_attempts, completed_at = NULL
            WHERE job_id = v_job.job_id RETURNING * INTO v_job;
            INSERT INTO media_job_event (
                event_id, job_id, event_kind, attempt_count, checkpoint_revision,
                public_details
            ) VALUES (
                'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
                v_job.job_id, 'resumed', v_job.attempt_count,
                v_job.checkpoint_revision, '{"reason":"asset_visible"}'::jsonb
            );
        ELSIF v_job.state = 'completed' THEN
            SELECT result_digest INTO v_receipt_digest
            FROM producer_receipt WHERE producer_receipt_id = v_job.result_receipt_id;
            IF v_receipt_digest <> v_job.result_digest THEN
                UPDATE media_job SET state = 'pending', result_receipt_id = NULL,
                    result_digest = NULL, completed_at = NULL,
                    last_error_code = 'RESULT_RECEIPT_INVALID', max_attempts = p_max_attempts
                WHERE job_id = v_job.job_id RETURNING * INTO v_job;
                INSERT INTO media_job_event (
                    event_id, job_id, event_kind, attempt_count,
                    checkpoint_revision, public_details
                ) VALUES (
                    'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
                    v_job.job_id, 'requeued', v_job.attempt_count,
                    v_job.checkpoint_revision,
                    '{"reason":"result_receipt_invalid"}'::jsonb
                );
            END IF;
        END IF;
        RETURN v_job;
    END IF;

    INSERT INTO media_job (
        job_id, work_key, asset_id, operation, tool_version, config_digest,
        input_revision, max_attempts
    ) VALUES (
        v_job_id, v_work_key, p_asset_id, p_operation, p_tool_version,
        p_config_digest, p_input_revision, p_max_attempts
    ) RETURNING * INTO v_job;
    INSERT INTO media_job_event (
        event_id, job_id, event_kind, attempt_count, checkpoint_revision
    ) VALUES (
        'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
        v_job.job_id, 'queued', 0, 0
    );
    RETURN v_job;
END;
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
          AND state IN ('suspected_missing','missing')
          AND cimmich_asset_id IS NOT NULL
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

CREATE VIEW immich_inventory_status AS
SELECT source.source_id, source.state, source.immich_version,
       source.last_completed_run_id,
       run.run_id AS processing_run_id, run.started_at AS processing_started_at,
       coalesce((SELECT count(*)::int FROM immich_asset_projection asset
         WHERE asset.source_id = source.source_id AND asset.state = 'active'), 0)
         AS active_assets,
       coalesce((SELECT count(*)::int FROM immich_asset_projection asset
         WHERE asset.source_id = source.source_id
           AND asset.state = 'suspected_missing'), 0) AS suspected_missing_assets,
       coalesce((SELECT count(*)::int FROM immich_asset_projection asset
         WHERE asset.source_id = source.source_id AND asset.state = 'missing'), 0)
         AS missing_assets,
       coalesce((SELECT count(*)::int FROM immich_asset_projection asset
         WHERE asset.source_id = source.source_id AND asset.state = 'unsupported'), 0)
         AS unsupported_assets
FROM immich_inventory_source source
LEFT JOIN immich_inventory_run run
  ON run.source_id = source.source_id AND run.state = 'processing';

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_immich_inventory_checkpoint_v1', 'system',
    'cimmich-immich-inventory-checkpoint', 'v1', now(), now(),
    encode(digest('cimmich-immich-inventory-checkpoint-v1', 'sha256'), 'hex'),
    'release-safe'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
    completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

COMMIT;
