BEGIN;

CREATE OR REPLACE FUNCTION claim_exact_existing_face_recognition_job(
    p_worker_id text,
    p_job_id text,
    p_lease_seconds integer DEFAULT 300
) RETURNS SETOF media_job LANGUAGE plpgsql AS $$
BEGIN
    IF nullif(btrim(p_worker_id), '') IS NULL OR nullif(btrim(p_job_id), '') IS NULL THEN
        RAISE EXCEPTION 'exact existing recognition worker and job ids are required'
          USING ERRCODE = '22023';
    END IF;
    IF p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
        RAISE EXCEPTION 'invalid exact existing recognition lease'
          USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    WITH claimable AS (
        SELECT job.job_id
        FROM media_job job
        JOIN media_pipeline_run pipeline ON pipeline.recognition_job_id = job.job_id
          AND pipeline.state = 'recognition_pending'
          AND pipeline.run_kind = 'existing_observation_set'
        WHERE job.job_id = p_job_id
          AND job.state = 'pending'
          AND job.operation = 'recognize_existing_faces'
        FOR UPDATE OF job SKIP LOCKED
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
            event_id, job_id, event_kind, attempt_count,
            checkpoint_revision, public_details
        ) SELECT
            'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
            job_id, 'leased', attempt_count, checkpoint_revision,
            jsonb_build_object('workerId', p_worker_id, 'claim', 'exact')
        FROM claimed
    )
    SELECT claimed.* FROM claimed;
END;
$$;

COMMIT;
