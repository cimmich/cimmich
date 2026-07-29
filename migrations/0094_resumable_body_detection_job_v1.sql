BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_resumable_body_detection_job_v1', 'system',
    'cimmich-resumable-body-detection-job', 'v1', now(), now(),
    encode(digest('cimmich.resumable-body-detection-job.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

ALTER TABLE media_job DROP CONSTRAINT media_job_operation_check;
ALTER TABLE media_job ADD CONSTRAINT media_job_operation_check CHECK (
    operation IN (
      'detect_faces','detect_bodies','recognize_faces','detect_and_recognize',
      'recognize_manual_face','recognize_existing_faces'
    )
);

CREATE TABLE media_job_body_detection_result (
    job_id text PRIMARY KEY REFERENCES media_job(job_id) ON DELETE CASCADE,
    detection_result_id text NOT NULL UNIQUE
      REFERENCES body_detection_result(detection_result_id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1
);

CREATE OR REPLACE FUNCTION enforce_media_job_body_detection_binding()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_job media_job;
    v_result body_detection_result;
BEGIN
    SELECT * INTO v_job FROM media_job WHERE job_id = NEW.job_id;
    SELECT * INTO v_result FROM body_detection_result
      WHERE detection_result_id = NEW.detection_result_id;
    IF NOT FOUND OR v_job.job_id IS NULL OR v_job.operation <> 'detect_bodies'
       OR v_job.asset_id <> v_result.asset_id
       OR v_job.config_digest <> v_result.detector_config_digest THEN
        RAISE EXCEPTION 'body detection result crosses its media job'
          USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER media_job_body_detection_binding_guard
BEFORE INSERT OR UPDATE ON media_job_body_detection_result
FOR EACH ROW EXECUTE FUNCTION enforce_media_job_body_detection_binding();

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
      'detect_faces','detect_bodies','recognize_faces','detect_and_recognize',
      'recognize_manual_face','recognize_existing_faces'
    ) THEN
        RAISE EXCEPTION 'unsupported media job operation'
          USING ERRCODE = '22023';
    END IF;
    IF p_config_digest !~ '^[0-9a-f]{64}$'
       OR p_input_revision !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'media job digests must be lowercase SHA-256'
          USING ERRCODE = '22023';
    END IF;
    IF p_max_attempts < 1 OR p_max_attempts > 20 THEN
        RAISE EXCEPTION 'media job max attempts must be from 1 to 20'
          USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM asset WHERE asset_id = p_asset_id AND state = 'active';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'active media job asset not found'
          USING ERRCODE = 'P0002';
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
            FROM producer_receipt
            WHERE producer_receipt_id = v_job.result_receipt_id;
            IF v_receipt_digest = v_job.result_digest THEN RETURN v_job; END IF;
            UPDATE media_job SET state = 'pending', result_receipt_id = NULL,
                result_digest = NULL, completed_at = NULL,
                last_error_code = 'RESULT_RECEIPT_INVALID',
                max_attempts = p_max_attempts
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

COMMIT;
