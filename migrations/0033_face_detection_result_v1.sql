BEGIN;

CREATE TABLE face_detection_result (
    detection_result_id text PRIMARY KEY,
    asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    detector_config_digest text NOT NULL CHECK (
        detector_config_digest ~ '^[0-9a-f]{64}$'
    ),
    input_revision text NOT NULL CHECK (input_revision ~ '^[0-9a-f]{64}$'),
    source_content_digest text NOT NULL CHECK (
        source_content_digest ~ '^[0-9a-f]{64}$'
    ),
    outcome text NOT NULL CHECK (outcome IN ('faces_detected','no_face')),
    face_count integer NOT NULL CHECK (face_count >= 0 AND face_count <= 1000),
    result_digest text NOT NULL CHECK (result_digest ~ '^[0-9a-f]{64}$'),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (asset_id, detector_config_digest, input_revision),
    CHECK (
        (outcome = 'no_face' AND face_count = 0)
        OR (outcome = 'faces_detected' AND face_count > 0)
    )
);

CREATE TABLE face_detection_result_observation (
    detection_result_id text NOT NULL REFERENCES face_detection_result(detection_result_id)
        ON DELETE CASCADE,
    face_id text NOT NULL REFERENCES face_observation(face_id) ON DELETE CASCADE,
    observation_order integer NOT NULL CHECK (observation_order >= 0),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    PRIMARY KEY (detection_result_id, face_id),
    UNIQUE (detection_result_id, observation_order)
);

CREATE TABLE media_job_detection_result (
    job_id text PRIMARY KEY REFERENCES media_job(job_id) ON DELETE CASCADE,
    detection_result_id text NOT NULL REFERENCES face_detection_result(detection_result_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX face_detection_result_asset_history
    ON face_detection_result(asset_id, created_at DESC, detection_result_id DESC);

CREATE OR REPLACE FUNCTION claim_face_detection_jobs(
    p_worker_id text,
    p_lease_seconds integer DEFAULT 300,
    p_limit integer DEFAULT 1
) RETURNS SETOF media_job LANGUAGE plpgsql AS $$
BEGIN
    IF nullif(btrim(p_worker_id), '') IS NULL THEN
        RAISE EXCEPTION 'face detection worker id is required' USING ERRCODE = '22023';
    END IF;
    IF p_lease_seconds < 30 OR p_lease_seconds > 3600 OR p_limit < 1 OR p_limit > 100 THEN
        RAISE EXCEPTION 'invalid face detection lease or batch limit' USING ERRCODE = '22023';
    END IF;

    WITH expired AS (
        UPDATE media_job
        SET state = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'pending' END,
            lease_owner = NULL, lease_expires_at = NULL,
            completed_at = CASE WHEN attempt_count >= max_attempts THEN now() ELSE NULL END,
            last_error_code = 'WORKER_LEASE_EXPIRED'
        WHERE operation = 'detect_faces' AND state = 'processing'
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
        SELECT job_id FROM media_job
        WHERE state = 'pending' AND operation = 'detect_faces'
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

CREATE OR REPLACE FUNCTION enforce_face_detection_result_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'face detection results are immutable'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER face_detection_result_immutable
BEFORE UPDATE ON face_detection_result
FOR EACH ROW EXECUTE FUNCTION enforce_face_detection_result_immutability();

COMMIT;
