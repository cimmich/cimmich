BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_media_asset_triage_v1', 'system',
    'cimmich-media-asset-triage', 'v1', now(), now(),
    encode(digest('cimmich.media-asset-triage.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

-- Priority is deliberately projected from current owner truth. It is not copied
-- into media_job, because accepting or retracting a person tag must immediately
-- change the order of already queued work.
CREATE OR REPLACE VIEW media_asset_triage AS
WITH accepted_people AS (
    SELECT people.asset_id,
           count(DISTINCT people.person_id)::integer AS accepted_person_count,
           count(*)::integer AS accepted_association_count
    FROM asset_people people
    WHERE people.authority_state = 'accepted'
    GROUP BY people.asset_id
), human_observations AS (
    SELECT observations.asset_id,
           sum(observations.observation_count)::integer
             AS human_observation_count
    FROM (
        SELECT face.asset_id, count(*)::bigint AS observation_count
        FROM face_observation face
        WHERE face.state = 'valid'
        GROUP BY face.asset_id
        UNION ALL
        SELECT body.asset_id, count(*)::bigint AS observation_count
        FROM body_observation body
        WHERE body.state = 'valid'
        GROUP BY body.asset_id
        UNION ALL
        SELECT head.asset_id, count(*)::bigint AS observation_count
        FROM manual_head_observation head
        WHERE head.state = 'valid'
        GROUP BY head.asset_id
    ) observations
    GROUP BY observations.asset_id
)
SELECT asset.asset_id,
       CASE
         WHEN coalesce(people.accepted_person_count, 0) > 0 THEN 0
         WHEN coalesce(observations.human_observation_count, 0) > 0 THEN 1
         ELSE 2
       END::integer AS priority_tier,
       coalesce(people.accepted_person_count, 0)::integer
         AS accepted_person_count,
       coalesce(people.accepted_association_count, 0)::integer
         AS accepted_association_count,
       coalesce(observations.human_observation_count, 0)::integer
         AS human_observation_count
FROM asset
LEFT JOIN accepted_people people ON people.asset_id = asset.asset_id
LEFT JOIN human_observations observations
  ON observations.asset_id = asset.asset_id
WHERE asset.state = 'active';

COMMENT ON VIEW media_asset_triage IS
  'Live reusable media-work rank: accepted People first, then assets with existing human observations, then unexplored assets.';

CREATE OR REPLACE FUNCTION claim_media_jobs(
    p_worker_id text,
    p_lease_seconds integer DEFAULT 300,
    p_limit integer DEFAULT 1
) RETURNS SETOF media_job LANGUAGE plpgsql AS $$
BEGIN
    IF nullif(btrim(p_worker_id), '') IS NULL THEN
        RAISE EXCEPTION 'media job worker id is required' USING ERRCODE = '22023';
    END IF;
    IF p_lease_seconds < 30 OR p_lease_seconds > 3600
       OR p_limit < 1 OR p_limit > 100 THEN
        RAISE EXCEPTION 'invalid media job lease or batch limit'
          USING ERRCODE = '22023';
    END IF;

    WITH expired AS (
        UPDATE media_job
        SET state = CASE
              WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'pending'
            END,
            lease_owner = NULL, lease_expires_at = NULL,
            completed_at = CASE
              WHEN attempt_count >= max_attempts THEN now() ELSE NULL
            END,
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
        SELECT job.job_id
        FROM media_job job
        JOIN media_asset_triage triage ON triage.asset_id = job.asset_id
        WHERE job.state = 'pending'
        ORDER BY triage.priority_tier,
                 triage.accepted_person_count DESC,
                 triage.accepted_association_count DESC,
                 triage.human_observation_count DESC,
                 job.requested_at, job.job_id
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

CREATE OR REPLACE FUNCTION claim_existing_face_recognition_jobs(
    p_worker_id text,
    p_lease_seconds integer DEFAULT 300,
    p_limit integer DEFAULT 1
) RETURNS SETOF media_job LANGUAGE plpgsql AS $$
BEGIN
    IF nullif(btrim(p_worker_id), '') IS NULL THEN
        RAISE EXCEPTION 'existing face recognition worker id is required'
          USING ERRCODE = '22023';
    END IF;
    IF p_lease_seconds < 30 OR p_lease_seconds > 3600
       OR p_limit < 1 OR p_limit > 100 THEN
        RAISE EXCEPTION 'invalid existing recognition lease or batch limit'
          USING ERRCODE = '22023';
    END IF;

    WITH expired AS (
        UPDATE media_job
        SET state = CASE
              WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'pending'
            END,
            lease_owner = NULL, lease_expires_at = NULL,
            completed_at = CASE
              WHEN attempt_count >= max_attempts THEN now() ELSE NULL
            END,
            last_error_code = 'WORKER_LEASE_EXPIRED'
        WHERE operation = 'recognize_existing_faces' AND state = 'processing'
          AND lease_expires_at < now()
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
        SELECT job.job_id
        FROM media_job job
        JOIN media_pipeline_run pipeline
          ON pipeline.recognition_job_id = job.job_id
          AND pipeline.state = 'recognition_pending'
          AND pipeline.run_kind = 'existing_observation_set'
        JOIN media_asset_triage triage ON triage.asset_id = job.asset_id
        WHERE job.state = 'pending'
          AND job.operation = 'recognize_existing_faces'
        ORDER BY triage.priority_tier,
                 triage.accepted_person_count DESC,
                 triage.accepted_association_count DESC,
                 triage.human_observation_count DESC,
                 job.requested_at, job.job_id
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
            event_id, job_id, event_kind, attempt_count,
            checkpoint_revision, public_details
        ) SELECT
            'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
            job_id, 'leased', attempt_count, checkpoint_revision,
            jsonb_build_object('workerId', p_worker_id)
        FROM claimed
    )
    SELECT claimed.* FROM claimed;
END;
$$;

CREATE OR REPLACE FUNCTION claim_exact_face_recognition_jobs(
    p_worker_id text,
    p_tool_version text,
    p_job_config_digest text,
    p_recognition_space_config_digest text,
    p_vector_space_id text,
    p_lease_seconds integer DEFAULT 300,
    p_limit integer DEFAULT 1
) RETURNS SETOF media_job LANGUAGE plpgsql AS $$
BEGIN
    IF nullif(btrim(p_worker_id), '') IS NULL
       OR nullif(btrim(p_tool_version), '') IS NULL
       OR nullif(btrim(p_vector_space_id), '') IS NULL
       OR p_job_config_digest !~ '^[0-9a-f]{64}$'
       OR p_recognition_space_config_digest !~ '^[0-9a-f]{64}$' THEN
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
            lease_owner = NULL, lease_expires_at = NULL,
            completed_at = CASE
              WHEN job.attempt_count >= job.max_attempts THEN now() ELSE NULL
            END,
            last_error_code = 'WORKER_LEASE_EXPIRED'
        FROM media_pipeline_run pipeline
        WHERE pipeline.recognition_job_id = job.job_id
          AND pipeline.state = 'recognition_pending'
          AND pipeline.recognizer_config_digest =
              p_recognition_space_config_digest
          AND pipeline.vector_space_id = p_vector_space_id
          AND job.operation = 'recognize_faces'
          AND job.tool_version = p_tool_version
          AND job.config_digest = p_job_config_digest
          AND job.state = 'processing'
          AND job.lease_expires_at < now()
        RETURNING job.*
    )
    INSERT INTO media_job_event (
        event_id, job_id, event_kind, attempt_count, checkpoint_revision,
        public_details
    ) SELECT
        'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
        job_id, CASE WHEN state = 'failed' THEN 'failed' ELSE 'lease_expired' END,
        attempt_count, checkpoint_revision,
        jsonb_build_object(
          'errorCode', 'WORKER_LEASE_EXPIRED', 'claim', 'exact-provider'
        )
    FROM expired;

    RETURN QUERY
    WITH claimable AS (
        SELECT job.job_id
        FROM media_job job
        JOIN media_pipeline_run pipeline
          ON pipeline.recognition_job_id = job.job_id
          AND pipeline.state = 'recognition_pending'
          AND pipeline.recognizer_config_digest =
              p_recognition_space_config_digest
          AND pipeline.vector_space_id = p_vector_space_id
        JOIN media_asset_triage triage ON triage.asset_id = job.asset_id
        WHERE job.state = 'pending'
          AND job.operation = 'recognize_faces'
          AND job.tool_version = p_tool_version
          AND job.config_digest = p_job_config_digest
        ORDER BY triage.priority_tier,
                 triage.accepted_person_count DESC,
                 triage.accepted_association_count DESC,
                 triage.human_observation_count DESC,
                 job.requested_at, job.job_id
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
            jsonb_build_object('workerId', p_worker_id, 'claim', 'exact-provider')
        FROM claimed
    )
    SELECT claimed.* FROM claimed;
END;
$$;

COMMENT ON FUNCTION claim_exact_face_recognition_jobs(
    text, text, text, text, text, integer, integer
) IS 'Claims exact normal Face recognition work in live person-linked triage order.';

COMMIT;
