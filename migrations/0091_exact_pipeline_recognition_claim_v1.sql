BEGIN;

CREATE OR REPLACE FUNCTION claim_exact_face_recognition_jobs(
    p_worker_id text,
    p_tool_version text,
    p_config_digest text,
    p_vector_space_id text,
    p_lease_seconds integer DEFAULT 300,
    p_limit integer DEFAULT 1
) RETURNS SETOF media_job LANGUAGE plpgsql AS $$
BEGIN
    IF nullif(btrim(p_worker_id), '') IS NULL
        OR nullif(btrim(p_tool_version), '') IS NULL
        OR nullif(btrim(p_vector_space_id), '') IS NULL
        OR p_config_digest !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'exact face recognition provider binding is invalid'
          USING ERRCODE = '22023';
    END IF;
    IF p_lease_seconds < 30 OR p_lease_seconds > 3600
        OR p_limit < 1 OR p_limit > 100 THEN
        RAISE EXCEPTION 'invalid exact face recognition lease or batch limit'
          USING ERRCODE = '22023';
    END IF;

    WITH expired AS (
        UPDATE media_job job
        SET state = CASE
                WHEN job.attempt_count >= job.max_attempts THEN 'failed'
                ELSE 'pending'
            END,
            lease_owner = NULL,
            lease_expires_at = NULL,
            completed_at = CASE
                WHEN job.attempt_count >= job.max_attempts THEN now()
                ELSE NULL
            END,
            last_error_code = 'WORKER_LEASE_EXPIRED'
        FROM media_pipeline_run pipeline
        WHERE pipeline.recognition_job_id = job.job_id
          AND pipeline.state = 'recognition_pending'
          AND pipeline.recognizer_config_digest = p_config_digest
          AND pipeline.vector_space_id = p_vector_space_id
          AND job.operation = 'recognize_faces'
          AND job.tool_version = p_tool_version
          AND job.config_digest = p_config_digest
          AND job.state = 'processing'
          AND job.lease_expires_at < now()
        RETURNING job.*
    )
    INSERT INTO media_job_event (
        event_id, job_id, event_kind, attempt_count,
        checkpoint_revision, public_details
    ) SELECT
        'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
        job_id, CASE WHEN state = 'failed' THEN 'failed' ELSE 'lease_expired' END,
        attempt_count, checkpoint_revision,
        jsonb_build_object(
            'errorCode', 'WORKER_LEASE_EXPIRED',
            'claim', 'exact-provider'
        )
    FROM expired;

    RETURN QUERY
    WITH claimable AS (
        SELECT job.job_id
        FROM media_job job
        JOIN media_pipeline_run pipeline
          ON pipeline.recognition_job_id = job.job_id
          AND pipeline.state = 'recognition_pending'
          AND pipeline.recognizer_config_digest = p_config_digest
          AND pipeline.vector_space_id = p_vector_space_id
        WHERE job.state = 'pending'
          AND job.operation = 'recognize_faces'
          AND job.tool_version = p_tool_version
          AND job.config_digest = p_config_digest
        ORDER BY job.requested_at, job.job_id
        FOR UPDATE OF job SKIP LOCKED
        LIMIT p_limit
    ), claimed AS (
        UPDATE media_job job
        SET state = 'processing',
            attempt_count = job.attempt_count + 1,
            started_at = coalesce(job.started_at, now()),
            lease_owner = p_worker_id,
            lease_expires_at = now() + (p_lease_seconds * interval '1 second'),
            last_error_code = NULL
        FROM claimable
        WHERE job.job_id = claimable.job_id
        RETURNING job.*
    ), events AS (
        INSERT INTO media_job_event (
            event_id, job_id, event_kind, attempt_count,
            checkpoint_revision, public_details
        ) SELECT
            'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
            job_id, 'leased', attempt_count, checkpoint_revision,
            jsonb_build_object(
                'workerId', p_worker_id,
                'claim', 'exact-provider'
            )
        FROM claimed
    )
    SELECT claimed.* FROM claimed;
END;
$$;

COMMIT;
