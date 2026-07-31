BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_inventory_placeholder_job_prune_v1', 'system',
    'cimmich-inventory-placeholder-job-prune', 'v1', now(), now(),
    encode(digest('cimmich.inventory-placeholder-job-prune.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

CREATE TABLE inventory_placeholder_job_prune_command (
    command_id text PRIMARY KEY CHECK (
        length(btrim(command_id)) BETWEEN 1 AND 200
    ),
    actor_id text NOT NULL CHECK (
        length(btrim(actor_id)) BETWEEN 1 AND 200
    ),
    expected_job_count integer NOT NULL CHECK (expected_job_count > 0),
    request_digest text NOT NULL CHECK (
        request_digest ~ '^[0-9a-f]{64}$'
    ),
    response jsonb NOT NULL CHECK (
        jsonb_typeof(response) = 'object'
    ),
    producer_receipt_id text NOT NULL
        REFERENCES producer_receipt(producer_receipt_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1
);

COMMIT;
