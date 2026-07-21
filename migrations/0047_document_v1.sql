BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_document_v1', 'system', 'cimmich.document', 'v1',
    now(), now(), encode(digest('cimmich.document.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO NOTHING;

CREATE TABLE cimmich_document (
    document_id text PRIMARY KEY
        CHECK (document_id ~ '^document_[0-9a-f]{32}$'),
    source_kind text NOT NULL
        CHECK (source_kind IN ('immich_asset','cimmich_file')),
    source_asset_id text REFERENCES asset(asset_id),
    storage_key text,
    source_filename text NOT NULL
        CHECK (length(btrim(source_filename)) BETWEEN 1 AND 255),
    mime_type text NOT NULL
        CHECK (length(btrim(mime_type)) BETWEEN 1 AND 120),
    byte_size bigint CHECK (byte_size IS NULL OR byte_size BETWEEN 1 AND 26214400),
    content_sha256 text CHECK (
        content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$'
    ),
    source_content_hash text,
    supersedes_document_id text REFERENCES cimmich_document(document_id),
    display_title text NOT NULL
        CHECK (length(btrim(display_title)) BETWEEN 1 AND 240),
    document_kind text NOT NULL CHECK (document_kind IN (
        'veterinary','vaccination','registration','insurance','adoption',
        'receipt','care','identity','lease','contract','certificate',
        'correspondence','financial','booking','manual','other'
    )),
    document_label text CHECK (
        document_label IS NULL OR length(btrim(document_label)) BETWEEN 1 AND 120
    ),
    issued_on date,
    expires_on date,
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','archived')),
    visibility_tier text NOT NULL DEFAULT 'standard'
        CHECK (visibility_tier IN ('standard','personal','private')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_by text NOT NULL
        CHECK (length(btrim(created_by)) BETWEEN 1 AND 120),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    privacy_class text NOT NULL DEFAULT 'private'
        CHECK (privacy_class = 'private'),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
    CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on),
    CHECK (supersedes_document_id IS NULL OR supersedes_document_id <> document_id),
    CHECK (
        (source_kind = 'immich_asset'
            AND source_asset_id IS NOT NULL
            AND storage_key IS NULL)
        OR
        (source_kind = 'cimmich_file'
            AND source_asset_id IS NULL
            AND storage_key ~ '^[0-9a-f]{2}/[0-9a-f]{64}$'
            AND content_sha256 IS NOT NULL
            AND byte_size IS NOT NULL)
    )
);

CREATE UNIQUE INDEX cimmich_document_source_asset_unique
    ON cimmich_document(source_asset_id)
    WHERE source_kind = 'immich_asset';
CREATE INDEX cimmich_document_status_kind_title
    ON cimmich_document(status, document_kind, lower(display_title), document_id);
CREATE INDEX cimmich_document_title_trgm
    ON cimmich_document USING gin (lower(display_title) gin_trgm_ops);
CREATE INDEX cimmich_document_filename_trgm
    ON cimmich_document USING gin (lower(source_filename) gin_trgm_ops);
CREATE INDEX cimmich_document_content_sha
    ON cimmich_document(content_sha256)
    WHERE content_sha256 IS NOT NULL;
CREATE UNIQUE INDEX cimmich_document_one_direct_successor
    ON cimmich_document(supersedes_document_id)
    WHERE supersedes_document_id IS NOT NULL;

CREATE FUNCTION enforce_cimmich_document_source()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.source_kind = 'immich_asset' AND NOT EXISTS (
        SELECT 1 FROM asset WHERE asset_id = NEW.source_asset_id AND state = 'active'
    ) THEN
        RAISE EXCEPTION 'DOCUMENT_SOURCE_ASSET_NOT_FOUND_DB'
            USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER cimmich_document_source_guard
BEFORE INSERT OR UPDATE OF source_kind, source_asset_id
ON cimmich_document
FOR EACH ROW EXECUTE FUNCTION enforce_cimmich_document_source();

CREATE TABLE cimmich_document_link (
    link_id text PRIMARY KEY CHECK (link_id ~ '^document_link_[0-9a-f]{32}$'),
    document_id text NOT NULL REFERENCES cimmich_document(document_id),
    subject_kind text NOT NULL
        CHECK (subject_kind IN ('person','pet','place','object','event')),
    subject_id text NOT NULL CHECK (length(btrim(subject_id)) BETWEEN 1 AND 160),
    relation_kind text NOT NULL
        CHECK (relation_kind IN ('about','belongs_to','issued_to','applies_to','related')),
    state text NOT NULL CHECK (state IN ('current','superseded')),
    decision_id text NOT NULL REFERENCES decision(decision_id),
    supersedes_link_id text REFERENCES cimmich_document_link(link_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1)
);

CREATE UNIQUE INDEX cimmich_document_link_one_current
    ON cimmich_document_link(document_id, subject_kind, subject_id, relation_kind)
    WHERE state = 'current';
CREATE INDEX cimmich_document_link_document_current
    ON cimmich_document_link(document_id, created_at, link_id)
    WHERE state = 'current';
CREATE INDEX cimmich_document_link_subject_current
    ON cimmich_document_link(subject_kind, subject_id, document_id)
    WHERE state = 'current';

CREATE FUNCTION enforce_cimmich_document_link_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_subject_kind text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM cimmich_document
        WHERE document_id = NEW.document_id AND status IN ('active','archived')
    ) THEN
        RAISE EXCEPTION 'DOCUMENT_NOT_FOUND_DB' USING ERRCODE = '23503';
    END IF;

    IF NEW.subject_kind IN ('person','pet') THEN
        SELECT subject_kind INTO v_subject_kind
        FROM person WHERE person_id = NEW.subject_id
          AND status IN ('active','hidden');
        IF v_subject_kind IS DISTINCT FROM NEW.subject_kind THEN
            RAISE EXCEPTION 'DOCUMENT_SUBJECT_KIND_MISMATCH_DB'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        SELECT entity_kind INTO v_subject_kind
        FROM context_entity WHERE entity_id = NEW.subject_id
          AND status IN ('active','hidden');
        IF v_subject_kind IS DISTINCT FROM NEW.subject_kind THEN
            RAISE EXCEPTION 'DOCUMENT_SUBJECT_KIND_MISMATCH_DB'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER cimmich_document_link_scope_guard
BEFORE INSERT OR UPDATE OF document_id, subject_kind, subject_id
ON cimmich_document_link
FOR EACH ROW EXECUTE FUNCTION enforce_cimmich_document_link_scope();

CREATE VIEW current_cimmich_document_link AS
SELECT * FROM cimmich_document_link WHERE state = 'current';

CREATE TABLE cimmich_document_command (
    command_id text PRIMARY KEY
        CHECK (command_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$'),
    actor_id text NOT NULL CHECK (length(btrim(actor_id)) BETWEEN 1 AND 120),
    command_kind text NOT NULL CHECK (command_kind IN (
        'reference','import','update','link_attach','link_detach','undo'
    )),
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

CREATE TABLE cimmich_document_operation (
    operation_id text PRIMARY KEY
        CHECK (operation_id ~ '^document_operation_[0-9a-f]{32}$'),
    command_id text NOT NULL UNIQUE REFERENCES cimmich_document_command(command_id),
    decision_id text NOT NULL UNIQUE REFERENCES decision(decision_id),
    document_id text NOT NULL REFERENCES cimmich_document(document_id),
    operation_kind text NOT NULL CHECK (operation_kind IN (
        'reference','import','update','link_attach','link_detach','undo'
    )),
    before_state jsonb NOT NULL CHECK (jsonb_typeof(before_state) = 'object'),
    after_state jsonb NOT NULL CHECK (jsonb_typeof(after_state) = 'object'),
    affected_link_keys jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(affected_link_keys) = 'array'),
    state text NOT NULL CHECK (state IN ('active','undone')),
    supersedes_operation_id text REFERENCES cimmich_document_operation(operation_id),
    undone_by_operation_id text REFERENCES cimmich_document_operation(operation_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    privacy_class text NOT NULL DEFAULT 'private' CHECK (privacy_class = 'private'),
    schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1)
);

CREATE INDEX cimmich_document_operation_document_state
    ON cimmich_document_operation(document_id, state, created_at DESC);

ALTER TABLE cimmich_visibility_object
    DROP CONSTRAINT cimmich_visibility_object_object_scope_check;
ALTER TABLE cimmich_visibility_object
    ADD CONSTRAINT cimmich_visibility_object_object_scope_check
    CHECK (object_scope IN ('asset','album','collection','document'));

CREATE OR REPLACE FUNCTION enforce_cimmich_visibility_object_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.object_scope = 'asset' THEN
        IF NOT EXISTS (
            SELECT 1 FROM asset WHERE asset_id = NEW.object_id AND state = 'active'
        ) THEN
            RAISE EXCEPTION 'VISIBILITY_OBJECT_NOT_FOUND_DB'
                USING ERRCODE = '23503';
        END IF;
    ELSIF NEW.object_scope = 'document' THEN
        IF NOT EXISTS (
            SELECT 1 FROM cimmich_document
            WHERE document_id = NEW.object_id AND status IN ('active','archived')
        ) THEN
            RAISE EXCEPTION 'VISIBILITY_OBJECT_NOT_FOUND_DB'
                USING ERRCODE = '23503';
        END IF;
    ELSE
        RAISE EXCEPTION 'VISIBILITY_SCOPE_UNAVAILABLE_DB'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION cimmich_visibility_document_rank(p_document_id text)
RETURNS integer LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT greatest(
        CASE coalesce((
            SELECT visibility_tier FROM cimmich_visibility_object
            WHERE object_scope = 'document' AND object_id = p_document_id
        ), (
            SELECT visibility_tier FROM cimmich_document
            WHERE document_id = p_document_id
        ), 'standard')
            WHEN 'standard' THEN 0 WHEN 'personal' THEN 1 WHEN 'private' THEN 2
        END,
        coalesce((
            SELECT cimmich_visibility_asset_rank(source_asset_id)
            FROM cimmich_document
            WHERE document_id = p_document_id AND source_kind = 'immich_asset'
        ), 0)
    );
$$;

INSERT INTO cimmich_visibility_projection_surface (
    surface_key, coverage_state, asset_derived, route_family, reason_code,
    producer_receipt_id
) VALUES (
    'documents', 'enforced', false,
    '/v1/documents|/v1/documents/:documentId', NULL,
    'receipt_cimmich_document_v1'
) ON CONFLICT (surface_key) DO UPDATE SET
    coverage_state = excluded.coverage_state,
    asset_derived = excluded.asset_derived,
    route_family = excluded.route_family,
    reason_code = NULL,
    producer_receipt_id = excluded.producer_receipt_id,
    updated_at = now();

COMMIT;
