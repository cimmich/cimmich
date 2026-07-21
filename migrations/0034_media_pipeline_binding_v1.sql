BEGIN;

CREATE TABLE media_pipeline_run (
    pipeline_run_id text PRIMARY KEY,
    work_key text NOT NULL UNIQUE CHECK (work_key ~ '^[0-9a-f]{64}$'),
    asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    input_revision text NOT NULL CHECK (input_revision ~ '^[0-9a-f]{64}$'),
    pipeline_config_digest text NOT NULL CHECK (pipeline_config_digest ~ '^[0-9a-f]{64}$'),
    detector_config_digest text NOT NULL CHECK (detector_config_digest ~ '^[0-9a-f]{64}$'),
    recognizer_config_digest text NOT NULL CHECK (recognizer_config_digest ~ '^[0-9a-f]{64}$'),
    vector_space_id text NOT NULL CHECK (length(vector_space_id) BETWEEN 1 AND 200),
    detection_job_id text NOT NULL REFERENCES media_job(job_id),
    detection_result_id text NOT NULL REFERENCES face_detection_result(detection_result_id),
    recognition_job_id text UNIQUE REFERENCES media_job(job_id),
    state text NOT NULL CHECK (
        state IN ('no_face','recognition_pending','recognition_failed','recognized')
    ),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    recognized_at timestamptz,
    CHECK ((state = 'no_face' AND recognition_job_id IS NULL)
        OR (state <> 'no_face' AND recognition_job_id IS NOT NULL)),
    CHECK ((state = 'recognized' AND recognized_at IS NOT NULL)
        OR (state <> 'recognized' AND recognized_at IS NULL)),
    UNIQUE (asset_id, input_revision, pipeline_config_digest)
);

CREATE INDEX media_pipeline_asset_history
    ON media_pipeline_run(asset_id, created_at DESC, pipeline_run_id DESC);
CREATE INDEX media_pipeline_recognition_pending
    ON media_pipeline_run(recognition_job_id)
    WHERE state = 'recognition_pending';

CREATE OR REPLACE FUNCTION claim_face_recognition_jobs(
    p_worker_id text,
    p_lease_seconds integer DEFAULT 300,
    p_limit integer DEFAULT 1
) RETURNS SETOF media_job LANGUAGE plpgsql AS $$
BEGIN
    IF nullif(btrim(p_worker_id), '') IS NULL THEN
        RAISE EXCEPTION 'face recognition worker id is required' USING ERRCODE = '22023';
    END IF;
    IF p_lease_seconds < 30 OR p_lease_seconds > 3600 OR p_limit < 1 OR p_limit > 100 THEN
        RAISE EXCEPTION 'invalid face recognition lease or batch limit' USING ERRCODE = '22023';
    END IF;

    WITH expired AS (
        UPDATE media_job
        SET state = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'pending' END,
            lease_owner = NULL, lease_expires_at = NULL,
            completed_at = CASE WHEN attempt_count >= max_attempts THEN now() ELSE NULL END,
            last_error_code = 'WORKER_LEASE_EXPIRED'
        WHERE operation = 'recognize_faces' AND state = 'processing'
            AND lease_expires_at < now()
        RETURNING *
    )
    INSERT INTO media_job_event (
        event_id, job_id, event_kind, attempt_count, checkpoint_revision, public_details
    ) SELECT
        'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
        job_id, CASE WHEN state = 'failed' THEN 'failed' ELSE 'lease_expired' END,
        attempt_count, checkpoint_revision,
        jsonb_build_object('errorCode', 'WORKER_LEASE_EXPIRED')
    FROM expired;

    RETURN QUERY
    WITH claimable AS (
        SELECT job.job_id
        FROM media_job job
        JOIN media_pipeline_run pipeline ON pipeline.recognition_job_id = job.job_id
            AND pipeline.state = 'recognition_pending'
        WHERE job.state = 'pending' AND job.operation = 'recognize_faces'
        ORDER BY job.requested_at, job.job_id
        FOR UPDATE OF job SKIP LOCKED
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
            event_id, job_id, event_kind, attempt_count, checkpoint_revision, public_details
        ) SELECT
            'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
            job_id, 'leased', attempt_count, checkpoint_revision,
            jsonb_build_object('workerId', p_worker_id)
        FROM claimed
    )
    SELECT claimed.* FROM claimed;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_media_pipeline_binding()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.work_key <> OLD.work_key OR NEW.asset_id <> OLD.asset_id
        OR NEW.input_revision <> OLD.input_revision
        OR NEW.pipeline_config_digest <> OLD.pipeline_config_digest
        OR NEW.detector_config_digest <> OLD.detector_config_digest
        OR NEW.recognizer_config_digest <> OLD.recognizer_config_digest
        OR NEW.vector_space_id <> OLD.vector_space_id
        OR NEW.detection_job_id <> OLD.detection_job_id
        OR NEW.detection_result_id <> OLD.detection_result_id
        OR NEW.recognition_job_id IS DISTINCT FROM OLD.recognition_job_id THEN
        RAISE EXCEPTION 'media pipeline stage binding is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.state = 'recognized' AND NEW.state <> 'recognized' THEN
        RAISE EXCEPTION 'recognized media pipeline cannot regress' USING ERRCODE = '23514';
    END IF;
    IF OLD.state = 'recognition_failed' AND NEW.state <> 'recognition_failed' THEN
        RAISE EXCEPTION 'failed media pipeline requires a new work identity'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER media_pipeline_binding_guard
BEFORE UPDATE ON media_pipeline_run
FOR EACH ROW EXECUTE FUNCTION enforce_media_pipeline_binding();

COMMIT;
