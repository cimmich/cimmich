BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_existing_face_recognition_pipeline_v1', 'system',
    'cimmich-existing-face-recognition-pipeline', 'v1', now(), now(),
    encode(digest('cimmich.existing-face-recognition-pipeline.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

ALTER TABLE media_job DROP CONSTRAINT media_job_operation_check;
ALTER TABLE media_job ADD CONSTRAINT media_job_operation_check CHECK (
    operation IN (
      'detect_faces','recognize_faces','detect_and_recognize',
      'recognize_manual_face','recognize_existing_faces'
    )
);

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
    IF p_operation NOT IN (
      'detect_faces','recognize_faces','detect_and_recognize',
      'recognize_manual_face','recognize_existing_faces'
    ) THEN
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
                event_id, job_id, event_kind, attempt_count,
                checkpoint_revision, public_details
            ) VALUES (
                'media_job_event_' || replace(gen_random_uuid()::text, '-', ''),
                v_job.job_id, 'resumed', v_job.attempt_count,
                v_job.checkpoint_revision, '{"reason":"asset_visible"}'::jsonb
            );
        ELSIF v_job.state = 'completed' THEN
            SELECT result_digest INTO v_receipt_digest
            FROM producer_receipt WHERE producer_receipt_id = v_job.result_receipt_id;
            IF v_receipt_digest = v_job.result_digest THEN RETURN v_job; END IF;
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

ALTER TABLE media_pipeline_run
  ADD COLUMN run_kind text NOT NULL DEFAULT 'detector_result',
  ADD COLUMN recognizer_provider_config_digest text,
  ADD COLUMN source_revision_id text,
  ADD COLUMN source_content_digest text,
  ADD COLUMN observation_set_digest text,
  ADD COLUMN provider_replay_digest text,
  ADD COLUMN provider_result_digest text,
  ADD COLUMN provider_run_count integer NOT NULL DEFAULT 0;

UPDATE media_pipeline_run pipeline
SET recognizer_provider_config_digest = pipeline.recognizer_config_digest,
    source_content_digest = result.source_content_digest
FROM face_detection_result result
WHERE result.detection_result_id = pipeline.detection_result_id;

ALTER TABLE media_pipeline_run
  ALTER COLUMN recognizer_provider_config_digest SET NOT NULL,
  ALTER COLUMN source_content_digest SET NOT NULL,
  ALTER COLUMN detector_config_digest DROP NOT NULL,
  ALTER COLUMN detection_job_id DROP NOT NULL,
  ALTER COLUMN detection_result_id DROP NOT NULL,
  DROP CONSTRAINT media_pipeline_run_check,
  DROP CONSTRAINT media_pipeline_run_check1,
  ADD CONSTRAINT media_pipeline_run_run_kind_check CHECK (
    run_kind IN ('detector_result','existing_observation_set')
  ),
  ADD CONSTRAINT media_pipeline_run_provider_config_check CHECK (
    recognizer_provider_config_digest ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT media_pipeline_run_source_content_check CHECK (
    source_content_digest ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT media_pipeline_run_observation_set_check CHECK (
    observation_set_digest IS NULL
    OR observation_set_digest ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT media_pipeline_run_replay_digest_check CHECK (
    provider_replay_digest IS NULL
    OR provider_replay_digest ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT media_pipeline_run_result_digest_check CHECK (
    provider_result_digest IS NULL
    OR provider_result_digest ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT media_pipeline_run_provider_run_count_check CHECK (
    provider_run_count BETWEEN 0 AND 2
  ),
  ADD CONSTRAINT media_pipeline_run_state_job_check CHECK (
    (state = 'no_face' AND recognition_job_id IS NULL)
    OR (state <> 'no_face' AND recognition_job_id IS NOT NULL)
  ),
  ADD CONSTRAINT media_pipeline_run_recognized_check CHECK (
    (state = 'recognized' AND recognized_at IS NOT NULL)
    OR (state <> 'recognized' AND recognized_at IS NULL)
  ),
  ADD CONSTRAINT media_pipeline_run_provenance_shape_check CHECK (
    (run_kind = 'detector_result'
      AND detector_config_digest IS NOT NULL
      AND detection_job_id IS NOT NULL
      AND detection_result_id IS NOT NULL
      AND source_revision_id IS NULL
      AND observation_set_digest IS NULL)
    OR
    (run_kind = 'existing_observation_set'
      AND state <> 'no_face'
      AND detector_config_digest IS NULL
      AND detection_job_id IS NULL
      AND detection_result_id IS NULL
      AND source_revision_id IS NOT NULL
      AND observation_set_digest IS NOT NULL)
  ),
  ADD CONSTRAINT media_pipeline_run_existing_replay_check CHECK (
    run_kind <> 'existing_observation_set'
    OR state <> 'recognized'
    OR (provider_run_count = 2
      AND provider_replay_digest IS NOT NULL
      AND provider_result_digest IS NOT NULL)
  ),
  ADD CONSTRAINT media_pipeline_run_source_revision_fk FOREIGN KEY (
    source_revision_id, asset_id, input_revision, source_content_digest
  ) REFERENCES asset_source_revision (
    revision_id, asset_id, input_revision, source_content_digest
  );

CREATE TABLE media_pipeline_run_observation (
    pipeline_run_id text NOT NULL REFERENCES media_pipeline_run(pipeline_run_id)
      ON DELETE CASCADE,
    face_id text NOT NULL REFERENCES face_observation(face_id) ON DELETE CASCADE,
    observation_order integer NOT NULL CHECK (observation_order BETWEEN 0 AND 999),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (pipeline_run_id, face_id),
    UNIQUE (pipeline_run_id, observation_order)
);

CREATE TABLE media_pipeline_provider_run (
    run_id text PRIMARY KEY CHECK (run_id ~ '^provider_run_[0-9a-f]{40}$'),
    pipeline_run_id text NOT NULL REFERENCES media_pipeline_run(pipeline_run_id)
      ON DELETE CASCADE,
    run_ordinal integer NOT NULL CHECK (run_ordinal IN (1,2)),
    result_digest text NOT NULL CHECK (result_digest ~ '^[0-9a-f]{64}$'),
    checkpoint_digest text NOT NULL CHECK (checkpoint_digest ~ '^[0-9a-f]{64}$'),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (pipeline_run_id, run_ordinal)
);

CREATE OR REPLACE FUNCTION enforce_media_pipeline_provider_run_binding()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_run_kind text;
    v_state text;
    v_checkpoint_stage text;
    v_checkpoint_digest text;
    v_result_digest text;
BEGIN
    SELECT pipeline.run_kind, pipeline.state, job.checkpoint_stage,
           job.checkpoint_payload ->> 'checkpointDigest',
           job.checkpoint_payload ->> 'resultDigest'
      INTO v_run_kind, v_state, v_checkpoint_stage,
           v_checkpoint_digest, v_result_digest
    FROM media_pipeline_run pipeline
    JOIN media_job job ON job.job_id = pipeline.recognition_job_id
    WHERE pipeline.pipeline_run_id = NEW.pipeline_run_id;
    IF NOT FOUND OR v_run_kind <> 'existing_observation_set'
       OR v_state <> 'recognition_pending'
       OR v_checkpoint_stage <> 'recognition_recorded'
       OR v_checkpoint_digest IS NULL
       OR v_result_digest IS NULL
       OR NEW.checkpoint_digest <> v_checkpoint_digest
       OR NEW.result_digest <> v_result_digest THEN
        RAISE EXCEPTION 'provider run conflicts with prepared recognition receipt'
          USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER media_pipeline_provider_run_binding_guard
BEFORE INSERT ON media_pipeline_provider_run
FOR EACH ROW EXECUTE FUNCTION enforce_media_pipeline_provider_run_binding();

CREATE OR REPLACE FUNCTION prevent_media_pipeline_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'MEDIA_PIPELINE_EVIDENCE_APPEND_ONLY_DB'
      USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER media_pipeline_run_observation_immutable
BEFORE UPDATE OR DELETE ON media_pipeline_run_observation
FOR EACH ROW EXECUTE FUNCTION prevent_media_pipeline_evidence_mutation();

CREATE TRIGGER media_pipeline_provider_run_immutable
BEFORE UPDATE OR DELETE ON media_pipeline_provider_run
FOR EACH ROW EXECUTE FUNCTION prevent_media_pipeline_evidence_mutation();

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
    IF p_lease_seconds < 30 OR p_lease_seconds > 3600 OR p_limit < 1 OR p_limit > 100 THEN
        RAISE EXCEPTION 'invalid existing recognition lease or batch limit'
          USING ERRCODE = '22023';
    END IF;

    WITH expired AS (
        UPDATE media_job
        SET state = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'pending' END,
            lease_owner = NULL, lease_expires_at = NULL,
            completed_at = CASE WHEN attempt_count >= max_attempts THEN now() ELSE NULL END,
            last_error_code = 'WORKER_LEASE_EXPIRED'
        WHERE operation = 'recognize_existing_faces' AND state = 'processing'
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
          AND pipeline.run_kind = 'existing_observation_set'
        WHERE job.state = 'pending' AND job.operation = 'recognize_existing_faces'
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

CREATE OR REPLACE FUNCTION enforce_media_pipeline_binding()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_run_count integer;
    v_result_count integer;
    v_checkpoint_count integer;
    v_result_digest text;
    v_checkpoint_digest text;
    v_job_result_digest text;
    v_job_checkpoint_digest text;
BEGIN
    IF NEW.work_key <> OLD.work_key OR NEW.asset_id <> OLD.asset_id
        OR NEW.input_revision <> OLD.input_revision
        OR NEW.pipeline_config_digest <> OLD.pipeline_config_digest
        OR NEW.detector_config_digest IS DISTINCT FROM OLD.detector_config_digest
        OR NEW.recognizer_config_digest <> OLD.recognizer_config_digest
        OR NEW.recognizer_provider_config_digest <> OLD.recognizer_provider_config_digest
        OR NEW.vector_space_id <> OLD.vector_space_id
        OR NEW.detection_job_id IS DISTINCT FROM OLD.detection_job_id
        OR NEW.detection_result_id IS DISTINCT FROM OLD.detection_result_id
        OR NEW.recognition_job_id IS DISTINCT FROM OLD.recognition_job_id
        OR NEW.run_kind <> OLD.run_kind
        OR NEW.source_revision_id IS DISTINCT FROM OLD.source_revision_id
        OR NEW.source_content_digest <> OLD.source_content_digest
        OR NEW.observation_set_digest IS DISTINCT FROM OLD.observation_set_digest THEN
        RAISE EXCEPTION 'media pipeline stage binding is immutable'
          USING ERRCODE = '23514';
    END IF;
    IF OLD.state = 'recognized' AND NEW.state <> 'recognized' THEN
        RAISE EXCEPTION 'recognized media pipeline cannot regress'
          USING ERRCODE = '23514';
    END IF;
    IF OLD.state = 'recognition_failed' AND NEW.state <> 'recognition_failed' THEN
        RAISE EXCEPTION 'failed media pipeline requires a new work identity'
          USING ERRCODE = '23514';
    END IF;
    IF NEW.run_kind = 'existing_observation_set' AND NEW.state = 'recognized' THEN
        SELECT count(*), count(DISTINCT result_digest),
               count(DISTINCT checkpoint_digest), min(result_digest),
               min(checkpoint_digest)
          INTO v_run_count, v_result_count, v_checkpoint_count,
               v_result_digest, v_checkpoint_digest
        FROM media_pipeline_provider_run
        WHERE pipeline_run_id = NEW.pipeline_run_id;
        SELECT checkpoint_payload ->> 'resultDigest',
               checkpoint_payload ->> 'checkpointDigest'
          INTO v_job_result_digest, v_job_checkpoint_digest
        FROM media_job
        WHERE job_id = NEW.recognition_job_id
          AND checkpoint_stage = 'recognition_recorded';
        IF v_run_count <> 2 OR v_result_count <> 1
          OR v_checkpoint_count <> 1
          OR NEW.provider_run_count <> 2
          OR NEW.provider_replay_digest IS NULL
          OR NEW.provider_result_digest IS NULL
          OR v_result_digest <> NEW.provider_result_digest
          OR v_result_digest <> v_job_result_digest
          OR v_checkpoint_digest <> v_job_checkpoint_digest THEN
            RAISE EXCEPTION 'existing recognition requires two consistent provider runs'
              USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

COMMIT;
