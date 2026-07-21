BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_pet_profile_document_v1', 'system',
    'cimmich-pet-profile-document', 'v1', now(), now(),
    encode(digest('cimmich-pet-profile-document-v1', 'sha256'), 'hex'),
    'release-safe'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
    completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

ALTER TABLE person ADD COLUMN breed_label text;
ALTER TABLE person ADD CONSTRAINT person_breed_pet_only CHECK (
    subject_kind = 'pet' OR breed_label IS NULL
), ADD CONSTRAINT person_breed_label_shape CHECK (
    breed_label IS NULL OR (
        breed_label = btrim(breed_label)
        AND length(breed_label) BETWEEN 1 AND 120
    )
);

CREATE OR REPLACE VIEW current_person AS
SELECT p.person_id, p.display_name, p.status, p.current_revision,
       COALESCE(array_agg(pa.label ORDER BY pa.created_at)
         FILTER (WHERE pa.state = 'active'), ARRAY[]::text[]) AS aliases,
       p.subject_kind, p.merged_into_person_id, p.description,
       p.cover_asset_id, p.cover_crop, p.species_kind, p.species_label,
       p.breed_label
FROM person p
LEFT JOIN person_alias pa ON pa.person_id = p.person_id
WHERE p.status IN ('active','hidden')
GROUP BY p.person_id;

CREATE TABLE pet_document_link (
    link_id text PRIMARY KEY CHECK (
        link_id ~ '^petdoc_[0-9a-f]{32}$'
    ),
    pet_id text NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    asset_id text NOT NULL REFERENCES asset(asset_id) ON DELETE CASCADE,
    document_kind text NOT NULL CHECK (document_kind IN (
        'veterinary','vaccination','registration','insurance','adoption',
        'receipt','care','other'
    )),
    document_label text CHECK (
        document_label IS NULL OR (
            document_label = btrim(document_label)
            AND length(document_label) BETWEEN 1 AND 120
        )
    ),
    state text NOT NULL CHECK (state IN ('accepted','rejected','superseded')),
    decision_id text NOT NULL REFERENCES decision(decision_id),
    supersedes_link_id text REFERENCES pet_document_link(link_id),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (supersedes_link_id IS NULL OR supersedes_link_id <> link_id)
);

CREATE UNIQUE INDEX pet_document_link_one_current
    ON pet_document_link(pet_id, asset_id)
    WHERE state IN ('accepted','rejected');
CREATE INDEX pet_document_link_pet_current
    ON pet_document_link(pet_id, created_at DESC, link_id DESC)
    WHERE state = 'accepted';
CREATE INDEX pet_document_link_asset_current
    ON pet_document_link(asset_id, pet_id)
    WHERE state = 'accepted';

CREATE FUNCTION enforce_pet_document_link_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_subject_kind text;
  v_pet_status text;
  v_asset_state text;
BEGIN
  SELECT subject_kind, status INTO v_subject_kind, v_pet_status
  FROM person WHERE person_id = NEW.pet_id;
  SELECT state INTO v_asset_state FROM asset WHERE asset_id = NEW.asset_id;
  IF v_subject_kind IS DISTINCT FROM 'pet'
     OR v_pet_status NOT IN ('active','hidden') THEN
    RAISE EXCEPTION 'Pet document link requires an active or hidden Pet'
      USING ERRCODE = '23514';
  END IF;
  IF v_asset_state IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Pet document link requires an active Cimmich asset'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.supersedes_link_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pet_document_link previous
    WHERE previous.link_id = NEW.supersedes_link_id
      AND previous.pet_id = NEW.pet_id
      AND previous.asset_id = NEW.asset_id
  ) THEN
    RAISE EXCEPTION 'Pet document link cannot supersede another subject or asset'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pet_document_link_scope
BEFORE INSERT OR UPDATE OF pet_id, asset_id, supersedes_link_id
ON pet_document_link
FOR EACH ROW EXECUTE FUNCTION enforce_pet_document_link_scope();

CREATE VIEW current_pet_document AS
SELECT link_id, pet_id, asset_id, document_kind, document_label, decision_id,
       created_at
FROM pet_document_link
WHERE state = 'accepted';

CREATE TABLE pet_document_command (
    command_id text PRIMARY KEY CHECK (
        command_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$'
    ),
    command_kind text NOT NULL CHECK (command_kind IN ('attach','detach','undo')),
    actor_id text NOT NULL CHECK (
        actor_id = btrim(actor_id) AND length(actor_id) BETWEEN 1 AND 120
    ),
    request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
    decision_id text REFERENCES decision(decision_id),
    response jsonb NOT NULL,
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pet_document_operation (
    operation_id text PRIMARY KEY CHECK (operation_id ~ '^petdocop_[0-9a-f]{32}$'),
    command_id text NOT NULL UNIQUE REFERENCES pet_document_command(command_id),
    pet_id text NOT NULL REFERENCES person(person_id) ON DELETE CASCADE,
    action text NOT NULL CHECK (action IN ('attach','detach')),
    decision_id text NOT NULL UNIQUE REFERENCES decision(decision_id),
    state text NOT NULL CHECK (state IN ('active','reverted')),
    snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'array'),
    undo_decision_id text UNIQUE REFERENCES decision(decision_id),
    reverted_at timestamptz,
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((state = 'reverted') =
      (undo_decision_id IS NOT NULL AND reverted_at IS NOT NULL))
);

CREATE INDEX pet_document_operation_pet_state
    ON pet_document_operation(pet_id, state, created_at DESC);

COMMIT;
