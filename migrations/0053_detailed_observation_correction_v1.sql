BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_detailed_observation_correction_v1', 'system',
    'cimmich-detailed-observation-correction', 'v1', now(), now(),
    encode(digest('cimmich.detailed-observation-correction.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

ALTER TABLE face_observation
  ADD COLUMN current_revision bigint NOT NULL DEFAULT 1 CHECK (current_revision > 0),
  ADD COLUMN current_decision_id text REFERENCES decision(decision_id);

ALTER TABLE body_observation
  ADD COLUMN current_revision bigint NOT NULL DEFAULT 1 CHECK (current_revision > 0),
  ADD COLUMN current_decision_id text REFERENCES decision(decision_id);

CREATE TABLE observation_correction_command (
    command_id text PRIMARY KEY CHECK (command_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$'),
    command_kind text NOT NULL CHECK (command_kind IN ('geometry','not_face','not_body','undo')),
    payload_digest text NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
    result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE observation_correction_operation (
    operation_id text PRIMARY KEY CHECK (operation_id ~ '^obscorrection_[0-9a-f]{32}$'),
    command_id text NOT NULL UNIQUE REFERENCES observation_correction_command(command_id)
      DEFERRABLE INITIALLY DEFERRED,
    observation_kind text NOT NULL CHECK (observation_kind IN ('face','body')),
    observation_id text NOT NULL,
    asset_id text NOT NULL REFERENCES asset(asset_id),
    operation_kind text NOT NULL CHECK (operation_kind IN ('geometry','not_face','not_body')),
    prior_revision bigint NOT NULL CHECK (prior_revision > 0),
    result_revision bigint NOT NULL CHECK (result_revision = prior_revision + 1),
    prior_decision_id text REFERENCES decision(decision_id),
    decision_id text NOT NULL UNIQUE REFERENCES decision(decision_id),
    prior_region jsonb NOT NULL CHECK (jsonb_typeof(prior_region) = 'object'),
    result_region jsonb NOT NULL CHECK (jsonb_typeof(result_region) = 'object'),
    prior_state text NOT NULL CHECK (prior_state IN ('valid','hold','rejected')),
    result_state text NOT NULL CHECK (result_state IN ('valid','rejected')),
    snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
    state text NOT NULL CHECK (state IN ('active','superseded','reverted')),
    undo_decision_id text UNIQUE REFERENCES decision(decision_id),
    reverted_at timestamptz,
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((operation_kind = 'not_face') = (observation_kind = 'face' AND result_state = 'rejected')),
    CHECK ((operation_kind = 'not_body') = (observation_kind = 'body' AND result_state = 'rejected')),
    CHECK (operation_kind <> 'geometry' OR result_state = 'valid'),
    CHECK ((state = 'reverted') = (undo_decision_id IS NOT NULL AND reverted_at IS NOT NULL))
);

CREATE INDEX observation_correction_operation_observation
  ON observation_correction_operation(observation_kind, observation_id, created_at DESC);
CREATE UNIQUE INDEX observation_correction_operation_one_active
  ON observation_correction_operation(observation_kind, observation_id)
  WHERE state = 'active';

CREATE TABLE observation_rejection_tombstone (
    operation_id text PRIMARY KEY REFERENCES observation_correction_operation(operation_id),
    observation_kind text NOT NULL CHECK (observation_kind IN ('face','body')),
    observation_id text NOT NULL,
    decision_id text NOT NULL UNIQUE REFERENCES decision(decision_id),
    state text NOT NULL CHECK (state IN ('active','reverted')),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX observation_rejection_tombstone_one_active
  ON observation_rejection_tombstone(observation_kind, observation_id)
  WHERE state = 'active';

CREATE OR REPLACE FUNCTION enforce_observation_rejection_tombstone()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_observation_id text;
BEGIN
  IF TG_ARGV[0] = 'face' THEN
    v_observation_id := NEW.face_id;
  ELSE
    v_observation_id := NEW.body_id;
  END IF;
  IF NEW.state IS DISTINCT FROM 'rejected' AND EXISTS (
    SELECT 1 FROM observation_rejection_tombstone tombstone
    WHERE tombstone.observation_kind = TG_ARGV[0]
      AND tombstone.observation_id = v_observation_id
      AND tombstone.state = 'active'
  ) THEN
    RAISE EXCEPTION 'OBSERVATION_REJECTION_ACTIVE_DB' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER face_observation_rejection_guard
BEFORE UPDATE OF state ON face_observation
FOR EACH ROW EXECUTE FUNCTION enforce_observation_rejection_tombstone('face');
CREATE TRIGGER body_observation_rejection_guard
BEFORE UPDATE OF state ON body_observation
FOR EACH ROW EXECUTE FUNCTION enforce_observation_rejection_tombstone('body');

CREATE OR REPLACE FUNCTION prevent_observation_correction_provenance_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'OBSERVATION_CORRECTION_APPEND_ONLY_DB' USING ERRCODE = '23514';
  END IF;
  IF NEW.operation_id IS DISTINCT FROM OLD.operation_id
    OR NEW.command_id IS DISTINCT FROM OLD.command_id
    OR NEW.observation_kind IS DISTINCT FROM OLD.observation_kind
    OR NEW.observation_id IS DISTINCT FROM OLD.observation_id
    OR NEW.asset_id IS DISTINCT FROM OLD.asset_id
    OR NEW.operation_kind IS DISTINCT FROM OLD.operation_kind
    OR NEW.prior_revision IS DISTINCT FROM OLD.prior_revision
    OR NEW.result_revision IS DISTINCT FROM OLD.result_revision
    OR NEW.prior_decision_id IS DISTINCT FROM OLD.prior_decision_id
    OR NEW.decision_id IS DISTINCT FROM OLD.decision_id
    OR NEW.prior_region IS DISTINCT FROM OLD.prior_region
    OR NEW.result_region IS DISTINCT FROM OLD.result_region
    OR NEW.prior_state IS DISTINCT FROM OLD.prior_state
    OR NEW.result_state IS DISTINCT FROM OLD.result_state
    OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
  THEN
    RAISE EXCEPTION 'OBSERVATION_CORRECTION_PROVENANCE_IMMUTABLE_DB' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER observation_correction_operation_guard
BEFORE UPDATE OR DELETE ON observation_correction_operation
FOR EACH ROW EXECUTE FUNCTION prevent_observation_correction_provenance_mutation();

COMMIT;
