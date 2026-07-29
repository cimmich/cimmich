BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_verified_content_binding_v1', 'system',
    'cimmich-verified-content-binding', 'v1', now(), now(),
    encode(digest('cimmich.verified-content-binding.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

CREATE TABLE verified_content_binding_command (
    command_id text PRIMARY KEY CHECK (
        length(btrim(command_id)) BETWEEN 1 AND 200
    ),
    actor_id text NOT NULL CHECK (
        length(btrim(actor_id)) BETWEEN 1 AND 200
    ),
    request_digest text NOT NULL CHECK (
        request_digest ~ '^[0-9a-f]{64}$'
    ),
    response jsonb NOT NULL CHECK (
        jsonb_typeof(response) = 'object'
        AND response->>'schemaVersion' =
          'cimmich.verified-content-binding.v1'
        AND response->>'verification' = 'byte_verified'
    ),
    producer_receipt_id text NOT NULL
        REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
