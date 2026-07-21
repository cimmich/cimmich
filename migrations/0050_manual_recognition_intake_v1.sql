BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_manual_recognition_intake_v1', 'system',
    'cimmich-manual-recognition-intake', 'v1', now(), now(),
    encode(digest('cimmich.manual-recognition-intake.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

ALTER TABLE media_job DROP CONSTRAINT media_job_operation_check;
ALTER TABLE media_job ADD CONSTRAINT media_job_operation_check CHECK (
    operation IN (
      'detect_faces','recognize_faces','detect_and_recognize',
      'recognize_manual_face'
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
      'recognize_manual_face'
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

CREATE TABLE manual_face_recognition_request (
    request_id text PRIMARY KEY CHECK (request_id ~ '^manualreq_[0-9a-f]{40}$'),
    request_digest text NOT NULL UNIQUE CHECK (request_digest ~ '^[0-9a-f]{64}$'),
    job_id text NOT NULL UNIQUE REFERENCES media_job(job_id),
    operation_id text NOT NULL REFERENCES manual_subject_tag_operation(operation_id),
    identity_claim_id text NOT NULL REFERENCES identity_claim(identity_claim_id),
    face_id text NOT NULL REFERENCES face_observation(face_id),
    asset_id text NOT NULL REFERENCES asset(asset_id),
    source_id text NOT NULL CHECK (length(source_id) BETWEEN 1 AND 120),
    immich_asset_id text NOT NULL CHECK (length(immich_asset_id) BETWEEN 1 AND 200),
    input_revision text NOT NULL CHECK (input_revision ~ '^[0-9a-f]{64}$'),
    region_digest text NOT NULL CHECK (region_digest ~ '^[0-9a-f]{64}$'),
    region jsonb NOT NULL CHECK (
      jsonb_typeof(region) = 'object'
      AND region ?& ARRAY['x','y','w','h']
      AND region - ARRAY['x','y','w','h'] = '{}'::jsonb
      AND jsonb_typeof(region->'x') = 'number'
      AND jsonb_typeof(region->'y') = 'number'
      AND jsonb_typeof(region->'w') = 'number'
      AND jsonb_typeof(region->'h') = 'number'
      AND (region->>'x')::numeric BETWEEN 0 AND 1
      AND (region->>'y')::numeric BETWEEN 0 AND 1
      AND (region->>'w')::numeric > 0 AND (region->>'w')::numeric <= 1
      AND (region->>'h')::numeric > 0 AND (region->>'h')::numeric <= 1
      AND (region->>'x')::numeric + (region->>'w')::numeric <= 1.000001
      AND (region->>'y')::numeric + (region->>'h')::numeric <= 1.000001
    ),
    provider_id text NOT NULL CHECK (provider_id ~ '^[a-z0-9][a-z0-9._-]{0,95}$'),
    model_family text NOT NULL CHECK (model_family ~ '^[a-z0-9][a-z0-9._-]{0,95}$'),
    model_version text NOT NULL CHECK (model_version ~ '^[a-z0-9][a-z0-9._-]{0,95}$'),
    provider_config_digest text NOT NULL CHECK (provider_config_digest ~ '^[0-9a-f]{64}$'),
    vector_space_id text NOT NULL CHECK (vector_space_id ~ '^[a-z0-9][a-z0-9._-]{0,95}$'),
    scope_key text NOT NULL CHECK (scope_key ~ '^[0-9a-f]{64}$'),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (operation_id, provider_config_digest, input_revision, region_digest)
);

CREATE TABLE manual_face_recognition_run (
    run_id text PRIMARY KEY CHECK (run_id ~ '^manualrun_[a-z0-9][a-z0-9_-]{7,55}$'),
    request_id text NOT NULL REFERENCES manual_face_recognition_request(request_id),
    run_ordinal integer NOT NULL CHECK (run_ordinal IN (1,2)),
    result_digest text NOT NULL CHECK (result_digest ~ '^[0-9a-f]{64}$'),
    crop_digest text NOT NULL CHECK (crop_digest ~ '^[0-9a-f]{64}$'),
    vector_digest text NOT NULL CHECK (vector_digest ~ '^[0-9a-f]{64}$'),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (request_id, run_ordinal),
    UNIQUE (request_id, run_id)
);

CREATE TABLE manual_face_recognition_quality (
    quality_id text PRIMARY KEY CHECK (quality_id ~ '^manualquality_[0-9a-f]{40}$'),
    request_id text NOT NULL UNIQUE REFERENCES manual_face_recognition_request(request_id),
    measurement_digest text NOT NULL CHECK (measurement_digest ~ '^[0-9a-f]{64}$'),
    policy_version text NOT NULL CHECK (policy_version ~ '^[a-z0-9][a-z0-9._-]{0,95}$'),
    policy_digest text NOT NULL CHECK (policy_digest ~ '^[0-9a-f]{64}$'),
    quality_score numeric(7,6) NOT NULL CHECK (quality_score BETWEEN 0 AND 1),
    usable_threshold numeric(7,6) NOT NULL CHECK (usable_threshold BETWEEN 0 AND 1),
    low_quality_threshold numeric(7,6) NOT NULL CHECK (
      low_quality_threshold BETWEEN 0 AND usable_threshold
    ),
    allow_low_quality boolean NOT NULL,
    evidence_tier text NOT NULL CHECK (evidence_tier IN ('secondary','low_quality')),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
      (evidence_tier = 'secondary' AND quality_score >= usable_threshold)
      OR
      (evidence_tier = 'low_quality' AND allow_low_quality
        AND quality_score >= low_quality_threshold
        AND quality_score < usable_threshold)
    )
);

CREATE TABLE manual_face_recognition_evidence (
    evidence_id text PRIMARY KEY CHECK (evidence_id ~ '^manualevidence_[0-9a-f]{40}$'),
    evidence_digest text NOT NULL UNIQUE CHECK (evidence_digest ~ '^[0-9a-f]{64}$'),
    request_id text NOT NULL UNIQUE REFERENCES manual_face_recognition_request(request_id),
    run_one_id text NOT NULL UNIQUE REFERENCES manual_face_recognition_run(run_id),
    run_two_id text NOT NULL UNIQUE REFERENCES manual_face_recognition_run(run_id),
    replay_digest text NOT NULL CHECK (replay_digest ~ '^[0-9a-f]{64}$'),
    result_digest text NOT NULL CHECK (result_digest ~ '^[0-9a-f]{64}$'),
    source_content_digest text NOT NULL CHECK (source_content_digest ~ '^[0-9a-f]{64}$'),
    quality_id text NOT NULL UNIQUE REFERENCES manual_face_recognition_quality(quality_id),
    measurement_digest text NOT NULL CHECK (measurement_digest ~ '^[0-9a-f]{64}$'),
    policy_digest text NOT NULL CHECK (policy_digest ~ '^[0-9a-f]{64}$'),
    evidence_tier text NOT NULL CHECK (evidence_tier IN ('secondary','low_quality')),
    embedding_id text NOT NULL UNIQUE REFERENCES face_embedding(embedding_id),
    vector_digest text NOT NULL CHECK (vector_digest ~ '^[0-9a-f]{64}$'),
    rebuild_request_id text NOT NULL UNIQUE REFERENCES source_pack_rebuild_request(rebuild_request_id),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    replay_evidence text NOT NULL DEFAULT 'consistent' CHECK (replay_evidence = 'consistent'),
    provider_execution_proof text NOT NULL DEFAULT 'none' CHECK (provider_execution_proof = 'none'),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (run_one_id <> run_two_id)
);

CREATE OR REPLACE FUNCTION prevent_manual_recognition_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'MANUAL_RECOGNITION_EVIDENCE_APPEND_ONLY_DB'
      USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER manual_face_recognition_request_immutable
BEFORE UPDATE OR DELETE ON manual_face_recognition_request
FOR EACH ROW EXECUTE FUNCTION prevent_manual_recognition_evidence_mutation();
CREATE TRIGGER manual_face_recognition_run_immutable
BEFORE UPDATE OR DELETE ON manual_face_recognition_run
FOR EACH ROW EXECUTE FUNCTION prevent_manual_recognition_evidence_mutation();
CREATE TRIGGER manual_face_recognition_quality_immutable
BEFORE UPDATE OR DELETE ON manual_face_recognition_quality
FOR EACH ROW EXECUTE FUNCTION prevent_manual_recognition_evidence_mutation();
CREATE TRIGGER manual_face_recognition_evidence_immutable
BEFORE UPDATE OR DELETE ON manual_face_recognition_evidence
FOR EACH ROW EXECUTE FUNCTION prevent_manual_recognition_evidence_mutation();

CREATE OR REPLACE FUNCTION enforce_manual_face_recognition_request()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM manual_subject_tag_operation operation
    JOIN identity_claim claim ON claim.identity_claim_id = NEW.identity_claim_id
    JOIN face_observation face ON face.face_id = NEW.face_id
    JOIN immich_asset_projection projection
      ON projection.source_id = NEW.source_id
      AND projection.immich_asset_id = NEW.immich_asset_id
      AND projection.cimmich_asset_id = NEW.asset_id
      AND projection.input_revision = NEW.input_revision
      AND projection.state = 'active'
    JOIN media_job job ON job.job_id = NEW.job_id
    WHERE operation.operation_id = NEW.operation_id
      AND operation.state = 'active' AND operation.tag_type = 'face'
      AND operation.asset_id = NEW.asset_id
      AND operation.tag_id = claim.identity_claim_id
      AND operation.observation_id = face.face_id
      AND claim.face_id = face.face_id AND claim.state = 'accepted'
      AND claim.origin = 'user' AND face.state = 'valid'
      AND face.observation_origin = 'manual_user'
      AND face.box_x = (NEW.region->>'x')::numeric
      AND face.box_y = (NEW.region->>'y')::numeric
      AND face.box_w = (NEW.region->>'w')::numeric
      AND face.box_h = (NEW.region->>'h')::numeric
      AND job.asset_id = NEW.asset_id
      AND job.operation = 'recognize_manual_face'
      AND job.config_digest = NEW.provider_config_digest
      AND job.input_revision = NEW.input_revision
  ) THEN
    RAISE EXCEPTION 'MANUAL_RECOGNITION_REQUEST_PROVENANCE_INVALID_DB'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER manual_face_recognition_request_guard
BEFORE INSERT ON manual_face_recognition_request
FOR EACH ROW EXECUTE FUNCTION enforce_manual_face_recognition_request();

CREATE OR REPLACE FUNCTION enforce_manual_face_recognition_evidence()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM manual_face_recognition_request request
    JOIN manual_face_recognition_run run_one
      ON run_one.run_id = NEW.run_one_id AND run_one.request_id = request.request_id
      AND run_one.run_ordinal = 1
    JOIN manual_face_recognition_run run_two
      ON run_two.run_id = NEW.run_two_id AND run_two.request_id = request.request_id
      AND run_two.run_ordinal = 2
    JOIN manual_face_recognition_quality quality
      ON quality.quality_id = NEW.quality_id AND quality.request_id = request.request_id
    JOIN face_embedding embedding
      ON embedding.embedding_id = NEW.embedding_id
      AND embedding.face_id = request.face_id AND embedding.state = 'active'
      AND embedding.model_family = request.model_family
      AND embedding.model_version = request.model_version
      AND embedding.config_digest = request.provider_config_digest
    JOIN source_pack_rebuild_request rebuild
      ON rebuild.rebuild_request_id = NEW.rebuild_request_id
      AND rebuild.person_id = (
        SELECT claim.person_id FROM identity_claim claim
        WHERE claim.identity_claim_id = request.identity_claim_id
      )
      AND rebuild.reason_code = 'manual_face_recognition_eligible'
      AND rebuild.subject_type = 'manual_face_recognition_evidence'
      AND rebuild.subject_id = NEW.evidence_id
      AND rebuild.model_family = request.model_family
      AND rebuild.model_version = request.model_version
      AND rebuild.config_digest = request.provider_config_digest
    WHERE request.request_id = NEW.request_id
      AND run_one.result_digest = NEW.result_digest
      AND run_two.result_digest = NEW.result_digest
      AND run_one.crop_digest = run_two.crop_digest
      AND run_one.vector_digest = NEW.vector_digest
      AND run_two.vector_digest = NEW.vector_digest
      AND embedding.vector_digest = NEW.vector_digest
      AND quality.measurement_digest = NEW.measurement_digest
      AND quality.policy_digest = NEW.policy_digest
      AND quality.evidence_tier = NEW.evidence_tier
  ) THEN
    RAISE EXCEPTION 'MANUAL_RECOGNITION_EVIDENCE_PROVENANCE_INVALID_DB'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER manual_face_recognition_evidence_guard
BEFORE INSERT ON manual_face_recognition_evidence
FOR EACH ROW EXECUTE FUNCTION enforce_manual_face_recognition_evidence();

ALTER TABLE manual_face_matching_lifecycle
  DROP CONSTRAINT manual_face_matching_lifecycle_state_check1,
  DROP CONSTRAINT manual_face_matching_lifecycle_reason_check,
  ADD COLUMN recognition_evidence_id text
    REFERENCES manual_face_recognition_evidence(evidence_id),
  ADD CONSTRAINT manual_face_matching_lifecycle_reason_check CHECK (
    reason IS NULL OR reason IN (
      'no_compatible_provider','invalid_face','quality_failed',
      'embedding_unavailable','asset_revision_changed',
      'source_content_changed','provider_mismatch','replay_failed',
      'crop_invalid','quality_unmeasured'
    )
  ),
  ADD CONSTRAINT manual_face_matching_lifecycle_recognition_evidence_check CHECK (
    (state = 'eligible_for_evaluation') = (recognition_evidence_id IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION enforce_manual_face_matching_lifecycle()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_previous manual_face_matching_lifecycle%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'MANUAL_FACE_MATCHING_LIFECYCLE_APPEND_ONLY_DB'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM manual_subject_tag_operation operation
    JOIN identity_claim claim ON claim.identity_claim_id = NEW.identity_claim_id
    JOIN face_observation face ON face.face_id = NEW.face_id
    WHERE operation.operation_id = NEW.operation_id AND operation.tag_type = 'face'
      AND operation.tag_id = claim.identity_claim_id
      AND operation.observation_id = face.face_id
      AND claim.face_id = face.face_id AND claim.origin = 'user'
      AND face.observation_origin = 'manual_user'
      AND (NEW.state = 'cancelled' OR (
        operation.state = 'active' AND claim.state = 'accepted' AND face.state = 'valid'
      ))
  ) THEN
    RAISE EXCEPTION 'MANUAL_FACE_MATCHING_PROVENANCE_INVALID_DB'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.state = 'eligible_for_evaluation' AND NOT EXISTS (
    SELECT 1
    FROM manual_face_recognition_evidence evidence
    JOIN manual_face_recognition_request request
      ON request.request_id = evidence.request_id
    JOIN manual_face_recognition_quality quality
      ON quality.quality_id = evidence.quality_id
    JOIN face_embedding embedding
      ON embedding.embedding_id = evidence.embedding_id AND embedding.state = 'active'
    JOIN source_pack_rebuild_request rebuild
      ON rebuild.rebuild_request_id = evidence.rebuild_request_id
    JOIN immich_asset_projection projection
      ON projection.source_id = request.source_id
      AND projection.immich_asset_id = request.immich_asset_id
      AND projection.cimmich_asset_id = request.asset_id
      AND projection.input_revision = request.input_revision
      AND projection.state = 'active'
    WHERE evidence.evidence_id = NEW.recognition_evidence_id
      AND request.operation_id = NEW.operation_id
      AND request.identity_claim_id = NEW.identity_claim_id
      AND request.face_id = NEW.face_id
      AND request.provider_id = NEW.provider_id
      AND request.model_family = NEW.model_family
      AND request.model_version = NEW.model_version
      AND request.provider_config_digest = NEW.config_digest
      AND request.vector_space_id = NEW.vector_space_id
      AND request.scope_key = NEW.scope_key
      AND evidence.embedding_id = NEW.embedding_id
      AND evidence.vector_digest = NEW.vector_digest
      AND evidence.evidence_digest = NEW.evidence_digest
      AND evidence.evidence_tier = NEW.evidence_tier
      AND evidence.rebuild_request_id = NEW.rebuild_request_id
      AND quality.measurement_digest = evidence.measurement_digest
      AND quality.policy_digest = evidence.policy_digest
      AND embedding.vector_digest = evidence.vector_digest
      AND rebuild.subject_id = evidence.evidence_id
  ) THEN
    RAISE EXCEPTION 'MANUAL_FACE_RECOGNITION_EVIDENCE_REQUIRED_DB'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.supersedes_lifecycle_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM manual_face_matching_lifecycle prior
      WHERE prior.operation_id = NEW.operation_id AND prior.scope_key = NEW.scope_key) THEN
      RAISE EXCEPTION 'MANUAL_FACE_MATCHING_SCOPE_ALREADY_EXISTS_DB'
        USING ERRCODE = '23505';
    END IF;
  ELSE
    SELECT * INTO v_previous FROM manual_face_matching_lifecycle
    WHERE lifecycle_id = NEW.supersedes_lifecycle_id;
    IF v_previous.lifecycle_id IS NULL OR v_previous.operation_id <> NEW.operation_id
       OR v_previous.scope_key <> NEW.scope_key OR v_previous.state = 'cancelled'
       OR EXISTS (SELECT 1 FROM manual_face_matching_lifecycle successor
         WHERE successor.supersedes_lifecycle_id = v_previous.lifecycle_id) THEN
      RAISE EXCEPTION 'MANUAL_FACE_MATCHING_SUPERSESSION_INVALID_DB'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE VIEW current_manual_face_matching_lifecycle AS
SELECT lifecycle.* FROM manual_face_matching_lifecycle lifecycle
WHERE NOT EXISTS (
  SELECT 1 FROM manual_face_matching_lifecycle successor
  WHERE successor.supersedes_lifecycle_id = lifecycle.lifecycle_id
)
AND (
  lifecycle.state <> 'eligible_for_evaluation'
  OR EXISTS (
    SELECT 1
    FROM manual_face_recognition_evidence evidence
    JOIN manual_face_recognition_request request ON request.request_id = evidence.request_id
    JOIN manual_face_recognition_quality quality ON quality.quality_id = evidence.quality_id
    JOIN face_embedding embedding ON embedding.embedding_id = evidence.embedding_id
    WHERE evidence.evidence_id = lifecycle.recognition_evidence_id
      AND request.operation_id = lifecycle.operation_id
      AND request.identity_claim_id = lifecycle.identity_claim_id
      AND request.face_id = lifecycle.face_id
      AND request.provider_config_digest = lifecycle.config_digest
      AND request.vector_space_id = lifecycle.vector_space_id
      AND evidence.embedding_id = lifecycle.embedding_id
      AND evidence.vector_digest = lifecycle.vector_digest
      AND evidence.evidence_digest = lifecycle.evidence_digest
      AND evidence.evidence_tier = lifecycle.evidence_tier
      AND quality.measurement_digest = evidence.measurement_digest
      AND quality.policy_digest = evidence.policy_digest
      AND embedding.vector_digest = evidence.vector_digest
      AND embedding.state = 'active'
  )
);

CREATE VIEW current_manual_face_matching_evidence AS
SELECT lifecycle.lifecycle_id, lifecycle.operation_id,
  lifecycle.identity_claim_id, lifecycle.face_id, lifecycle.scope_key,
  lifecycle.provider_id, lifecycle.model_family, lifecycle.model_version,
  lifecycle.config_digest, lifecycle.vector_space_id, lifecycle.embedding_id,
  lifecycle.vector_digest, lifecycle.evidence_digest, lifecycle.evidence_tier,
  lifecycle.rebuild_request_id, lifecycle.recognition_evidence_id,
  evidence.request_id, evidence.replay_digest, evidence.result_digest,
  evidence.source_content_digest, evidence.measurement_digest,
  evidence.policy_digest, quality.quality_score,
  request.input_revision, request.region_digest
FROM current_manual_face_matching_lifecycle lifecycle
JOIN manual_face_recognition_evidence evidence
  ON evidence.evidence_id = lifecycle.recognition_evidence_id
JOIN manual_face_recognition_request request
  ON request.request_id = evidence.request_id
JOIN manual_face_recognition_quality quality
  ON quality.quality_id = evidence.quality_id
WHERE lifecycle.state = 'eligible_for_evaluation';

CREATE OR REPLACE FUNCTION enqueue_embedding_source_pack_rebuild()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_person_id text;
BEGIN
  IF NEW.state = 'active' THEN
    SELECT identity.person_id INTO v_person_id
    FROM current_face_identity identity
    JOIN face_observation face ON face.face_id = identity.face_id
    WHERE identity.face_id = NEW.face_id AND identity.state = 'accepted'
      AND (face.observation_origin <> 'manual_user' OR EXISTS (
        SELECT 1 FROM current_manual_face_matching_evidence evidence
        WHERE evidence.face_id = NEW.face_id
          AND evidence.identity_claim_id = identity.identity_claim_id
          AND evidence.model_family = NEW.model_family
          AND evidence.model_version = NEW.model_version
          AND evidence.config_digest = NEW.config_digest
          AND evidence.embedding_id = NEW.embedding_id
          AND evidence.vector_digest = NEW.vector_digest
      ))
    LIMIT 1;
    IF v_person_id IS NOT NULL THEN
      PERFORM enqueue_source_pack_rebuild(
        v_person_id, 'embedding_available', 'face_embedding', NEW.embedding_id,
        NEW.model_family, NEW.model_version, NEW.config_digest
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enqueue_quality_source_pack_rebuild()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_person_id text;
BEGIN
  IF OLD.quality_measurements IS DISTINCT FROM NEW.quality_measurements THEN
    SELECT identity.person_id INTO v_person_id
    FROM current_face_identity identity
    JOIN face_observation face ON face.face_id = identity.face_id
    WHERE identity.face_id = NEW.face_id AND identity.state = 'accepted'
      AND (face.observation_origin <> 'manual_user' OR EXISTS (
        SELECT 1 FROM current_manual_face_matching_evidence evidence
        WHERE evidence.face_id = NEW.face_id
          AND evidence.identity_claim_id = identity.identity_claim_id
      ))
    LIMIT 1;
    IF v_person_id IS NOT NULL THEN
      PERFORM enqueue_source_pack_rebuild(
        v_person_id, 'quality_changed', 'face_observation', NEW.face_id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enqueue_modifier_source_pack_rebuild()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_person_id text;
BEGIN
  SELECT identity.person_id INTO v_person_id
  FROM current_face_identity identity
  JOIN face_observation face ON face.face_id = identity.face_id
  WHERE identity.face_id = NEW.face_id AND identity.state = 'accepted'
    AND (face.observation_origin <> 'manual_user' OR EXISTS (
      SELECT 1 FROM current_manual_face_matching_evidence evidence
      WHERE evidence.face_id = NEW.face_id
        AND evidence.identity_claim_id = identity.identity_claim_id
    ))
  LIMIT 1;
  IF v_person_id IS NOT NULL THEN
    PERFORM enqueue_source_pack_rebuild(
      v_person_id, 'face_modifier_changed', 'face_modifier_event',
      NEW.modifier_event_id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enqueue_capture_context_source_pack_rebuild()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_person_id text;
BEGIN
  FOR v_person_id IN
    SELECT DISTINCT identity.person_id
    FROM (
      SELECT member.asset_id FROM current_capture_context_member member
      WHERE member.context_id = NEW.context_id
      UNION SELECT NEW.asset_id
    ) affected_asset
    JOIN face_observation face
      ON face.asset_id = affected_asset.asset_id AND face.state = 'valid'
    JOIN current_face_identity identity
      ON identity.face_id = face.face_id AND identity.state = 'accepted'
    WHERE face.observation_origin <> 'manual_user' OR EXISTS (
      SELECT 1 FROM current_manual_face_matching_evidence evidence
      WHERE evidence.face_id = face.face_id
        AND evidence.identity_claim_id = identity.identity_claim_id
    )
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM source_pack_rebuild_request request
      WHERE request.person_id = v_person_id
        AND request.reason_code = 'capture_context_changed'
        AND request.subject_type = 'capture_context'
        AND request.subject_id = NEW.context_id
        AND request.requested_at >= transaction_timestamp()
    ) THEN
      PERFORM enqueue_source_pack_rebuild(
        v_person_id, 'capture_context_changed', 'capture_context', NEW.context_id
      );
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_source_pack_activation_gate()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_manifest_mismatches integer;
  v_untrusted_references integer;
BEGIN
  IF NEW.state <> 'active' THEN RETURN NEW; END IF;
  IF NEW.evaluation_status <> 'passed' THEN
    RAISE EXCEPTION 'SourcePack activation requires passed evaluation'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM source_pack_reference reference WHERE reference.pack_id = NEW.pack_id
  ) THEN
    RAISE EXCEPTION 'SourcePack activation requires at least one reference'
      USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO v_manifest_mismatches FROM (
    SELECT coalesce(reference.reference_id, manifest.reference_id) AS reference_id
    FROM (
      SELECT reference_id, vector_digest FROM source_pack_reference
      WHERE pack_id = NEW.pack_id
    ) reference
    FULL OUTER JOIN (
      SELECT item->>'referenceId' AS reference_id,
        item->>'vectorDigest' AS vector_digest
      FROM jsonb_array_elements(
        coalesce(NEW.manifest->'referenceDigests', '[]'::jsonb)
      ) item
    ) manifest ON manifest.reference_id = reference.reference_id
      AND manifest.vector_digest = reference.vector_digest
    WHERE reference.reference_id IS NULL OR manifest.reference_id IS NULL
  ) mismatches;
  IF v_manifest_mismatches <> 0 THEN
    RAISE EXCEPTION 'SourcePack activation manifest/reference mismatch'
      USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO v_untrusted_references
  FROM source_pack_reference reference
  LEFT JOIN LATERAL (
    SELECT count(*) AS member_count, count(*) FILTER (
      WHERE identity.state = 'accepted'
        AND identity.person_id = reference.person_id
        AND (identity.origin IN ('trusted_import','user') OR decision.actor_kind = 'user')
        AND (face.observation_origin <> 'manual_user' OR EXISTS (
          SELECT 1 FROM current_manual_face_matching_evidence lifecycle
          WHERE lifecycle.face_id = member.face_id
            AND lifecycle.identity_claim_id = identity.identity_claim_id
            AND lifecycle.model_family = reference.model_family
            AND lifecycle.model_version = reference.model_version
            AND lifecycle.config_digest = reference.config_digest
            AND lifecycle.vector_digest = reference.vector_digest
        ))
    ) AS trusted_count
    FROM unnest(
      CASE WHEN reference.reference_kind = 'face'
        THEN ARRAY[reference.face_id] ELSE reference.member_face_ids END
    ) member(face_id)
    LEFT JOIN current_face_identity identity ON identity.face_id = member.face_id
    LEFT JOIN face_observation face ON face.face_id = member.face_id
    LEFT JOIN identity_claim claim
      ON claim.identity_claim_id = identity.identity_claim_id
    LEFT JOIN decision ON decision.decision_id = claim.decision_id
  ) trust ON true
  WHERE reference.pack_id = NEW.pack_id
    AND (
      reference.model_family <> NEW.model_family
      OR reference.model_version <> NEW.model_version
      OR reference.config_digest <> NEW.config_digest
      OR reference.dimension <> NEW.dimension
      OR trust.member_count = 0
      OR trust.trusted_count <> trust.member_count
    );
  IF v_untrusted_references <> 0 THEN
    RAISE EXCEPTION 'SourcePack activation contains ineligible or untrusted identity evidence'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM source_pack_evaluation evaluation
    WHERE evaluation.pack_id = NEW.pack_id AND evaluation.status = 'passed'
      AND coalesce((evaluation.leakage_assertions->>'passed')::boolean, false)
      AND coalesce((evaluation.metrics->>'verifiedUnknowns')::integer, 0) > 0
  ) THEN
    RAISE EXCEPTION 'SourcePack activation requires leakage-safe verified-unknown proof'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
