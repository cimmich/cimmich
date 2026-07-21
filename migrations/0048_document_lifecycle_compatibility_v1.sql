BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_document_lifecycle_compatibility_v1', 'system',
    'cimmich.document-lifecycle-compatibility', 'v1', now(), now(),
    encode(digest('cimmich.document-lifecycle-compatibility.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO NOTHING;

CREATE TABLE cimmich_document_legacy_pet_command (
    command_id text PRIMARY KEY
        CHECK (command_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$'),
    actor_id text NOT NULL CHECK (length(btrim(actor_id)) BETWEEN 1 AND 120),
    command_kind text NOT NULL CHECK (command_kind IN ('adopt','undo')),
    request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
    decision_id text REFERENCES decision(decision_id),
    response_body jsonb,
    state text NOT NULL CHECK (state IN ('started','completed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    CHECK ((state = 'completed') = (response_body IS NOT NULL AND completed_at IS NOT NULL))
);

CREATE TABLE cimmich_document_legacy_pet_adoption (
    adoption_id text PRIMARY KEY
        CHECK (adoption_id ~ '^document_pet_adoption_[0-9a-f]{32}$'),
    legacy_link_id text NOT NULL REFERENCES pet_document_link(link_id),
    document_id text NOT NULL REFERENCES cimmich_document(document_id),
    created_document boolean NOT NULL,
    reactivated_document boolean NOT NULL DEFAULT false,
    document_revision_after bigint NOT NULL CHECK (document_revision_after > 0),
    created_link_id text REFERENCES cimmich_document_link(link_id),
    command_id text NOT NULL UNIQUE
        REFERENCES cimmich_document_legacy_pet_command(command_id),
    decision_id text NOT NULL UNIQUE REFERENCES decision(decision_id),
    state text NOT NULL CHECK (state IN ('active','undone')),
    supersedes_adoption_id text
        REFERENCES cimmich_document_legacy_pet_adoption(adoption_id),
    undo_decision_id text UNIQUE REFERENCES decision(decision_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    undone_at timestamptz,
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    CHECK (supersedes_adoption_id IS NULL OR supersedes_adoption_id <> adoption_id),
    CHECK (NOT (created_document AND reactivated_document)),
    CHECK ((state = 'undone') = (undo_decision_id IS NOT NULL AND undone_at IS NOT NULL))
);

CREATE UNIQUE INDEX cimmich_document_legacy_pet_one_active
    ON cimmich_document_legacy_pet_adoption(legacy_link_id)
    WHERE state = 'active';
CREATE INDEX cimmich_document_legacy_pet_document
    ON cimmich_document_legacy_pet_adoption(document_id, state);

CREATE TABLE cimmich_document_purge_receipt (
    purge_receipt_id text PRIMARY KEY
        CHECK (purge_receipt_id ~ '^document_purge_[0-9a-f]{32}$'),
    document_token_digest text NOT NULL
        CHECK (document_token_digest ~ '^[0-9a-f]{64}$'),
    content_token_digest text
        CHECK (content_token_digest IS NULL OR content_token_digest ~ '^[0-9a-f]{64}$'),
    deleted_counts jsonb NOT NULL CHECK (jsonb_typeof(deleted_counts) = 'object'),
    content_deleted boolean NOT NULL,
    completed_at timestamptz NOT NULL DEFAULT now(),
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1)
);

CREATE TABLE cimmich_document_digest_repair_receipt (
    repair_receipt_id text PRIMARY KEY
        CHECK (repair_receipt_id ~ '^document_digest_repair_[0-9a-f]{32}$'),
    prior_token_digest text NOT NULL
        CHECK (prior_token_digest ~ '^[0-9a-f]{64}$'),
    repaired_document_count integer NOT NULL CHECK (repaired_document_count > 0),
    repaired_blob_count integer NOT NULL CHECK (repaired_blob_count > 0),
    completed_at timestamptz NOT NULL DEFAULT now(),
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1)
);

COMMIT;
