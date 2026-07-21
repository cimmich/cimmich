\set ON_ERROR_STOP on
BEGIN;

INSERT INTO source_snapshot (
  snapshot_id, input_schema_version, source_digest, locator_root_token,
  started_at, completed_at, declared_asset_count, observed_asset_count, state,
  privacy_class
) VALUES (
  'snapshot_existing_recognition_guard', 'fixture-v1',
  'digest_existing_recognition_guard', 'locator_existing_recognition_guard',
  now(), now(), 1, 1, 'complete', 'release-safe'
);
INSERT INTO producer_receipt (
  producer_receipt_id, producer_kind, producer_name, producer_version,
  config_digest, source_snapshot_id, started_at, completed_at, result_digest,
  privacy_class
) VALUES (
  'receipt_existing_recognition_guard', 'system',
  'existing-recognition-guard-fixture', '1', repeat('a', 64),
  'snapshot_existing_recognition_guard', now(), now(), repeat('b', 64),
  'release-safe'
);
INSERT INTO asset (
  asset_id, content_hash, locator_token, media_kind, mime_type, width, height,
  source_snapshot_id, state, privacy_class
) VALUES (
  'asset_existing_recognition_guard', 'hash_existing_recognition_guard',
  'token_existing_recognition_guard', 'image', 'image/x-synthetic', 100, 100,
  'snapshot_existing_recognition_guard', 'active', 'release-safe'
);
INSERT INTO asset_source_revision (
  revision_id, asset_id, source_access, source_binding_digest, input_revision,
  source_content_digest, byte_length, producer_receipt_id, privacy_class
) VALUES (
  'source_revision_1111111111111111111111111111111111111111',
  'asset_existing_recognition_guard', 'immich_api_read_only', repeat('c', 64),
  repeat('d', 64), repeat('e', 64), 100,
  'receipt_existing_recognition_guard', 'release-safe'
);
INSERT INTO media_job (
  job_id, work_key, asset_id, operation, tool_version, config_digest,
  input_revision, state, attempt_count, checkpoint_stage,
  checkpoint_revision, checkpoint_payload, checkpoint_digest, lease_owner,
  lease_expires_at
) VALUES (
  'job_existing_recognition_guard', repeat('f', 64),
  'asset_existing_recognition_guard', 'recognize_existing_faces', 'fixture',
  repeat('a', 64), repeat('d', 64), 'processing', 1,
  'recognition_recorded', 1,
  jsonb_build_object(
    'checkpointDigest', repeat('1', 64),
    'resultDigest', repeat('2', 64)
  ), repeat('3', 64), 'fixture-worker', now() + interval '5 minutes'
);
INSERT INTO media_pipeline_run (
  pipeline_run_id, work_key, asset_id, input_revision,
  pipeline_config_digest, detector_config_digest, recognizer_config_digest,
  recognizer_provider_config_digest, vector_space_id, detection_job_id,
  detection_result_id, recognition_job_id, state, run_kind,
  source_revision_id, source_content_digest, observation_set_digest
) VALUES (
  'pipeline_existing_recognition_guard', repeat('4', 64),
  'asset_existing_recognition_guard', repeat('d', 64), repeat('5', 64), NULL,
  repeat('6', 64), repeat('a', 64), 'fixture-space', NULL, NULL,
  'job_existing_recognition_guard', 'recognition_pending',
  'existing_observation_set',
  'source_revision_1111111111111111111111111111111111111111', repeat('e', 64),
  repeat('7', 64)
);

DO $$
BEGIN
  BEGIN
    INSERT INTO media_pipeline_provider_run (
      run_id, pipeline_run_id, run_ordinal, result_digest, checkpoint_digest
    ) VALUES (
      'provider_run_1111111111111111111111111111111111111111',
      'pipeline_existing_recognition_guard', 1, repeat('2', 64), repeat('8', 64)
    );
    RAISE EXCEPTION 'divergent provider checkpoint forgery was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
END;
$$;

INSERT INTO media_pipeline_provider_run (
  run_id, pipeline_run_id, run_ordinal, result_digest, checkpoint_digest
) VALUES (
  'provider_run_1111111111111111111111111111111111111111',
  'pipeline_existing_recognition_guard', 1, repeat('2', 64), repeat('1', 64)
);

DO $$
BEGIN
  BEGIN
    INSERT INTO media_pipeline_provider_run (
      run_id, pipeline_run_id, run_ordinal, result_digest, checkpoint_digest
    ) VALUES (
      'provider_run_2222222222222222222222222222222222222222',
      'pipeline_existing_recognition_guard', 2, repeat('9', 64), repeat('1', 64)
    );
    RAISE EXCEPTION 'provider result forgery was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
END;
$$;

INSERT INTO media_pipeline_provider_run (
  run_id, pipeline_run_id, run_ordinal, result_digest, checkpoint_digest
) VALUES (
  'provider_run_2222222222222222222222222222222222222222',
  'pipeline_existing_recognition_guard', 2, repeat('2', 64), repeat('1', 64)
);

DO $$
BEGIN
  BEGIN
    UPDATE media_pipeline_run SET
      state = 'recognized', recognized_at = now(), provider_run_count = 2,
      provider_replay_digest = repeat('a', 64),
      provider_result_digest = repeat('9', 64)
    WHERE pipeline_run_id = 'pipeline_existing_recognition_guard';
    RAISE EXCEPTION 'pipeline result substitution was accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
END;
$$;

UPDATE media_pipeline_run SET
  state = 'recognized', recognized_at = now(), provider_run_count = 2,
  provider_replay_digest = repeat('a', 64),
  provider_result_digest = repeat('2', 64)
WHERE pipeline_run_id = 'pipeline_existing_recognition_guard';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM media_pipeline_run
    WHERE pipeline_run_id = 'pipeline_existing_recognition_guard'
      AND state = 'recognized' AND provider_result_digest = repeat('2', 64)
  ) THEN
    RAISE EXCEPTION 'valid provider replay binding did not commit';
  END IF;
END;
$$;

ROLLBACK;
\echo 'Existing Face recognition durable provenance guards: PASS'
