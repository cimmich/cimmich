BEGIN;

DO $$
DECLARE
    v_job media_job;
    v_replay media_job;
    v_claimed media_job;
    v_checkpoint media_job;
    v_retry media_job;
    v_expired media_job;
    v_result_digest text := repeat('9', 64);
BEGIN
    SELECT * INTO v_job FROM enqueue_media_job(
        'asset_service_fixture', 'recognize_faces', 'synthetic-provider-v1',
        repeat('a', 64), repeat('b', 64), 3
    );
    SELECT * INTO v_replay FROM enqueue_media_job(
        'asset_service_fixture', 'recognize_faces', 'synthetic-provider-v1',
        repeat('a', 64), repeat('b', 64), 3
    );
    IF v_job.job_id <> v_replay.job_id OR
        (SELECT count(*) FROM media_job WHERE work_key = v_job.work_key) <> 1 THEN
        RAISE EXCEPTION 'media job deterministic enqueue duplicated work';
    END IF;

    SELECT * INTO v_claimed FROM claim_media_jobs('synthetic-media-worker', 300, 1);
    IF v_claimed.job_id <> v_job.job_id OR v_claimed.attempt_count <> 1 THEN
        RAISE EXCEPTION 'media job exclusive claim failed';
    END IF;
    SELECT * INTO v_checkpoint FROM checkpoint_media_job(
        v_job.job_id, 'synthetic-media-worker', 'inventory_verified',
        '{"assetDigest":"synthetic"}'::jsonb
    );
    SELECT * INTO v_replay FROM checkpoint_media_job(
        v_job.job_id, 'synthetic-media-worker', 'inventory_verified',
        '{"assetDigest":"synthetic"}'::jsonb
    );
    IF v_checkpoint.checkpoint_revision <> 1 OR v_replay.checkpoint_revision <> 1 THEN
        RAISE EXCEPTION 'identical media checkpoint replay was not idempotent';
    END IF;
    SELECT * INTO v_checkpoint FROM checkpoint_media_job(
        v_job.job_id, 'synthetic-media-worker', 'recognition_recorded',
        '{"embedded":1,"abstained":0,"failed":0}'::jsonb
    );
    IF v_checkpoint.checkpoint_revision <> 2 THEN
        RAISE EXCEPTION 'media checkpoint did not advance';
    END IF;
    BEGIN
        PERFORM checkpoint_media_job(
            v_job.job_id, 'synthetic-media-worker', 'inventory_verified', '{}'::jsonb
        );
        RAISE EXCEPTION 'media checkpoint regression was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    INSERT INTO producer_receipt (
        producer_receipt_id, producer_kind, producer_name, producer_version,
        config_digest, started_at, completed_at, result_digest
    ) VALUES (
        'receipt_media_job_fixture', 'model', 'synthetic-media-job-provider', 'v1',
        repeat('a', 64), now(), now(), v_result_digest
    );
    BEGIN
        PERFORM complete_media_job(
            v_job.job_id, 'synthetic-media-worker', 'receipt_media_job_fixture',
            repeat('8', 64)
        );
        RAISE EXCEPTION 'mismatched media job result receipt was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;
    SELECT * INTO v_job FROM complete_media_job(
        v_job.job_id, 'synthetic-media-worker', 'receipt_media_job_fixture',
        v_result_digest
    );
    IF v_job.state <> 'completed' OR v_job.lease_owner IS NOT NULL THEN
        RAISE EXCEPTION 'media job completion did not clear its lease';
    END IF;
    SELECT * INTO v_replay FROM enqueue_media_job(
        'asset_service_fixture', 'recognize_faces', 'synthetic-provider-v1',
        repeat('a', 64), repeat('b', 64), 3
    );
    IF v_replay.state <> 'completed' OR v_replay.job_id <> v_job.job_id THEN
        RAISE EXCEPTION 'verified completed media job was not skipped';
    END IF;

    SELECT * INTO v_retry FROM enqueue_media_job(
        'asset_service_fixture', 'recognize_faces', 'synthetic-provider-v1',
        repeat('a', 64), repeat('c', 64), 2
    );
    SELECT * INTO v_claimed FROM claim_media_jobs('synthetic-retry-worker', 300, 1);
    SELECT * INTO v_retry FROM fail_media_job(
        v_claimed.job_id, 'synthetic-retry-worker', 'PROVIDER_TEMPORARY_FAILURE'
    );
    IF v_retry.state <> 'pending' THEN
        RAISE EXCEPTION 'retryable media job failed terminally too early';
    END IF;
    SELECT * INTO v_claimed FROM claim_media_jobs('synthetic-retry-worker', 300, 1);
    SELECT * INTO v_retry FROM fail_media_job(
        v_claimed.job_id, 'synthetic-retry-worker', 'PROVIDER_TEMPORARY_FAILURE'
    );
    IF v_retry.state <> 'failed' OR v_retry.completed_at IS NULL THEN
        RAISE EXCEPTION 'bounded media job retry did not fail terminally';
    END IF;

    SELECT * INTO v_expired FROM enqueue_media_job(
        'asset_service_fixture', 'detect_faces', 'synthetic-detector-v1',
        repeat('d', 64), repeat('e', 64), 2
    );
    SELECT * INTO v_claimed FROM claim_media_jobs('synthetic-expired-worker', 300, 1);
    UPDATE media_job SET lease_expires_at = now() - interval '1 second'
    WHERE job_id = v_claimed.job_id;
    SELECT * INTO v_expired FROM claim_media_jobs('synthetic-recovery-worker', 300, 1);
    IF v_expired.job_id <> v_claimed.job_id OR v_expired.attempt_count <> 2 OR
        v_expired.lease_owner <> 'synthetic-recovery-worker' THEN
        RAISE EXCEPTION 'expired media job lease did not recover exactly';
    END IF;
    SELECT * INTO v_expired FROM fail_media_job(
        v_expired.job_id, 'synthetic-recovery-worker', 'SYNTHETIC_TERMINAL'
    );
    IF v_expired.state <> 'failed' THEN
        RAISE EXCEPTION 'recovered final attempt did not terminate safely';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM media_job_event
        WHERE job_id = v_job.job_id AND event_kind = 'completed'
    ) OR NOT EXISTS (
        SELECT 1 FROM media_job_event
        WHERE job_id = v_expired.job_id AND event_kind = 'lease_expired'
    ) OR NOT EXISTS (
        SELECT 1 FROM media_job_event
        WHERE job_id = v_retry.job_id AND event_kind = 'retry_scheduled'
    ) THEN
        RAISE EXCEPTION 'media job lifecycle events are incomplete';
    END IF;
END;
$$;

ROLLBACK;
