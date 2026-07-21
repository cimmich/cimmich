BEGIN;

CREATE TABLE media_job (
    job_id text PRIMARY KEY,
    work_key text NOT NULL UNIQUE CHECK (work_key ~ '^[0-9a-f]{64}$'),
    asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    operation text NOT NULL CHECK (
        operation IN ('detect_faces','recognize_faces','detect_and_recognize')
    ),
    tool_version text NOT NULL CHECK (length(tool_version) BETWEEN 1 AND 200),
    config_digest text NOT NULL CHECK (config_digest ~ '^[0-9a-f]{64}$'),
    input_revision text NOT NULL CHECK (input_revision ~ '^[0-9a-f]{64}$'),
    state text NOT NULL DEFAULT 'pending' CHECK (
        state IN ('pending','processing','completed','failed','paused')
    ),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 20),
    checkpoint_stage text NOT NULL DEFAULT 'queued' CHECK (
        checkpoint_stage IN (
            'queued','inventory_verified','observations_recorded',
            'recognition_recorded','projection_ready'
        )
    ),
    checkpoint_revision integer NOT NULL DEFAULT 0 CHECK (checkpoint_revision >= 0),
    checkpoint_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    checkpoint_digest text CHECK (
        checkpoint_digest IS NULL OR checkpoint_digest ~ '^[0-9a-f]{64}$'
    ),
    lease_owner text,
    lease_expires_at timestamptz,
    last_error_code text CHECK (
        last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{2,79}$'
    ),
    result_receipt_id text REFERENCES producer_receipt(producer_receipt_id),
    result_digest text CHECK (
        result_digest IS NULL OR result_digest ~ '^[0-9a-f]{64}$'
    ),
    requested_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    completed_at timestamptz,
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    CHECK (
        (state = 'processing' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR (state <> 'processing' AND lease_owner IS NULL AND lease_expires_at IS NULL)
    ),
    CHECK (
        (state = 'completed' AND result_receipt_id IS NOT NULL
            AND result_digest IS NOT NULL AND completed_at IS NOT NULL)
        OR state <> 'completed'
    ),
    CHECK (
        state <> 'failed' OR (last_error_code IS NOT NULL AND completed_at IS NOT NULL)
    )
);

CREATE INDEX media_job_claimable
    ON media_job(requested_at, job_id)
    WHERE state = 'pending';
CREATE INDEX media_job_expired_lease
    ON media_job(lease_expires_at, job_id)
    WHERE state = 'processing';
CREATE INDEX media_job_asset_history
    ON media_job(asset_id, requested_at DESC, job_id DESC);

CREATE TABLE media_job_event (
    event_id text PRIMARY KEY,
    job_id text NOT NULL REFERENCES media_job(job_id) ON DELETE CASCADE,
    event_kind text NOT NULL CHECK (
        event_kind IN (
            'queued','requeued','leased','checkpointed','retry_scheduled',
            'lease_expired','completed','failed','paused','resumed'
        )
    ),
    attempt_count integer NOT NULL CHECK (attempt_count >= 0),
    checkpoint_revision integer NOT NULL CHECK (checkpoint_revision >= 0),
    public_details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1
);

CREATE INDEX media_job_event_history
    ON media_job_event(job_id, created_at, event_id);

CREATE OR REPLACE FUNCTION media_job_stage_rank(p_stage text)
RETURNS integer LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT CASE p_stage
        WHEN 'queued' THEN 0
        WHEN 'inventory_verified' THEN 1
        WHEN 'observations_recorded' THEN 2
        WHEN 'recognition_recorded' THEN 3
        WHEN 'projection_ready' THEN 4
    END;
$$;

CREATE OR REPLACE FUNCTION enforce_media_job_completion_receipt()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_receipt_digest text;
BEGIN
    IF NEW.state = 'completed' THEN
        SELECT result_digest INTO v_receipt_digest
        FROM producer_receipt
        WHERE producer_receipt_id = NEW.result_receipt_id;
        IF v_receipt_digest IS NULL OR v_receipt_digest <> NEW.result_digest THEN
            RAISE EXCEPTION 'media job completion receipt is missing or mismatched'
                USING ERRCODE = '23514';
        END IF;
        IF media_job_stage_rank(NEW.checkpoint_stage) = 0 THEN
            RAISE EXCEPTION 'media job cannot complete without a durable checkpoint'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER media_job_completion_receipt_guard
