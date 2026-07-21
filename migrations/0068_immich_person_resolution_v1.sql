BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_immich_person_resolution_v1', 'system',
    'cimmich-immich-person-resolution', 'v1', now(), now(),
    encode(digest('cimmich.immich-person-resolution.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
    completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

CREATE TABLE immich_person_resolution (
    resolution_id text PRIMARY KEY CHECK (
      resolution_id ~ '^immich_person_resolution_[0-9a-f]{32}$'
    ),
    source_id text NOT NULL CHECK (
      source_id = btrim(source_id) AND length(source_id) BETWEEN 1 AND 120
    ),
    immich_person_id text NOT NULL CHECK (
      immich_person_id = btrim(immich_person_id)
      AND length(immich_person_id) BETWEEN 1 AND 200
    ),
    source_revision text NOT NULL CHECK (source_revision ~ '^[0-9a-f]{64}$'),
    snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^[0-9a-f]{64}$'),
    representative_source_asset_id text NOT NULL CHECK (
      representative_source_asset_id = btrim(representative_source_asset_id)
      AND length(representative_source_asset_id) BETWEEN 1 AND 200
    ),
    representative_face_id text NOT NULL CHECK (
      representative_face_id = btrim(representative_face_id)
      AND length(representative_face_id) BETWEEN 1 AND 200
    ),
    representative_asset_input_revision text NOT NULL CHECK (
      representative_asset_input_revision ~ '^[0-9a-f]{64}$'
    ),
    face_count integer NOT NULL CHECK (face_count BETWEEN 1 AND 100000),
    resolution_action text NOT NULL CHECK (resolution_action IN (
      'existing_person','create_person','later','unknown','noise'
    )),
    person_id text REFERENCES person(person_id),
    created_person boolean NOT NULL DEFAULT false,
    state text NOT NULL CHECK (state IN ('active','superseded','reverted')),
    decision_id text NOT NULL UNIQUE REFERENCES decision(decision_id),
    supersedes_resolution_id text REFERENCES immich_person_resolution(resolution_id),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'sensitive-biometric',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
      (resolution_action IN ('existing_person','create_person')) = (person_id IS NOT NULL)
    ),
    CHECK (created_person = (resolution_action = 'create_person'))
);

CREATE UNIQUE INDEX immich_person_resolution_one_active
    ON immich_person_resolution(source_id, immich_person_id)
    WHERE state = 'active';

CREATE TABLE immich_person_resolution_command (
    command_id text PRIMARY KEY CHECK (
      command_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$'
    ),
    command_kind text NOT NULL CHECK (command_kind IN ('resolve','undo')),
    actor_id text NOT NULL CHECK (
      actor_id = btrim(actor_id) AND length(actor_id) BETWEEN 1 AND 120
    ),
    subject_id text NOT NULL CHECK (
      subject_id = btrim(subject_id) AND length(subject_id) BETWEEN 1 AND 200
    ),
    request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
    response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    completed_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION enforce_immich_person_resolution_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.resolution_id <> NEW.resolution_id
    OR OLD.source_id <> NEW.source_id
    OR OLD.immich_person_id <> NEW.immich_person_id
    OR OLD.source_revision <> NEW.source_revision
    OR OLD.snapshot_digest <> NEW.snapshot_digest
    OR OLD.representative_source_asset_id <> NEW.representative_source_asset_id
    OR OLD.representative_face_id <> NEW.representative_face_id
    OR OLD.representative_asset_input_revision <> NEW.representative_asset_input_revision
    OR OLD.face_count <> NEW.face_count
    OR OLD.resolution_action <> NEW.resolution_action
    OR OLD.person_id IS DISTINCT FROM NEW.person_id
    OR OLD.created_person <> NEW.created_person
    OR OLD.decision_id <> NEW.decision_id
    OR OLD.supersedes_resolution_id IS DISTINCT FROM NEW.supersedes_resolution_id
    OR OLD.producer_receipt_id <> NEW.producer_receipt_id
    OR OLD.privacy_class <> NEW.privacy_class
    OR OLD.schema_version <> NEW.schema_version
    OR OLD.created_at <> NEW.created_at THEN
    RAISE EXCEPTION 'Immich Person resolution evidence is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NOT (OLD.state = 'active' AND NEW.state IN ('superseded','reverted')) THEN
    RAISE EXCEPTION 'Invalid Immich Person resolution lifecycle transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER immich_person_resolution_immutable
BEFORE UPDATE ON immich_person_resolution
FOR EACH ROW EXECUTE FUNCTION enforce_immich_person_resolution_immutable();

ALTER TABLE immich_face_projection
    DROP CONSTRAINT immich_face_projection_reconciliation_state_check,
    ADD CONSTRAINT immich_face_projection_reconciliation_state_check CHECK (
      reconciliation_state IN (
        'unassigned','source_only','exact_provider_bind','ambiguous_provider_bind',
        'missing_provider_face','stale_asset_revision','person_conflict',
        'identity_conflict','owner_unknown','owner_noise'
      )
    );

COMMIT;
