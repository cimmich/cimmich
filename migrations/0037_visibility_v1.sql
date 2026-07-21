BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_visibility_v1', 'system', 'cimmich.visibility', 'v1',
    now(), now(), encode(digest('cimmich.visibility.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO NOTHING;

CREATE TABLE cimmich_visibility_private_credential (
    principal_id text PRIMARY KEY,
    algorithm text NOT NULL CHECK (algorithm = 'scrypt-v1'),
    salt_hex text NOT NULL CHECK (salt_hex ~ '^[0-9a-f]{32}$'),
    verifier_hex text NOT NULL CHECK (verifier_hex ~ '^[0-9a-f]{128}$'),
    config_digest text NOT NULL CHECK (config_digest ~ '^[0-9a-f]{64}$'),
    updated_at timestamptz NOT NULL DEFAULT now(),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1
);

CREATE TABLE cimmich_visibility_decision (
    decision_id text PRIMARY KEY,
    actor_id text NOT NULL CHECK (length(btrim(actor_id)) BETWEEN 1 AND 120),
    principal_id text NOT NULL CHECK (length(btrim(principal_id)) BETWEEN 1 AND 120),
    device_id text NOT NULL CHECK (length(btrim(device_id)) BETWEEN 1 AND 120),
    decision_kind text NOT NULL CHECK (decision_kind IN ('set','bulk_set','undo')),
    before_state jsonb NOT NULL CHECK (jsonb_typeof(before_state) = 'array'),
    after_state jsonb NOT NULL CHECK (jsonb_typeof(after_state) = 'array'),
    state text NOT NULL CHECK (state IN ('active','undone')),
    supersedes_decision_id text REFERENCES cimmich_visibility_decision(decision_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1
);

CREATE TABLE cimmich_visibility_object (
    object_scope text NOT NULL CHECK (object_scope IN ('asset','album','collection')),
    object_id text NOT NULL CHECK (length(btrim(object_id)) BETWEEN 1 AND 200),
    visibility_tier text NOT NULL CHECK (visibility_tier IN ('standard','personal','private')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    decision_id text NOT NULL REFERENCES cimmich_visibility_decision(decision_id),
    updated_at timestamptz NOT NULL DEFAULT now(),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    PRIMARY KEY (object_scope, object_id)
);

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
    ELSE
        RAISE EXCEPTION 'VISIBILITY_SCOPE_UNAVAILABLE_DB'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER cimmich_visibility_object_scope_guard
BEFORE INSERT OR UPDATE OF object_scope, object_id
ON cimmich_visibility_object
FOR EACH ROW EXECUTE FUNCTION enforce_cimmich_visibility_object_scope();

CREATE TABLE cimmich_visibility_command (
    command_id text PRIMARY KEY CHECK (command_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$'),
    actor_id text NOT NULL CHECK (length(btrim(actor_id)) BETWEEN 1 AND 120),
    principal_id text NOT NULL CHECK (length(btrim(principal_id)) BETWEEN 1 AND 120),
    device_id text NOT NULL CHECK (length(btrim(device_id)) BETWEEN 1 AND 120),
    command_kind text NOT NULL CHECK (command_kind IN ('set','bulk_set','undo')),
    request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
    decision_id text REFERENCES cimmich_visibility_decision(decision_id),
    response_body jsonb,
    state text NOT NULL CHECK (state IN ('started','completed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    CHECK ((state = 'completed') = (response_body IS NOT NULL AND completed_at IS NOT NULL))
);

CREATE TABLE cimmich_visibility_audit (
    audit_id text PRIMARY KEY,
    event_kind text NOT NULL CHECK (event_kind IN (
        'credential_configured','unlock_succeeded','unlock_failed','mode_changed',
        'locked','object_tier_changed','decision_undone'
    )),
    actor_id text NOT NULL CHECK (length(btrim(actor_id)) BETWEEN 1 AND 120),
    principal_id text NOT NULL CHECK (length(btrim(principal_id)) BETWEEN 1 AND 120),
    device_id text NOT NULL CHECK (length(btrim(device_id)) BETWEEN 1 AND 120),
    decision_id text REFERENCES cimmich_visibility_decision(decision_id),
    details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1
);

CREATE INDEX cimmich_visibility_audit_created
    ON cimmich_visibility_audit(created_at DESC, audit_id DESC);
CREATE INDEX cimmich_visibility_decision_created
    ON cimmich_visibility_decision(created_at DESC, decision_id DESC);

CREATE OR REPLACE FUNCTION cimmich_visibility_asset_rank(p_asset_id text)
RETURNS integer LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT CASE coalesce((
        SELECT visibility_tier
        FROM cimmich_visibility_object
        WHERE object_scope = 'asset' AND object_id = p_asset_id
    ), 'standard')
        WHEN 'standard' THEN 0
        WHEN 'personal' THEN 1
        WHEN 'private' THEN 2
    END;
$$;

COMMIT;
