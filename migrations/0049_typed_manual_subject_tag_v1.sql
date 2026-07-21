BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_typed_manual_subject_tag_v1', 'system',
    'cimmich-typed-manual-subject-tag', 'v1', now(), now(),
    encode(digest('cimmich.typed-manual-subject-tag.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

ALTER TABLE face_observation
    ADD COLUMN observation_origin text NOT NULL DEFAULT 'detector_or_import',
    ALTER COLUMN detection_confidence DROP NOT NULL;

ALTER TABLE face_observation
    ADD CONSTRAINT face_observation_origin_check CHECK (
        observation_origin IN ('detector_or_import', 'manual_user')
    ),
    ADD CONSTRAINT face_observation_confidence_origin_check CHECK (
        (observation_origin = 'manual_user' AND detection_confidence IS NULL)
        OR
        (observation_origin = 'detector_or_import' AND detection_confidence IS NOT NULL)
    );

CREATE OR REPLACE FUNCTION enforce_face_observation_origin_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.observation_origin IS DISTINCT FROM OLD.observation_origin THEN
        RAISE EXCEPTION 'FACE_OBSERVATION_ORIGIN_IMMUTABLE_DB'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER face_observation_origin_immutable
BEFORE UPDATE OF observation_origin ON face_observation
FOR EACH ROW EXECUTE FUNCTION enforce_face_observation_origin_immutability();

CREATE TABLE manual_subject_tag_command (
    command_id text PRIMARY KEY
        CHECK (command_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$'),
    command_kind text NOT NULL CHECK (command_kind IN ('attach','undo','matching_transition')),
    actor_id text NOT NULL CHECK (length(btrim(actor_id)) BETWEEN 1 AND 120),
    request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
    decision_id text REFERENCES decision(decision_id),
    response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE manual_subject_tag_operation (
    operation_id text PRIMARY KEY,
    command_id text NOT NULL UNIQUE REFERENCES manual_subject_tag_command(command_id),
    subject_id text NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    subject_kind text NOT NULL CHECK (subject_kind IN ('person','pet')),
    asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    tag_type text NOT NULL CHECK (tag_type IN ('face','body','presence')),
    tag_id text NOT NULL UNIQUE,
    observation_id text,
    decision_id text NOT NULL UNIQUE REFERENCES decision(decision_id),
    previous_tag_id text,
    snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
    state text NOT NULL CHECK (state IN ('active','reverted')),
    undo_decision_id text UNIQUE REFERENCES decision(decision_id),
    reverted_at timestamptz,
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((tag_type = 'presence') = (observation_id IS NULL)),
    CHECK ((state = 'reverted') =
      (undo_decision_id IS NOT NULL AND reverted_at IS NOT NULL))
);

CREATE INDEX manual_subject_tag_operation_asset
    ON manual_subject_tag_operation(asset_id, state, created_at DESC);
CREATE INDEX manual_subject_tag_operation_subject
    ON manual_subject_tag_operation(
      subject_kind, subject_id, state, created_at DESC
    );

CREATE TABLE manual_face_matching_lifecycle (
    lifecycle_id text PRIMARY KEY,
    operation_id text NOT NULL REFERENCES manual_subject_tag_operation(operation_id),
    identity_claim_id text NOT NULL REFERENCES identity_claim(identity_claim_id),
    face_id text NOT NULL REFERENCES face_observation(face_id),
    scope_key text NOT NULL CHECK (
      scope_key = 'provider_neutral' OR scope_key ~ '^[0-9a-f]{64}$'
    ),
    state text NOT NULL CHECK (state IN (
      'pending_provider','pending_embedding','pending_quality',
      'eligible_for_evaluation','abstained','cancelled'
    )),
    reason text CHECK (reason IS NULL OR reason IN (
      'no_compatible_provider','invalid_face','quality_failed','embedding_unavailable'
    )),
    provider_id text,
    model_family text,
    model_version text,
    config_digest text,
    vector_space_id text,
    embedding_id text REFERENCES face_embedding(embedding_id),
    vector_digest text,
    evidence_digest text,
    evidence_tier text CHECK (evidence_tier IS NULL OR evidence_tier IN ('secondary','specialty','low_quality')),
    rebuild_request_id text REFERENCES source_pack_rebuild_request(rebuild_request_id),
    supersedes_lifecycle_id text UNIQUE REFERENCES manual_face_matching_lifecycle(lifecycle_id),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
      (state = 'pending_provider' AND scope_key = 'provider_neutral'
        AND provider_id IS NULL AND model_family IS NULL AND model_version IS NULL
        AND config_digest IS NULL AND vector_space_id IS NULL
        AND embedding_id IS NULL AND vector_digest IS NULL AND evidence_digest IS NULL
        AND evidence_tier IS NULL AND reason IS NULL)
      OR
      (state = 'cancelled' AND (
        (scope_key = 'provider_neutral' AND provider_id IS NULL AND model_family IS NULL
          AND model_version IS NULL AND config_digest IS NULL AND vector_space_id IS NULL)
        OR
        (scope_key <> 'provider_neutral' AND provider_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
          AND model_family ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
          AND model_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
          AND config_digest ~ '^[0-9a-f]{64}$'
          AND vector_space_id ~ '^[a-z0-9][a-z0-9._-]{0,95}$')))
      OR
      (state NOT IN ('pending_provider','cancelled') AND scope_key <> 'provider_neutral'
        AND provider_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
        AND model_family ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
        AND model_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
        AND config_digest ~ '^[0-9a-f]{64}$'
        AND vector_space_id ~ '^[a-z0-9][a-z0-9._-]{0,95}$')
    ),
    CHECK ((state = 'abstained') = (reason IS NOT NULL)),
    CHECK (state <> 'eligible_for_evaluation'),
    CHECK (
      state <> 'eligible_for_evaluation' OR
      (embedding_id IS NOT NULL AND vector_digest ~ '^[0-9a-f]{64}$'
       AND evidence_digest ~ '^[0-9a-f]{64}$' AND evidence_tier IS NOT NULL)
    ),
    CHECK (state <> 'cancelled' OR rebuild_request_id IS NULL)
);

CREATE INDEX manual_face_matching_lifecycle_operation
  ON manual_face_matching_lifecycle(operation_id, scope_key, created_at DESC);

CREATE OR REPLACE FUNCTION enforce_manual_face_matching_lifecycle()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_previous manual_face_matching_lifecycle%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'MANUAL_FACE_MATCHING_LIFECYCLE_APPEND_ONLY_DB' USING ERRCODE = '23514';
  END IF;
  IF NEW.state = 'eligible_for_evaluation' THEN
    RAISE EXCEPTION 'MANUAL_FACE_RECOGNITION_EVIDENCE_REQUIRED_DB'
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
    RAISE EXCEPTION 'MANUAL_FACE_MATCHING_PROVENANCE_INVALID_DB' USING ERRCODE = '23514';
  END IF;
  IF NEW.supersedes_lifecycle_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM manual_face_matching_lifecycle prior
      WHERE prior.operation_id = NEW.operation_id AND prior.scope_key = NEW.scope_key) THEN
      RAISE EXCEPTION 'MANUAL_FACE_MATCHING_SCOPE_ALREADY_EXISTS_DB' USING ERRCODE = '23505';
    END IF;
  ELSE
    SELECT * INTO v_previous FROM manual_face_matching_lifecycle
    WHERE lifecycle_id = NEW.supersedes_lifecycle_id;
    IF v_previous.lifecycle_id IS NULL OR v_previous.operation_id <> NEW.operation_id
       OR v_previous.scope_key <> NEW.scope_key OR v_previous.state = 'cancelled'
       OR EXISTS (SELECT 1 FROM manual_face_matching_lifecycle successor
         WHERE successor.supersedes_lifecycle_id = v_previous.lifecycle_id) THEN
      RAISE EXCEPTION 'MANUAL_FACE_MATCHING_SUPERSESSION_INVALID_DB' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER manual_face_matching_lifecycle_guard
BEFORE INSERT OR UPDATE OR DELETE ON manual_face_matching_lifecycle
FOR EACH ROW EXECUTE FUNCTION enforce_manual_face_matching_lifecycle();

CREATE VIEW current_manual_face_matching_lifecycle AS
SELECT lifecycle.* FROM manual_face_matching_lifecycle lifecycle
WHERE NOT EXISTS (
  SELECT 1 FROM manual_face_matching_lifecycle successor
  WHERE successor.supersedes_lifecycle_id = lifecycle.lifecycle_id
);

CREATE OR REPLACE FUNCTION cimmich_manual_face_evidence_digest(p_face_id text)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT encode(digest(jsonb_build_object(
    'quality', face.quality_measurements,
    'modifiers', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'key', modifier.modifier_key, 'class', modifier.modifier_class,
        'confidence', modifier.confidence, 'metadata', modifier.metadata
      ) ORDER BY modifier.modifier_key)
      FROM current_face_modifier modifier WHERE modifier.face_id = face.face_id
    ), '[]'::jsonb),
    'contexts', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'contextId', context.context_id, 'kind', context.context_kind,
        'confidence', context.context_confidence,
        'features', context.grouping_features
      ) ORDER BY context.context_kind, context.context_id)
      FROM current_face_capture_context context WHERE context.face_id = face.face_id
    ), '[]'::jsonb)
  )::text, 'sha256'), 'hex')
  FROM face_observation face WHERE face.face_id = p_face_id;