BEFORE INSERT OR UPDATE ON media_job
FOR EACH ROW EXECUTE FUNCTION enforce_media_job_completion_receipt();

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
        IF v_job.state = 'completed' THEN
            SELECT result_digest INTO v_receipt_digest
            FROM producer_receipt WHERE producer_receipt_id = v_job.result_receipt_id;
            IF v_receipt_digest = v_job.result_digest THEN
                RETURN v_job;
            END IF;
            UPDATE media_job SET state = 'pending', result_receipt_id = NULL,
                result_digest = NULL, completed_at = NULL,
                last_error_code = 'RESULT_RECEIPT_INVALID', max_attempts = p_max_attempts
            WHERE job_id = v_job.job_id RETURNING * INTO v_job;
            INSERT INTO media_job_event (
                event_id, job_id, event_kind, attempt_count, checkpoint_revision,
                public_details
            ) VALUES (
                'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
                v_job.job_id, 'requeued', v_job.attempt_count,
                v_job.checkpoint_revision, '{"reason":"result_receipt_invalid"}'::jsonb
            );
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

CREATE OR REPLACE FUNCTION claim_media_jobs(
    p_worker_id text,
    p_lease_seconds integer DEFAULT 300,
    p_limit integer DEFAULT 1
) RETURNS SETOF media_job LANGUAGE plpgsql AS $$
BEGIN
    IF nullif(btrim(p_worker_id), '') IS NULL THEN
        RAISE EXCEPTION 'media job worker id is required' USING ERRCODE = '22023';
    END IF;
    IF p_lease_seconds < 30 OR p_lease_seconds > 3600 OR p_limit < 1 OR p_limit > 100 THEN
        RAISE EXCEPTION 'invalid media job lease or batch limit' USING ERRCODE = '22023';
    END IF;

    WITH expired AS (
        UPDATE media_job
        SET state = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'pending' END,
            lease_owner = NULL, lease_expires_at = NULL,
            completed_at = CASE WHEN attempt_count >= max_attempts THEN now() ELSE NULL END,
            last_error_code = 'WORKER_LEASE_EXPIRED'
        WHERE state = 'processing' AND lease_expires_at < now()
        RETURNING *
    )
    INSERT INTO media_job_event (
        event_id, job_id, event_kind, attempt_count, checkpoint_revision,
        public_details
    ) SELECT
        'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
        job_id, CASE WHEN state = 'failed' THEN 'failed' ELSE 'lease_expired' END,
        attempt_count, checkpoint_revision,
        jsonb_build_object('errorCode', 'WORKER_LEASE_EXPIRED')
    FROM expired;

    RETURN QUERY
    WITH claimable AS (
        SELECT job_id FROM media_job
        WHERE state = 'pending'
        ORDER BY requested_at, job_id
        FOR UPDATE SKIP LOCKED
        LIMIT p_limit
    ), claimed AS (
        UPDATE media_job job
        SET state = 'processing', attempt_count = job.attempt_count + 1,
            started_at = coalesce(job.started_at, now()),
            lease_owner = p_worker_id,
            lease_expires_at = now() + (p_lease_seconds * interval '1 second'),
            last_error_code = NULL
        FROM claimable
        WHERE job.job_id = claimable.job_id
        RETURNING job.*
    ), events AS (
        INSERT INTO media_job_event (
            event_id, job_id, event_kind, attempt_count, checkpoint_revision,
            public_details
        ) SELECT
            'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
            job_id, 'leased', attempt_count, checkpoint_revision,
            jsonb_build_object('workerId', p_worker_id)
        FROM claimed
    )
    SELECT claimed.* FROM claimed;
END;
$$;

CREATE OR REPLACE FUNCTION checkpoint_media_job(
    p_job_id text,
    p_worker_id text,
    p_stage text,
    p_payload jsonb
) RETURNS media_job LANGUAGE plpgsql AS $$
DECLARE
    v_job media_job;
    v_checkpoint_digest text;
BEGIN
    IF media_job_stage_rank(p_stage) IS NULL THEN
        RAISE EXCEPTION 'invalid media job checkpoint' USING ERRCODE = '22023';
    END IF;
    v_checkpoint_digest := encode(digest(
        jsonb_build_object(
            'payload', coalesce(p_payload, '{}'::jsonb), 'stage', p_stage
        )::text,
        'sha256'
    ), 'hex');
    SELECT * INTO v_job FROM media_job WHERE job_id = p_job_id FOR UPDATE;
    IF NOT FOUND OR v_job.state <> 'processing' OR v_job.lease_owner <> p_worker_id
        OR v_job.lease_expires_at <= now() THEN
        RAISE EXCEPTION 'media job lease is not current' USING ERRCODE = '55000';
    END IF;
    IF v_job.checkpoint_digest = v_checkpoint_digest THEN
        RETURN v_job;
    END IF;
    IF media_job_stage_rank(p_stage) < media_job_stage_rank(v_job.checkpoint_stage) THEN
        RAISE EXCEPTION 'media job checkpoint cannot regress' USING ERRCODE = '23514';
    END IF;
    UPDATE media_job SET checkpoint_stage = p_stage,
        checkpoint_revision = checkpoint_revision + 1,
        checkpoint_payload = coalesce(p_payload, '{}'::jsonb),
        checkpoint_digest = v_checkpoint_digest
    WHERE job_id = p_job_id RETURNING * INTO v_job;
    INSERT INTO media_job_event (
        event_id, job_id, event_kind, attempt_count, checkpoint_revision,
        public_details
    ) VALUES (
        'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
        v_job.job_id, 'checkpointed', v_job.attempt_count,
        v_job.checkpoint_revision, jsonb_build_object('stage', p_stage)
    );
    RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION complete_media_job(
    p_job_id text,
    p_worker_id text,
    p_result_receipt_id text,
    p_result_digest text
) RETURNS media_job LANGUAGE plpgsql AS $$
DECLARE
    v_job media_job;
    v_receipt_digest text;
