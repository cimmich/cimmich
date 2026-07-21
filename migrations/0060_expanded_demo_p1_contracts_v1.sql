BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_expanded_demo_p1_contracts_v1', 'system',
    'cimmich-expanded-demo-p1-contracts', 'v1', now(), now(),
    encode(digest('cimmich-expanded-demo-p1-contracts-v1', 'sha256'), 'hex'),
    'release-safe'
) ON CONFLICT (producer_receipt_id) DO NOTHING;

CREATE TABLE person_merge_command (
    command_id text PRIMARY KEY CHECK (
        command_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$'
    ),
    actor_id text NOT NULL CHECK (
        actor_id = btrim(actor_id) AND length(actor_id) BETWEEN 1 AND 120
    ),
    command_kind text NOT NULL CHECK (command_kind IN ('merge','unmerge')),
    request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
    merge_operation_id text REFERENCES person_merge_operation(merge_operation_id),
    response_body jsonb,
    state text NOT NULL CHECK (state IN ('started','completed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    schema_version integer NOT NULL DEFAULT 2 CHECK (schema_version = 2),
    CHECK ((state = 'completed') =
        (merge_operation_id IS NOT NULL AND response_body IS NOT NULL
         AND completed_at IS NOT NULL))
);

CREATE INDEX person_merge_command_operation
    ON person_merge_command(merge_operation_id, command_kind, created_at);

CREATE TABLE person_create_command (
    command_id text PRIMARY KEY CHECK (
        command_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$'
    ),
    actor_id text NOT NULL CHECK (
        actor_id = btrim(actor_id) AND length(actor_id) BETWEEN 1 AND 120
    ),
    command_kind text NOT NULL CHECK (
        command_kind IN ('create_native','reconcile_immich')
    ),
    request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
    person_id text REFERENCES person(person_id),
    decision_id text REFERENCES decision(decision_id),
    response_body jsonb,
    state text NOT NULL CHECK (state IN ('started','completed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    CHECK ((state = 'completed') =
        (person_id IS NOT NULL AND decision_id IS NOT NULL
         AND response_body IS NOT NULL AND completed_at IS NOT NULL))
);

CREATE TABLE immich_person_projection (
    source_id text NOT NULL CHECK (
        source_id = btrim(source_id) AND length(source_id) BETWEEN 1 AND 120
    ),
    immich_person_id text NOT NULL CHECK (
        immich_person_id = btrim(immich_person_id)
        AND length(immich_person_id) BETWEEN 1 AND 200
    ),
    person_id text NOT NULL UNIQUE REFERENCES person(person_id),
    source_name text NOT NULL CHECK (
        source_name = btrim(source_name) AND length(source_name) BETWEEN 1 AND 160
    ),
    source_revision text NOT NULL CHECK (source_revision ~ '^[0-9a-f]{64}$'),
    state text NOT NULL CHECK (state IN ('active','superseded')),
    producer_receipt_id text NOT NULL
        REFERENCES producer_receipt(producer_receipt_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    PRIMARY KEY (source_id, immich_person_id)
);

CREATE OR REPLACE FUNCTION enforce_immich_person_projection()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_kind text;
    v_status text;
BEGIN
    SELECT subject_kind, status INTO v_kind, v_status
    FROM person WHERE person_id = NEW.person_id;
    IF v_kind IS DISTINCT FROM 'person' OR v_status NOT IN ('active','hidden') THEN
        RAISE EXCEPTION 'IMMICH_PERSON_PROJECTION_TARGET_INVALID_DB'
            USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND (
        NEW.source_id IS DISTINCT FROM OLD.source_id
        OR NEW.immich_person_id IS DISTINCT FROM OLD.immich_person_id
        OR NEW.person_id IS DISTINCT FROM OLD.person_id
    ) THEN
        RAISE EXCEPTION 'IMMICH_PERSON_PROJECTION_IDENTITY_IMMUTABLE_DB'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER immich_person_projection_guard
BEFORE INSERT OR UPDATE ON immich_person_projection
FOR EACH ROW EXECUTE FUNCTION enforce_immich_person_projection();

COMMIT;
