BEGIN;

CREATE TABLE media_operator_control (
    control_id text PRIMARY KEY CHECK (control_id = 'primary'),
    state text NOT NULL CHECK (state IN ('running','paused')),
    reason_code text CHECK (
        reason_code IS NULL OR reason_code ~ '^[A-Z][A-Z0-9_]{2,79}$'
    ),
    updated_by text NOT NULL,
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1
);

INSERT INTO media_operator_control (
    control_id, state, updated_by
) VALUES ('primary', 'running', 'migration');

CREATE TABLE media_operator_command (
    command_id text PRIMARY KEY,
    command_kind text NOT NULL CHECK (command_kind IN ('run','pause','resume')),
    actor_id text NOT NULL,
    request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
    resource_envelope jsonb NOT NULL DEFAULT '{}'::jsonb,
    state text NOT NULL CHECK (state IN ('processing','completed','failed')),
    lease_owner text,
    lease_expires_at timestamptz,
    response jsonb,
    error_code text CHECK (
        error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{2,79}$'
    ),
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    CHECK (
        (state = 'processing' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL
            AND completed_at IS NULL AND response IS NULL AND error_code IS NULL)
        OR (state = 'completed' AND lease_owner IS NULL AND lease_expires_at IS NULL
            AND completed_at IS NOT NULL AND response IS NOT NULL AND error_code IS NULL)
        OR (state = 'failed' AND lease_owner IS NULL AND lease_expires_at IS NULL
            AND completed_at IS NOT NULL AND response IS NOT NULL AND error_code IS NOT NULL)
    )
);

CREATE INDEX media_operator_command_recent
    ON media_operator_command(started_at DESC, command_id DESC);
CREATE INDEX media_operator_command_expired
    ON media_operator_command(lease_expires_at)
    WHERE state = 'processing';

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_media_operator_control_v1', 'system',
    'cimmich-media-operator-control', 'v1', now(), now(),
    encode(digest('cimmich-media-operator-control-v1', 'sha256'), 'hex'),
    'release-safe'
) ON CONFLICT (producer_receipt_id) DO UPDATE SET
    completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

COMMIT;