BEGIN
    SELECT * INTO v_job FROM media_job WHERE job_id = p_job_id FOR UPDATE;
    IF NOT FOUND OR v_job.state <> 'processing' OR v_job.lease_owner <> p_worker_id
        OR v_job.lease_expires_at <= now() THEN
        RAISE EXCEPTION 'media job lease is not current' USING ERRCODE = '55000';
    END IF;
    SELECT result_digest INTO v_receipt_digest FROM producer_receipt
    WHERE producer_receipt_id = p_result_receipt_id;
    IF v_receipt_digest IS NULL OR v_receipt_digest <> p_result_digest THEN
        RAISE EXCEPTION 'media job result receipt is missing or mismatched' USING ERRCODE = '23514';
    END IF;
    UPDATE media_job SET state = 'completed', result_receipt_id = p_result_receipt_id,
        result_digest = p_result_digest, completed_at = now(),
        lease_owner = NULL, lease_expires_at = NULL, last_error_code = NULL
    WHERE job_id = p_job_id RETURNING * INTO v_job;
    INSERT INTO media_job_event (
        event_id, job_id, event_kind, attempt_count, checkpoint_revision,
        public_details
    ) VALUES (
        'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
        v_job.job_id, 'completed', v_job.attempt_count,
        v_job.checkpoint_revision,
        jsonb_build_object('resultDigest', p_result_digest)
    );
    RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION fail_media_job(
    p_job_id text,
    p_worker_id text,
    p_error_code text
) RETURNS media_job LANGUAGE plpgsql AS $$
DECLARE
    v_job media_job;
    v_terminal boolean;
BEGIN
    IF p_error_code !~ '^[A-Z][A-Z0-9_]{2,79}$' THEN
        RAISE EXCEPTION 'media job requires a stable public error code' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_job FROM media_job WHERE job_id = p_job_id FOR UPDATE;
    IF NOT FOUND OR v_job.state <> 'processing' OR v_job.lease_owner <> p_worker_id THEN
        RAISE EXCEPTION 'media job lease is not current' USING ERRCODE = '55000';
    END IF;
    v_terminal := v_job.attempt_count >= v_job.max_attempts;
    UPDATE media_job SET state = CASE WHEN v_terminal THEN 'failed' ELSE 'pending' END,
        completed_at = CASE WHEN v_terminal THEN now() ELSE NULL END,
        lease_owner = NULL, lease_expires_at = NULL, last_error_code = p_error_code
    WHERE job_id = p_job_id RETURNING * INTO v_job;
    INSERT INTO media_job_event (
        event_id, job_id, event_kind, attempt_count, checkpoint_revision,
        public_details
    ) VALUES (
        'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
        v_job.job_id, CASE WHEN v_terminal THEN 'failed' ELSE 'retry_scheduled' END,
        v_job.attempt_count, v_job.checkpoint_revision,
        jsonb_build_object('errorCode', p_error_code)
    );
    RETURN v_job;
END;
$$;

CREATE VIEW media_job_status AS
SELECT
    count(*) FILTER (WHERE state = 'pending')::int AS pending,
    count(*) FILTER (WHERE state = 'processing')::int AS processing,
    count(*) FILTER (WHERE state = 'completed')::int AS completed,
    count(*) FILTER (WHERE state = 'failed')::int AS failed,
    count(*) FILTER (WHERE state = 'paused')::int AS paused,
    min(requested_at) FILTER (WHERE state = 'pending') AS oldest_pending_at,
    max(completed_at) FILTER (WHERE state = 'completed') AS latest_completed_at
FROM media_job;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_resumable_media_job_v1', 'system',
    'cimmich-resumable-media-job', 'v1', now(), now(),
    encode(digest('cimmich-resumable-media-job-v1', 'sha256'), 'hex'),
    'release-safe'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
    completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

COMMIT;
