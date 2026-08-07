BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_asset_correction_v1', 'system',
    'cimmich-asset-correction', 'v1', now(), now(),
    encode(digest('cimmich.asset-correction.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

-- Cimmich corrections are presentation/metadata truth owned by Cimmich. They
-- never update source bytes or Immich rows. Each accepted row is an immutable
-- value; state transitions retain the full supersession/undo history.
CREATE TABLE asset_correction (
    correction_id text PRIMARY KEY CHECK (correction_id ~ '^assetcorrection_[0-9a-f]{32}$'),
    asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    correction_kind text NOT NULL CHECK (correction_kind IN ('rotation','capture_time','place')),
    rotation_quarter_turns smallint,
    capture_time timestamptz,
    place_entity_id text REFERENCES context_entity(entity_id),
    state text NOT NULL CHECK (state IN ('active','superseded','reverted')),
    decision_id text NOT NULL UNIQUE REFERENCES decision(decision_id),
    supersedes_correction_id text REFERENCES asset_correction(correction_id),
    reverted_by_decision_id text UNIQUE REFERENCES decision(decision_id),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    reverted_at timestamptz,
    CHECK (
      (correction_kind = 'rotation'
        AND rotation_quarter_turns BETWEEN 0 AND 3
        AND capture_time IS NULL AND place_entity_id IS NULL)
      OR (correction_kind = 'capture_time'
        AND rotation_quarter_turns IS NULL
        AND capture_time IS NOT NULL AND place_entity_id IS NULL)
      OR (correction_kind = 'place'
        AND rotation_quarter_turns IS NULL
        AND capture_time IS NULL AND place_entity_id IS NOT NULL)
    ),
    CHECK ((state = 'reverted') =
      (reverted_by_decision_id IS NOT NULL AND reverted_at IS NOT NULL)),
    CHECK (supersedes_correction_id IS NULL OR supersedes_correction_id <> correction_id)
);

CREATE UNIQUE INDEX asset_correction_one_active_kind
  ON asset_correction(asset_id, correction_kind) WHERE state = 'active';
CREATE INDEX asset_correction_asset_history
  ON asset_correction(asset_id, correction_kind, created_at DESC, correction_id DESC);

CREATE TABLE asset_correction_command (
    command_id text PRIMARY KEY CHECK (command_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$'),
    command_kind text NOT NULL CHECK (command_kind IN ('rotate','set_capture_time','set_place','undo')),
    payload_digest text NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
    result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION enforce_asset_correction_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_asset_state text;
  v_place_kind text;
  v_place_status text;
BEGIN
  SELECT state INTO v_asset_state FROM asset WHERE asset_id = NEW.asset_id;
  IF v_asset_state IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Asset correction requires an active asset'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.correction_kind = 'place' THEN
    SELECT entity_kind, status INTO v_place_kind, v_place_status
    FROM context_entity WHERE entity_id = NEW.place_entity_id;
    IF v_place_kind IS DISTINCT FROM 'place'
       OR v_place_status NOT IN ('active','hidden') THEN
      RAISE EXCEPTION 'Asset place correction requires a current Place'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.supersedes_correction_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM asset_correction previous
    WHERE previous.correction_id = NEW.supersedes_correction_id
      AND previous.asset_id = NEW.asset_id
      AND previous.correction_kind = NEW.correction_kind
  ) THEN
    RAISE EXCEPTION 'Asset correction supersession crossed scope'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER asset_correction_scope
BEFORE INSERT OR UPDATE OF asset_id, correction_kind, place_entity_id,
  supersedes_correction_id ON asset_correction
FOR EACH ROW EXECUTE FUNCTION enforce_asset_correction_scope();

CREATE OR REPLACE FUNCTION protect_asset_correction_provenance()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Asset corrections are append-only'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.correction_id IS DISTINCT FROM OLD.correction_id
    OR NEW.asset_id IS DISTINCT FROM OLD.asset_id
    OR NEW.correction_kind IS DISTINCT FROM OLD.correction_kind
    OR NEW.rotation_quarter_turns IS DISTINCT FROM OLD.rotation_quarter_turns
    OR NEW.capture_time IS DISTINCT FROM OLD.capture_time
    OR NEW.place_entity_id IS DISTINCT FROM OLD.place_entity_id
    OR NEW.decision_id IS DISTINCT FROM OLD.decision_id
    OR NEW.supersedes_correction_id IS DISTINCT FROM OLD.supersedes_correction_id
    OR NEW.producer_receipt_id IS DISTINCT FROM OLD.producer_receipt_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Asset correction provenance is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER asset_correction_provenance_guard
BEFORE UPDATE OR DELETE ON asset_correction
FOR EACH ROW EXECUTE FUNCTION protect_asset_correction_provenance();

CREATE VIEW current_asset_correction AS
SELECT correction_id, asset_id, correction_kind, rotation_quarter_turns,
  capture_time, place_entity_id, decision_id, created_at
FROM asset_correction WHERE state = 'active';

COMMIT;
