BEGIN;

ALTER TABLE identity_claim DROP CONSTRAINT identity_claim_check;
ALTER TABLE identity_claim ADD CONSTRAINT identity_claim_decision_state_check CHECK (
  (state = 'candidate' AND decision_id IS NULL)
  OR
  (state IN ('accepted','rejected','superseded') AND decision_id IS NOT NULL)
);

CREATE TABLE source_pack_rebuild_request (
    rebuild_request_id text PRIMARY KEY,
    person_id text NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    reason_code text NOT NULL,
    subject_type text NOT NULL,
    subject_id text NOT NULL,
    model_family text,
    model_version text,
    config_digest text,
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','completed','failed','superseded')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_error text,
    requested_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    completed_at timestamptz,
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric'
);

CREATE INDEX source_pack_rebuild_pending
    ON source_pack_rebuild_request(state, requested_at, person_id);

CREATE FUNCTION enqueue_source_pack_rebuild(
  p_person_id text,
  p_reason_code text,
  p_subject_type text,
  p_subject_id text,
  p_model_family text DEFAULT NULL,
  p_model_version text DEFAULT NULL,
  p_config_digest text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO source_pack_rebuild_request (
    rebuild_request_id, person_id, reason_code, subject_type, subject_id,
    model_family, model_version, config_digest
  ) VALUES (
    'rebuild_' || replace(gen_random_uuid()::text, '-', ''), p_person_id,
    p_reason_code, p_subject_type, p_subject_id,
    p_model_family, p_model_version, p_config_digest
  );
END;
$$;

CREATE FUNCTION enqueue_identity_source_pack_rebuild()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state = 'accepted' THEN
      PERFORM enqueue_source_pack_rebuild(NEW.person_id, 'identity_accepted', 'identity_claim', NEW.identity_claim_id);
    END IF;
  ELSIF OLD.state IS DISTINCT FROM NEW.state THEN
    IF OLD.state = 'accepted' THEN
      PERFORM enqueue_source_pack_rebuild(OLD.person_id, 'identity_removed', 'identity_claim', OLD.identity_claim_id);
    END IF;
    IF NEW.state = 'accepted' THEN
      PERFORM enqueue_source_pack_rebuild(NEW.person_id, 'identity_accepted', 'identity_claim', NEW.identity_claim_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER identity_source_pack_rebuild
AFTER INSERT OR UPDATE OF state ON identity_claim
FOR EACH ROW EXECUTE FUNCTION enqueue_identity_source_pack_rebuild();

CREATE FUNCTION enqueue_bucket_source_pack_rebuild()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_person_id text;
BEGIN
  IF NEW.actor_kind = 'user' THEN
    SELECT person_id INTO v_person_id FROM reference_bucket WHERE bucket_id = NEW.bucket_id;
    PERFORM enqueue_source_pack_rebuild(v_person_id, 'user_bucket_override', 'bucket_membership_event', NEW.membership_event_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bucket_source_pack_rebuild
AFTER INSERT ON bucket_membership_event
FOR EACH ROW EXECUTE FUNCTION enqueue_bucket_source_pack_rebuild();

CREATE FUNCTION enqueue_embedding_source_pack_rebuild()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_person_id text;
BEGIN
  IF NEW.state = 'active' THEN
    SELECT person_id INTO v_person_id
    FROM current_face_identity
    WHERE face_id = NEW.face_id AND state = 'accepted'
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

CREATE TRIGGER embedding_source_pack_rebuild
AFTER INSERT OR UPDATE OF state ON face_embedding
FOR EACH ROW EXECUTE FUNCTION enqueue_embedding_source_pack_rebuild();

CREATE FUNCTION enqueue_quality_source_pack_rebuild()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_person_id text;
BEGIN
  IF OLD.quality_measurements IS DISTINCT FROM NEW.quality_measurements THEN
    SELECT person_id INTO v_person_id
    FROM current_face_identity
    WHERE face_id = NEW.face_id AND state = 'accepted'
    LIMIT 1;
    IF v_person_id IS NOT NULL THEN
      PERFORM enqueue_source_pack_rebuild(v_person_id, 'quality_changed', 'face_observation', NEW.face_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER quality_source_pack_rebuild
AFTER UPDATE OF quality_measurements ON face_observation
FOR EACH ROW EXECUTE FUNCTION enqueue_quality_source_pack_rebuild();

COMMIT;
