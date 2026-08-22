BEGIN;

INSERT INTO producer_receipt (
    producer_receipt_id, producer_kind, producer_name, producer_version,
    started_at, completed_at, result_digest, privacy_class
) VALUES (
    'receipt_cimmich_archive_missing_file_management_v1', 'system',
    'cimmich-archive-missing-file-management', 'v1', now(), now(),
    encode(digest('cimmich.archive-missing-files.v1', 'sha256'), 'hex'),
    'private'
) ON CONFLICT (producer_receipt_id) DO UPDATE
SET completed_at = excluded.completed_at,
    result_digest = excluded.result_digest;

CREATE TABLE archive_missing_file_command (
    command_id text PRIMARY KEY CHECK (
        command_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,119}$'
    ),
    actor_id text NOT NULL CHECK (length(btrim(actor_id)) BETWEEN 1 AND 120),
    source_id text NOT NULL CHECK (length(btrim(source_id)) BETWEEN 1 AND 120),
    source_asset_ids text[] NOT NULL CHECK (
        cardinality(source_asset_ids) BETWEEN 1 AND 100
    ),
    request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
    response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
    producer_receipt_id text NOT NULL REFERENCES producer_receipt(producer_receipt_id),
    privacy_class text NOT NULL DEFAULT 'private',
    schema_version integer NOT NULL DEFAULT 1,
    completed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX archive_missing_file_command_source
    ON archive_missing_file_command(source_id, completed_at DESC);

COMMIT;