$$;

INSERT INTO cimmich_visibility_projection_surface (
    surface_key, coverage_state, asset_derived, route_family, reason_code,
    producer_receipt_id
) VALUES (
    'manual_subject_tags', 'enforced', true,
    '/v1/assets/:assetId/manual-subject-tags', NULL,
    'receipt_cimmich_typed_manual_subject_tag_v1'
);

CREATE OR REPLACE FUNCTION enqueue_identity_source_pack_rebuild()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state = 'accepted' AND NOT EXISTS (
      SELECT 1 FROM face_observation face
      WHERE face.face_id = NEW.face_id AND face.observation_origin = 'manual_user'
    ) THEN
      PERFORM enqueue_source_pack_rebuild(NEW.person_id, 'identity_accepted', 'identity_claim', NEW.identity_claim_id);
    END IF;
  ELSIF OLD.state IS DISTINCT FROM NEW.state THEN
    IF OLD.state = 'accepted' AND (
      NOT EXISTS (SELECT 1 FROM face_observation face
        WHERE face.face_id = OLD.face_id AND face.observation_origin = 'manual_user')
      OR EXISTS (SELECT 1 FROM source_pack_reference reference
        WHERE reference.face_id = OLD.face_id OR OLD.face_id = ANY(reference.member_face_ids))
    ) THEN
      PERFORM enqueue_source_pack_rebuild(OLD.person_id, 'identity_removed', 'identity_claim', OLD.identity_claim_id);
    END IF;
    IF NEW.state = 'accepted' AND NOT EXISTS (
      SELECT 1 FROM face_observation face
      WHERE face.face_id = NEW.face_id AND face.observation_origin = 'manual_user'
    ) THEN
      PERFORM enqueue_source_pack_rebuild(NEW.person_id, 'identity_accepted', 'identity_claim', NEW.identity_claim_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enqueue_embedding_source_pack_rebuild()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_person_id text;
BEGIN
  IF NEW.state = 'active' THEN
    SELECT person_id INTO v_person_id
    FROM current_face_identity identity
    JOIN face_observation face ON face.face_id = identity.face_id
    WHERE identity.face_id = NEW.face_id AND identity.state = 'accepted'
      AND (face.observation_origin <> 'manual_user' OR EXISTS (
        SELECT 1 FROM current_manual_face_matching_lifecycle lifecycle
        WHERE lifecycle.face_id = NEW.face_id
          AND lifecycle.state = 'eligible_for_evaluation'
          AND lifecycle.model_family = NEW.model_family
          AND lifecycle.model_version = NEW.model_version
          AND lifecycle.config_digest = NEW.config_digest
          AND lifecycle.embedding_id = NEW.embedding_id
          AND lifecycle.vector_digest = NEW.vector_digest
          AND lifecycle.evidence_digest = cimmich_manual_face_evidence_digest(NEW.face_id)
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
    SELECT person_id INTO v_person_id
    FROM current_face_identity identity
    JOIN face_observation face ON face.face_id = identity.face_id
    WHERE identity.face_id = NEW.face_id AND identity.state = 'accepted'
      AND (face.observation_origin <> 'manual_user' OR EXISTS (
        SELECT 1 FROM current_manual_face_matching_lifecycle lifecycle
        JOIN face_embedding embedding ON embedding.embedding_id = lifecycle.embedding_id
        WHERE lifecycle.face_id = NEW.face_id
          AND lifecycle.state = 'eligible_for_evaluation'
          AND lifecycle.vector_digest = embedding.vector_digest
          AND lifecycle.evidence_digest = cimmich_manual_face_evidence_digest(NEW.face_id)
      ))
    LIMIT 1;
    IF v_person_id IS NOT NULL THEN
      PERFORM enqueue_source_pack_rebuild(v_person_id, 'quality_changed', 'face_observation', NEW.face_id);
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
    SELECT person_id INTO v_person_id
    FROM current_face_identity identity
    JOIN face_observation face ON face.face_id = identity.face_id
    WHERE identity.face_id = NEW.face_id AND identity.state = 'accepted'
      AND (face.observation_origin <> 'manual_user' OR EXISTS (
        SELECT 1 FROM current_manual_face_matching_lifecycle lifecycle
        JOIN face_embedding embedding ON embedding.embedding_id = lifecycle.embedding_id
        WHERE lifecycle.face_id = NEW.face_id
          AND lifecycle.state = 'eligible_for_evaluation'
          AND lifecycle.vector_digest = embedding.vector_digest
          AND lifecycle.evidence_digest = cimmich_manual_face_evidence_digest(NEW.face_id)
      ))
    LIMIT 1;
    IF v_person_id IS NOT NULL THEN
        PERFORM enqueue_source_pack_rebuild(
            v_person_id, 'face_modifier_changed', 'face_modifier_event', NEW.modifier_event_id
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
            SELECT member.asset_id
            FROM current_capture_context_member member
            WHERE member.context_id = NEW.context_id
            UNION
            SELECT NEW.asset_id
        ) affected_asset
        JOIN face_observation face
          ON face.asset_id = affected_asset.asset_id AND face.state = 'valid'
        JOIN current_face_identity identity
          ON identity.face_id = face.face_id AND identity.state = 'accepted'
        WHERE face.observation_origin <> 'manual_user' OR EXISTS (
          SELECT 1 FROM current_manual_face_matching_lifecycle lifecycle
          JOIN face_embedding embedding ON embedding.embedding_id = lifecycle.embedding_id
          WHERE lifecycle.face_id = face.face_id
            AND lifecycle.state = 'eligible_for_evaluation'
            AND lifecycle.vector_digest = embedding.vector_digest
            AND lifecycle.evidence_digest = cimmich_manual_face_evidence_digest(face.face_id)
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

CREATE OR REPLACE FUNCTION sync_face_body_linkage_with_identity_claim()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_previous body_tag%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.state = 'accepted'
    AND NEW.state IS DISTINCT FROM 'accepted' THEN
    UPDATE body_tag SET state = 'superseded'
    WHERE origin = 'face_body_linkage' AND state = 'accepted'
      AND supporting_face_id = OLD.face_id
      AND identity_claim_id = OLD.identity_claim_id;
  END IF;

  IF NEW.state = 'accepted'
    AND (TG_OP = 'INSERT' OR OLD.state IS DISTINCT FROM 'accepted') THEN
    SELECT tag.* INTO v_previous
    FROM body_tag tag
    WHERE tag.origin = 'face_body_linkage'
      AND tag.supporting_face_id = NEW.face_id
      AND tag.state = 'superseded'
    ORDER BY tag.created_at DESC, tag.body_tag_id DESC
    LIMIT 1;
    IF v_previous.body_tag_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM body_tag current
        WHERE current.body_id = v_previous.body_id AND current.state = 'accepted'
      ) THEN
      INSERT INTO body_tag (
        body_tag_id, person_id, body_id, origin, state, supporting_face_id,
        identity_claim_id, confidence, decision_id, supersedes_body_tag_id,
        producer_receipt_id, privacy_class
      ) VALUES (
        'bodytag_' || replace(gen_random_uuid()::text, '-', ''),
        NEW.person_id, v_previous.body_id, 'face_body_linkage', 'accepted', NEW.face_id,
        NEW.identity_claim_id, v_previous.confidence, NEW.decision_id,
        v_previous.body_tag_id, NEW.producer_receipt_id, v_previous.privacy_class
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_face_body_linkage_consistency()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_valid boolean;
BEGIN
  IF NEW.origin <> 'face_body_linkage' THEN RETURN NEW; END IF;
  SELECT true INTO v_valid
  FROM face_observation face
  JOIN body_observation body
    ON body.body_id = NEW.body_id AND body.asset_id = face.asset_id
  JOIN identity_claim claim
    ON claim.identity_claim_id = NEW.identity_claim_id
    AND claim.face_id = face.face_id
    AND claim.person_id = NEW.person_id
  WHERE face.face_id = NEW.supporting_face_id
    AND face.state = 'valid' AND body.state = 'valid'
    AND (NEW.state <> 'accepted' OR claim.state = 'accepted');
  IF NOT coalesce(v_valid, false) THEN
    RAISE EXCEPTION 'Face/body linkage requires matching-eligible accepted identity evidence'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION retire_source_pack_for_identity_correction()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_face_id text := OLD.face_id;
  v_person_id text := OLD.person_id;
  v_invalidated boolean := false;
BEGIN
  IF OLD.state = 'accepted' THEN
    IF TG_OP = 'DELETE' THEN
      v_invalidated := true;
    ELSE
      v_invalidated := NEW.state IS DISTINCT FROM 'accepted'
        OR NEW.person_id IS DISTINCT FROM OLD.person_id
        OR NEW.origin IS DISTINCT FROM OLD.origin
        OR NEW.decision_id IS DISTINCT FROM OLD.decision_id;
    END IF;
  END IF;
  IF v_invalidated THEN
    UPDATE source_pack pack SET state = 'retired'
    WHERE pack.state = 'active'
      AND EXISTS (
        SELECT 1 FROM source_pack_reference reference
        WHERE reference.pack_id = pack.pack_id
          AND reference.person_id = v_person_id
          AND (reference.face_id = v_face_id OR v_face_id = ANY(reference.member_face_ids))
      );
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_bucket_membership_invariants()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_person_id text;
    v_bucket_kind text;
    v_latest_action text;
    v_latest_actor text;
BEGIN
    SELECT person_id, bucket_kind INTO v_person_id, v_bucket_kind
    FROM reference_bucket WHERE bucket_id = NEW.bucket_id;
    SELECT action, actor_kind INTO v_latest_action, v_latest_actor
    FROM bucket_membership_event
    WHERE bucket_id = NEW.bucket_id AND face_id = NEW.face_id
    ORDER BY created_at DESC, membership_event_id DESC LIMIT 1;
    IF NEW.actor_kind = 'policy' AND v_latest_actor = 'user'
       AND v_latest_action = 'pin'
       AND NEW.action IN ('demote','remove','ban') THEN
        RAISE EXCEPTION 'policy cannot override user pin' USING ERRCODE = '23514';
    END IF;
    IF NEW.actor_kind = 'policy' AND v_latest_actor = 'user'
       AND v_latest_action = 'ban'
       AND NEW.action IN ('activate','pin','unpin','unban') THEN
        RAISE EXCEPTION 'policy cannot override user ban' USING ERRCODE = '23514';
    END IF;
    IF NEW.action IN ('activate','pin','unpin') THEN
        IF NOT EXISTS (
            SELECT 1 FROM identity_claim claim
            JOIN face_observation face ON face.face_id = claim.face_id
            WHERE claim.face_id = NEW.face_id AND claim.person_id = v_person_id
              AND claim.state = 'accepted'
              AND (face.observation_origin <> 'manual_user' OR EXISTS (
                SELECT 1 FROM current_manual_face_matching_lifecycle lifecycle
                JOIN face_embedding embedding ON embedding.embedding_id = lifecycle.embedding_id
                WHERE lifecycle.face_id = face.face_id
                  AND lifecycle.state = 'eligible_for_evaluation'
                  AND lifecycle.vector_digest = embedding.vector_digest
                  AND lifecycle.evidence_digest = cimmich_manual_face_evidence_digest(face.face_id)
              ))
        ) THEN
            RAISE EXCEPTION 'active evidence requires matching-ready accepted identity'
              USING ERRCODE = '23514';
        END IF;
        IF v_bucket_kind IN ('prime','secondary','lq','head') AND EXISTS (
            WITH latest_other AS (
                SELECT DISTINCT ON (event.bucket_id) event.bucket_id, event.action
                FROM bucket_membership_event event
                JOIN reference_bucket bucket ON bucket.bucket_id = event.bucket_id
                WHERE event.face_id = NEW.face_id
                  AND bucket.person_id = v_person_id
                  AND bucket.bucket_kind IN ('prime','secondary','lq','head')
                  AND bucket.bucket_id <> NEW.bucket_id
                ORDER BY event.bucket_id, event.created_at DESC,
                  event.membership_event_id DESC
            ) SELECT 1 FROM latest_other WHERE action IN ('activate','pin','unpin')
        ) THEN
            RAISE EXCEPTION 'face cannot be active in more than one main evidence tier'
              USING ERRCODE = '23514';
        END IF;
        IF v_bucket_kind = 'head' AND EXISTS (
            SELECT 1 FROM current_reference_gallery gallery
            WHERE gallery.person_id = v_person_id AND gallery.face_id = NEW.face_id
              AND gallery.bucket_kind = 'specialty'
              AND gallery.membership_state = 'active'
        ) THEN
            RAISE EXCEPTION 'head evidence cannot overlap a matching Specialty'
              USING ERRCODE = '23514';
        END IF;
        IF v_bucket_kind = 'specialty' AND EXISTS (
            SELECT 1 FROM current_reference_gallery gallery
            WHERE gallery.person_id = v_person_id AND gallery.face_id = NEW.face_id
              AND gallery.bucket_kind = 'head'
              AND gallery.membership_state = 'active'
        ) THEN
            RAISE EXCEPTION 'matching Specialty cannot overlap head evidence'
              USING ERRCODE = '23514';
        END IF;
    END IF;
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
    RAISE EXCEPTION 'SourcePack activation requires passed evaluation' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM source_pack_reference reference WHERE reference.pack_id = NEW.pack_id) THEN
    RAISE EXCEPTION 'SourcePack activation requires at least one reference' USING ERRCODE = '23514';
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
      FROM jsonb_array_elements(coalesce(NEW.manifest->'referenceDigests', '[]'::jsonb)) item
    ) manifest ON manifest.reference_id = reference.reference_id
      AND manifest.vector_digest = reference.vector_digest
    WHERE reference.reference_id IS NULL OR manifest.reference_id IS NULL
  ) mismatches;
  IF v_manifest_mismatches <> 0 THEN
    RAISE EXCEPTION 'SourcePack activation manifest/reference mismatch' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO v_untrusted_references
  FROM source_pack_reference reference
  LEFT JOIN LATERAL (
    SELECT count(*) AS member_count, count(*) FILTER (
      WHERE identity.state = 'accepted'
        AND identity.person_id = reference.person_id
        AND (identity.origin IN ('trusted_import','user') OR decision.actor_kind = 'user')
        AND (face.observation_origin <> 'manual_user' OR EXISTS (
          SELECT 1 FROM current_manual_face_matching_lifecycle lifecycle
          JOIN face_embedding embedding ON embedding.embedding_id = lifecycle.embedding_id
          WHERE lifecycle.face_id = member.face_id
            AND lifecycle.state = 'eligible_for_evaluation'
            AND lifecycle.model_family = reference.model_family
            AND lifecycle.model_version = reference.model_version
            AND lifecycle.config_digest = reference.config_digest
            AND lifecycle.embedding_id = embedding.embedding_id
            AND lifecycle.vector_digest = reference.vector_digest
            AND lifecycle.vector_digest = embedding.vector_digest
            AND lifecycle.evidence_digest = cimmich_manual_face_evidence_digest(member.face_id)
        ))
    ) AS trusted_count
    FROM unnest(
      CASE WHEN reference.reference_kind = 'face'
        THEN ARRAY[reference.face_id] ELSE reference.member_face_ids END
    ) member(face_id)
    LEFT JOIN current_face_identity identity
      ON identity.face_id = member.face_id
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
